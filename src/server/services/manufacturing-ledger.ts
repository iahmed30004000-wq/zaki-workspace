import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { PENDING_PATH } from "@/server/services/files";
import {
  LIMITS,
  MAX_BALANCE_MICRO,
  MAX_MOVEMENT_MICRO,
  MAX_TOTAL_MINOR,
  isCurrency,
  isDayText,
  lineTotalMinor,
  parseMinor,
  parseQtyMicro,
  toBaseMicro,
  toSafeNumber,
  valueOfIn,
  valueOfOut,
} from "@/lib/manufacturing/shared";
import type { CountItem } from "@/lib/manufacturing/view";
import { assertCost, assertEdit, mfgScope, notFound, recordMfg, type MfgScope } from "./manufacturing-access";
import { COUNT_INCLUDE, countItemOf, loadMaterial } from "./manufacturing";

/**
 * «مخزون التصنيع» — the movements. One rule runs through all of them:
 *
 *  - the ledger is APPEND-ONLY: a movement is written once (the database refuses an UPDATE and a DELETE). A mistake is corrected by a
 *    REVERSING movement that points at the original, never by an edit;
 *  - the balance is the SUM of the movements, read inside the same transaction that writes (the material's row is locked first, so two
 *    people moving the same material at once cannot both pass the «enough in stock» check);
 *  - a balance never goes below zero (`mfg.e.insufficient`), and never above a sane ceiling;
 *  - every movement has its document: a receive its lot (with the proof), an issue and an adjustment their reason, a reversal its reason and
 *    the movement it undoes, a stocktake adjustment the stocktake a SECOND person approved;
 *  - a movement's value is fixed at the moment it is written, at the weighted average of that moment (a receive: the lot's exact total).
 *
 * ⚠️ This ledger records stock and cost only. It is not accounting: no wallet, no payment, no approval of money, and nothing here talks to the OMS.
 */

const invalid = (path: string, message: string) => new ValidationError([{ path, message }]);
const num = toSafeNumber;

type Tx = Prisma.TransactionClient;

// ───────────────────────────────────────── what a request may carry ─────────────────────────────────────────

const day = z.string().refine(isDayText, "mfg.e.date");
const reason = z.string().trim().min(2, "mfg.e.reason").max(LIMITS.reason, "mfg.e.reason");
const qtyText = z.string().trim().min(1, "mfg.e.qty").max(24, "mfg.e.qty");
const unitId = z.string().min(1).max(64).nullable().optional();

export const receiveSchema = z.object({
  unitId,
  qty: qtyText,
  /** The price of ONE of the chosen unit, in major units of the currency, as typed. */
  unitCost: z.string().trim().min(1, "mfg.e.cost").max(24, "mfg.e.cost"),
  currency: z.string().trim().toUpperCase().refine(isCurrency, "mfg.e.currency"),
  supplierId: z.string().min(1).max(64).nullable().optional(),
  receivedOn: day,
  expiresOn: day.nullable().optional(),
  note: z.string().trim().max(LIMITS.note, "mfg.e.note").nullable().optional(),
  /** The proof photo: a file this person just uploaded through the chat upload route. */
  proofFileId: z.string().min(1).max(64).nullable().optional(),
  /** Without a photo: why there is none (required then). */
  proofNote: z.string().trim().max(LIMITS.reason, "mfg.e.proof_note").nullable().optional(),
});

export const issueSchema = z.object({ unitId, qty: qtyText, reason });
export const adjustSchema = z.object({ unitId, qty: qtyText, reason });
export const reverseSchema = z.object({ reason });
export const countSchema = z.object({ unitId, qty: qtyText, note: z.string().trim().max(LIMITS.note, "mfg.e.note").nullable().optional() });
export const decideSchema = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(LIMITS.reason, "mfg.e.reason").nullable().optional() });

// ───────────────────────────────────────── helpers ─────────────────────────────────────────

/** Locks the material's row for the rest of the transaction (so the balance read after it cannot change under us) and returns it. */
async function lockMaterial(tx: Tx, materialId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Material" WHERE "id" = ${materialId} FOR UPDATE`;
  return tx.material.findUniqueOrThrow({ where: { id: materialId } });
}

async function balanceIn(tx: Tx, materialId: string): Promise<{ qty: bigint; value: bigint }> {
  const sum = await tx.materialMovement.aggregate({ where: { materialId }, _sum: { qtyMicro: true, valueMinor: true } });
  return { qty: sum._sum.qtyMicro ?? 0n, value: sum._sum.valueMinor ?? 0n };
}

/** The unit a quantity was typed in: the base unit (null) or one of the material's active conversions. */
async function unitFor(materialId: string, baseUnit: string, id: string | null | undefined): Promise<{ label: string; num: number; den: number }> {
  if (!id) return { label: baseUnit, num: 1, den: 1 };
  const unit = await db.materialUnit.findFirst({ where: { id, materialId, archivedAt: null } });
  if (!unit) throw invalid("unitId", "mfg.e.unit");
  return { label: unit.label, num: unit.num, den: unit.den };
}

/** A typed quantity in a unit, exactly, in base micro-units: a typo, zero, too much, or a fraction of a micro-unit is refused. */
function baseQty(text: string, conversion: { num: number; den: number }, opts: { signed?: boolean } = {}): { entered: bigint; base: bigint } {
  const entered = parseQtyMicro(text, opts);
  if (entered === null || entered === 0n) throw invalid("qty", "mfg.e.qty");
  const base = toBaseMicro(entered, conversion);
  if (base === null) throw invalid("qty", "mfg.e.qty_exact");
  if (base > MAX_MOVEMENT_MICRO || base < -MAX_MOVEMENT_MICRO) throw invalid("qty", "mfg.e.qty_big");
  return { entered, base };
}

function assertOpen(material: { archivedAt: Date | null }): void {
  if (material.archivedAt) throw invalid("materialId", "mfg.e.archived");
}

async function lastLot(tx: Tx, materialId: string) {
  return tx.materialLot.findFirst({ where: { materialId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { qtyMicro: true, totalCostMinor: true } });
}

/** A day typed in the form (a date, no time) as the UTC midnight the `@db.Date` column keeps. */
const dayDate = (text: string): Date => new Date(`${text}T00:00:00.000Z`);

/** The proof photo is a fresh upload of THIS person (a chat file nobody's message holds and no other receipt holds), an image or a PDF. */
async function assertProofFile(tx: Tx, actor: Actor, fileId: string): Promise<void> {
  const file = await tx.storedFile.findFirst({
    where: { id: fileId, orgId: actor.orgId, deletedAt: null, path: { not: PENDING_PATH } },
    select: { uploaderId: true, purpose: true, mimeType: true, chatLinks: { select: { id: true } } },
  });
  if (!file || file.purpose !== "CHAT" || file.uploaderId !== actor.userId || file.chatLinks.length > 0) throw invalid("proofFileId", "mfg.e.proof_file");
  if (!file.mimeType.startsWith("image/") && file.mimeType !== "application/pdf") throw invalid("proofFileId", "mfg.e.proof_type");
  if (await tx.materialLot.findFirst({ where: { proofFileId: fileId }, select: { id: true } })) throw invalid("proofFileId", "mfg.e.proof_file");
}

// ───────────────────────────────────────── receive ─────────────────────────────────────────

/**
 * A stock receipt: one LOT and one RECEIVE movement, in one transaction. The quantity is typed in the base unit or one of the material's
 * conversions and is stored exactly in base units; the price is the price of ONE typed unit, and the total is rounded half-up once. The
 * proof (a photo, or the reason there is none) is required. Needs `manufacturing.edit` AND `manufacturing.cost` (it records a price).
 */
export async function receiveStock(actor: Actor, materialId: string, input: z.infer<typeof receiveSchema>): Promise<{ lotId: string; movementId: string }> {
  const { scope, row } = await loadMaterial(actor, materialId);
  assertEdit(scope);
  assertCost(scope);
  assertOpen(row);
  const conversion = await unitFor(materialId, row.baseUnit, input.unitId);
  const { entered, base } = baseQty(input.qty, conversion);
  if (base < 0n) throw invalid("qty", "mfg.e.qty");
  const unitCost = parseMinor(input.unitCost, input.currency);
  if (unitCost === null) throw invalid("unitCost", "mfg.e.cost");
  const total = lineTotalMinor(entered, unitCost);
  if (total > MAX_TOTAL_MINOR) throw invalid("unitCost", "mfg.e.cost_big");
  const todayPlusOne = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (input.receivedOn > todayPlusOne) throw invalid("receivedOn", "mfg.e.date_future");
  if (input.expiresOn && input.expiresOn < input.receivedOn) throw invalid("expiresOn", "mfg.e.expiry");
  const proofNote = input.proofNote && input.proofNote.length > 0 ? input.proofNote : null;
  if (!input.proofFileId && !proofNote) throw invalid("proofFileId", "mfg.e.proof_required");
  if (input.supplierId) {
    const supplier = await db.supplier.findFirst({ where: { id: input.supplierId, orgId: actor.orgId, workspaceId: row.workspaceId, archivedAt: null }, select: { id: true } });
    if (!supplier) throw invalid("supplierId", "mfg.e.supplier");
  }

  const made = await db.$transaction(async (tx) => {
    const material = await lockMaterial(tx, materialId);
    assertOpen(material);
    // one currency per material: the first receipt fixes it, so the weighted average is of one kind of money
    if (material.currency && material.currency !== input.currency) throw invalid("currency", "mfg.e.currency_mismatch");
    const bal = await balanceIn(tx, materialId);
    if (bal.qty + base > MAX_BALANCE_MICRO) throw invalid("qty", "mfg.e.qty_big");
    if (input.proofFileId) await assertProofFile(tx, actor, input.proofFileId);
    if (!material.currency) await tx.material.update({ where: { id: materialId }, data: { currency: input.currency } });
    const lot = await tx.materialLot.create({
      data: {
        orgId: actor.orgId,
        workspaceId: row.workspaceId,
        materialId,
        supplierId: input.supplierId ?? null,
        receivedOn: dayDate(input.receivedOn),
        expiresOn: input.expiresOn ? dayDate(input.expiresOn) : null,
        qtyMicro: base,
        enteredQtyMicro: entered,
        enteredUnitLabel: conversion.label,
        unitCostMinor: unitCost,
        totalCostMinor: total,
        currency: input.currency,
        proofFileId: input.proofFileId ?? null,
        proofNote,
        note: input.note && input.note.length > 0 ? input.note : null,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    const movement = await tx.materialMovement.create({
      data: { orgId: actor.orgId, workspaceId: row.workspaceId, materialId, lotId: lot.id, kind: "RECEIVE", qtyMicro: base, valueMinor: total, createdById: actor.userId },
      select: { id: true },
    });
    return { lotId: lot.id, movementId: movement.id };
  });
  await recordMfg(actor, row.workspaceId, "received", made.movementId, { material: row.name, qtyMicro: num(base), proof: input.proofFileId ? "photo" : "note" });
  return made;
}

// ───────────────────────────────────────── issue and adjust ─────────────────────────────────────────

/** The movement of taking `out` (positive base micro-units) from a material, valued at the average of that moment. Refuses more than is in stock. */
async function writeOut(tx: Tx, scope: MfgScope, materialId: string, kind: "ISSUE" | "ADJUST", out: bigint, why: string) {
  const bal = await balanceIn(tx, materialId);
  if (out > bal.qty) throw invalid("qty", "mfg.e.insufficient");
  const value = valueOfOut(out, bal.qty, bal.value);
  return tx.materialMovement.create({
    data: { orgId: scope.actor.orgId, workspaceId: scope.spaceId, materialId, kind, qtyMicro: -out, valueMinor: -value, reason: why, createdById: scope.actor.userId },
    select: { id: true },
  });
}

/** «صرف»: takes stock out (to production, a sample, a loss), with the reason. The value is the weighted average of that moment: the storekeeper needs no cost to do it. */
export async function issueStock(actor: Actor, materialId: string, input: z.infer<typeof issueSchema>): Promise<{ movementId: string }> {
  const { scope, row } = await loadMaterial(actor, materialId);
  assertEdit(scope);
  assertOpen(row);
  const conversion = await unitFor(materialId, row.baseUnit, input.unitId);
  const { base } = baseQty(input.qty, conversion);
  if (base < 0n) throw invalid("qty", "mfg.e.qty");
  const made = await db.$transaction(async (tx) => {
    assertOpen(await lockMaterial(tx, materialId));
    return writeOut(tx, scope, materialId, "ISSUE", base, input.reason);
  });
  await recordMfg(actor, row.workspaceId, "issued", made.id, { material: row.name, qtyMicro: num(base), reason: input.reason });
  return { movementId: made.id };
}

/**
 * «تعديل يدوي»: a signed correction with a reason, outside a stocktake (a negative one takes stock out, a positive one brings it in at the
 * average, or at the last lot's price when nothing is in stock). ⚠️ Nobody else approves it. 🔧 It is in the log under the name, and a count approved by a second person is
 * the way to settle a difference.
 */
export async function adjustStock(actor: Actor, materialId: string, input: z.infer<typeof adjustSchema>): Promise<{ movementId: string }> {
  const { scope, row } = await loadMaterial(actor, materialId);
  assertEdit(scope);
  assertOpen(row);
  const conversion = await unitFor(materialId, row.baseUnit, input.unitId);
  const { base } = baseQty(input.qty, conversion, { signed: true });
  const made = await db.$transaction(async (tx) => {
    assertOpen(await lockMaterial(tx, materialId));
    if (base < 0n) return writeOut(tx, scope, materialId, "ADJUST", -base, input.reason);
    const bal = await balanceIn(tx, materialId);
    if (bal.qty + base > MAX_BALANCE_MICRO) throw invalid("qty", "mfg.e.qty_big");
    const value = valueOfIn(base, bal.qty, bal.value, await lastLot(tx, materialId));
    return tx.materialMovement.create({
      data: { orgId: actor.orgId, workspaceId: row.workspaceId, materialId, kind: "ADJUST", qtyMicro: base, valueMinor: value, reason: input.reason, createdById: actor.userId },
      select: { id: true },
    });
  });
  await recordMfg(actor, row.workspaceId, "adjusted", made.id, { material: row.name, qtyMicro: num(base), reason: input.reason });
  return { movementId: made.id };
}

// ───────────────────────────────────────── reverse ─────────────────────────────────────────

/**
 * «عكس حركة»: the correction of a mistake. A new movement with the opposite quantity and the opposite value, pointing at the original
 * (`reversesId`, unique: a movement is reversed once); the original stays as it was. A reversal itself is never reversed (make the movement
 * again instead). Refused when it would take the balance below zero (the stock was used since).
 */
export async function reverseMovement(actor: Actor, movementId: string, input: z.infer<typeof reverseSchema>): Promise<{ movementId: string }> {
  const original = await db.materialMovement.findFirst({ where: { id: movementId, orgId: actor.orgId } });
  if (!original) throw notFound();
  const scope = await mfgScope(actor, original.workspaceId);
  assertEdit(scope);
  if (original.kind === "REVERSE") throw invalid("movementId", "mfg.e.reverse_reverse");
  const made = await db.$transaction(async (tx) => {
    await lockMaterial(tx, original.materialId);
    if (await tx.materialMovement.findFirst({ where: { reversesId: original.id }, select: { id: true } })) throw invalid("movementId", "mfg.e.already_reversed");
    const bal = await balanceIn(tx, original.materialId);
    if (bal.qty - original.qtyMicro < 0n) throw invalid("movementId", "mfg.e.reverse_negative");
    return tx.materialMovement.create({
      data: {
        orgId: actor.orgId,
        workspaceId: original.workspaceId,
        materialId: original.materialId,
        lotId: original.lotId,
        kind: "REVERSE",
        qtyMicro: -original.qtyMicro,
        valueMinor: -original.valueMinor,
        reason: input.reason,
        reversesId: original.id,
        createdById: actor.userId,
      },
      select: { id: true },
    });
  });
  await recordMfg(actor, original.workspaceId, "reversed", made.id, { reverses: original.id, reason: input.reason });
  return { movementId: made.id };
}

// ───────────────────────────────────────── stocktake ─────────────────────────────────────────

/**
 * «جرد»: somebody counts a material. What was counted, what the book said at that moment and the difference are recorded. With no
 * difference the stocktake is MATCHED and nothing else happens. With one it is PENDING: the balance does NOT change until a SECOND person
 * approves it (`decideCount`). One stocktake waits per material at a time.
 */
export async function startCount(actor: Actor, materialId: string, input: z.infer<typeof countSchema>): Promise<CountItem> {
  const { scope, row } = await loadMaterial(actor, materialId);
  assertEdit(scope);
  assertOpen(row);
  const conversion = await unitFor(materialId, row.baseUnit, input.unitId);
  // a count may be zero («the shelf is empty»), unlike a movement
  const entered = parseQtyMicro(input.qty);
  if (entered === null) throw invalid("qty", "mfg.e.qty");
  const counted = toBaseMicro(entered, conversion);
  if (counted === null) throw invalid("qty", "mfg.e.qty_exact");
  if (counted > MAX_BALANCE_MICRO) throw invalid("qty", "mfg.e.qty_big");
  const created = await db.$transaction(async (tx) => {
    assertOpen(await lockMaterial(tx, materialId));
    if (await tx.materialCount.findFirst({ where: { materialId, status: "PENDING" }, select: { id: true } })) throw invalid("materialId", "mfg.e.count_pending");
    const bal = await balanceIn(tx, materialId);
    const diff = counted - bal.qty;
    return tx.materialCount.create({
      data: {
        orgId: actor.orgId,
        workspaceId: row.workspaceId,
        materialId,
        countedById: actor.userId,
        countedQtyMicro: counted,
        expectedQtyMicro: bal.qty,
        diffMicro: diff,
        note: input.note && input.note.length > 0 ? input.note : null,
        status: diff === 0n ? "MATCHED" : "PENDING",
      },
      include: COUNT_INCLUDE,
    });
  });
  await recordMfg(actor, row.workspaceId, created.status === "MATCHED" ? "count_matched" : "count_started", created.id, { material: row.name, diffMicro: num(created.diffMicro) });
  return countItemOf(scope, created);
}

/**
 * The SECOND person's decision. Approving writes ONE COUNT_ADJUST movement for the difference (valued at the average of that moment) and
 * only then does the balance change; rejecting changes nothing. The approver holds `manufacturing.edit` and is never the person who counted
 * (also a database check). If the book moved since the count, approving is refused (`mfg.e.count_stale`): reject it and count again.
 */
export async function decideCount(actor: Actor, countId: string, input: z.infer<typeof decideSchema>): Promise<CountItem> {
  const count = await db.materialCount.findFirst({ where: { id: countId, orgId: actor.orgId }, select: { id: true, workspaceId: true, materialId: true, countedById: true } });
  if (!count) throw notFound();
  const scope = await mfgScope(actor, count.workspaceId);
  assertEdit(scope);
  if (count.countedById === actor.userId) throw new ForbiddenError("mfg.second_person");
  const note = input.note && input.note.length > 0 ? input.note : null;

  const decided = await db.$transaction(async (tx) => {
    const material = await lockMaterial(tx, count.materialId);
    const fresh = await tx.materialCount.findUniqueOrThrow({ where: { id: count.id } });
    if (fresh.status !== "PENDING") throw new ValidationError([{ path: "countId", message: "mfg.e.count_decided" }]);
    if (input.decision === "approve") {
      assertOpen(material);
      const bal = await balanceIn(tx, count.materialId);
      if (bal.qty !== fresh.expectedQtyMicro) throw invalid("countId", "mfg.e.count_stale");
      const diff = fresh.countedQtyMicro - bal.qty;
      const value = diff < 0n ? valueOfOut(-diff, bal.qty, bal.value) : valueOfIn(diff, bal.qty, bal.value, await lastLot(tx, count.materialId));
      await tx.materialMovement.create({
        data: {
          orgId: actor.orgId,
          workspaceId: count.workspaceId,
          materialId: count.materialId,
          kind: "COUNT_ADJUST",
          qtyMicro: diff,
          valueMinor: diff < 0n ? -value : value,
          reason: note,
          countId: count.id,
          createdById: actor.userId,
        },
      });
    }
    return tx.materialCount.update({
      where: { id: count.id },
      data: { status: input.decision === "approve" ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: new Date(), decisionNote: note },
      include: COUNT_INCLUDE,
    });
  });
  await recordMfg(actor, count.workspaceId, input.decision === "approve" ? "count_approved" : "count_rejected", count.id, { material: decided.material.name, diffMicro: num(decided.diffMicro) });
  return countItemOf(scope, decided);
}
