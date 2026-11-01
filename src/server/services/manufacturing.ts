import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { PENDING_PATH } from "@/server/services/files";
import {
  LIMITS,
  MAX_BALANCE_MICRO,
  averageFormula,
  averageText,
  isLow,
  isMovementKind,
  parseQtyMicro,
  toSafeNumber,
} from "@/lib/manufacturing/shared";
import type {
  CountItem,
  LotItem,
  MaterialCost,
  MaterialDetail,
  MaterialListItem,
  MfgOverview,
  MfgUnit,
  MovementItem,
  SupplierItem,
} from "@/lib/manufacturing/view";
import { assertEdit, mfgScope, notFound, recordMfg, type MfgScope } from "./manufacturing-access";

/**
 * «مخزون التصنيع» — materials, their unit conversions, suppliers, and what the screens read. The movements themselves (receive, issue,
 * adjust, reverse, stocktake) are in manufacturing-ledger.ts; WHO may do any of it is decided in manufacturing-access.ts.
 *
 * Nothing is deleted: a material, a conversion and a supplier are archived. The balance is never stored: it is the SUM of the movements.
 */

const invalid = (path: string, message: string) => new ValidationError([{ path, message }]);
const num = toSafeNumber;

// ───────────────────────────────────────── what a request may carry ─────────────────────────────────────────

const text = (max: number, message: string) => z.string().trim().min(1, message).max(max, message);
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

export const createMaterialSchema = z.object({
  spaceId: z.string().min(1).max(64),
  name: text(LIMITS.name, "mfg.e.name"),
  code: optionalText(LIMITS.code, "mfg.e.code"),
  baseUnit: text(LIMITS.unit, "mfg.e.base_unit"),
  /** The low-stock threshold, as typed (the base unit's quantity). Empty: none. */
  lowStock: z.string().trim().max(24, "mfg.e.qty").nullable().optional(),
});

export const updateMaterialSchema = z.object({
  name: text(LIMITS.name, "mfg.e.name").optional(),
  code: optionalText(LIMITS.code, "mfg.e.code"),
  lowStock: z.string().trim().max(24, "mfg.e.qty").nullable().optional(),
  archived: z.boolean().optional(),
});

export const addUnitSchema = z.object({
  label: text(LIMITS.unit, "mfg.e.unit_label"),
  num: z.number().int("mfg.e.fraction").min(1, "mfg.e.fraction").max(1_000_000, "mfg.e.fraction"),
  den: z.number().int("mfg.e.fraction").min(1, "mfg.e.fraction").max(1_000_000, "mfg.e.fraction").default(1),
});

export const createSupplierSchema = z.object({
  spaceId: z.string().min(1).max(64),
  name: text(LIMITS.name, "mfg.e.name"),
  note: optionalText(LIMITS.supplierNote, "mfg.e.note"),
});

export const updateSupplierSchema = z.object({
  name: text(LIMITS.name, "mfg.e.name").optional(),
  note: optionalText(LIMITS.supplierNote, "mfg.e.note"),
  archived: z.boolean().optional(),
});

/** A typed threshold into micro-units: empty or absent is «none»; anything else must be a plain non-negative number. */
function thresholdOf(raw: string | null | undefined): bigint | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const micro = parseQtyMicro(raw);
  if (micro === null || micro > MAX_BALANCE_MICRO) throw invalid("lowStock", "mfg.e.qty");
  return micro;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// ───────────────────────────────────────── loading ─────────────────────────────────────────

/** A material of this company, with the space's scope (the ledger's gate): a material of another company, or of a space the person cannot open, is «not found». */
export async function loadMaterial(actor: Actor, materialId: string) {
  const row = await db.material.findFirst({ where: { id: materialId, orgId: actor.orgId } });
  if (!row) throw notFound();
  const scope = await mfgScope(actor, row.workspaceId);
  return { scope, row };
}

type MaterialRow = Prisma.MaterialGetPayload<object>;

/** Quantity and value of what is in stock for each material of a space: the SUM of the movements, nothing else. */
async function balances(orgId: string, spaceId: string): Promise<Map<string, { qty: bigint; value: bigint }>> {
  const groups = await db.materialMovement.groupBy({ by: ["materialId"], where: { orgId, workspaceId: spaceId }, _sum: { qtyMicro: true, valueMinor: true } });
  return new Map(groups.map((g) => [g.materialId, { qty: g._sum.qtyMicro ?? 0n, value: g._sum.valueMinor ?? 0n }] as const));
}

function costOf(scope: MfgScope, material: Pick<MaterialRow, "currency">, qty: bigint, value: bigint): MaterialCost | null {
  if (!scope.canCost) return null;
  const currency = material.currency;
  return {
    currency,
    valueMinor: num(value),
    averageText: currency ? averageText(value, qty, currency) : null,
    formula: currency ? averageFormula(value, qty, currency) : null,
  };
}

function listItemOf(scope: MfgScope, m: MaterialRow, bal: { qty: bigint; value: bigint } | undefined, pending: ReadonlySet<string>): MaterialListItem {
  const qty = bal?.qty ?? 0n;
  const value = bal?.value ?? 0n;
  return {
    id: m.id,
    name: m.name,
    code: m.code,
    baseUnit: m.baseUnit,
    balanceMicro: num(qty),
    lowStockMicro: m.lowStockMicro === null ? null : num(m.lowStockMicro),
    low: m.archivedAt === null && isLow(qty, m.lowStockMicro),
    archived: m.archivedAt !== null,
    pendingCount: pending.has(m.id),
    cost: costOf(scope, m, qty, value),
  };
}

const supplierOf = (s: { id: string; name: string; note: string | null; archivedAt: Date | null }): SupplierItem => ({ id: s.id, name: s.name, note: s.note, archived: s.archivedAt !== null });

const unitOf = (u: { id: string; label: string; num: number; den: number; archivedAt: Date | null }): MfgUnit => ({ id: u.id, label: u.label, num: u.num, den: u.den, archived: u.archivedAt !== null });

type CountRow = Prisma.MaterialCountGetPayload<{ include: { material: { select: { name: true; baseUnit: true } }; countedBy: { select: { name: true } }; decidedBy: { select: { name: true } } } }>;

export function countItemOf(scope: MfgScope, c: CountRow): CountItem {
  return {
    id: c.id,
    materialId: c.materialId,
    materialName: c.material.name,
    baseUnit: c.material.baseUnit,
    countedMicro: num(c.countedQtyMicro),
    expectedMicro: num(c.expectedQtyMicro),
    diffMicro: num(c.diffMicro),
    note: c.note,
    status: c.status as CountItem["status"],
    countedBy: c.countedBy.name,
    decidedBy: c.decidedBy?.name ?? null,
    decidedAt: c.decidedAt ? c.decidedAt.toISOString() : null,
    decisionNote: c.decisionNote,
    createdAt: c.createdAt.toISOString(),
    // the SECOND person: an editor who is not the one who counted, while it is still pending
    canDecide: c.status === "PENDING" && scope.canEdit && c.countedById !== scope.actor.userId,
  };
}

export const COUNT_INCLUDE = {
  material: { select: { name: true, baseUnit: true } },
  countedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
} as const;

// ───────────────────────────────────────── reading ─────────────────────────────────────────

/** The ledger's front page: every material with its balance (and, with the cost, its value), the pending stocktakes, the suppliers. */
export async function readOverview(actor: Actor, spaceId: string): Promise<MfgOverview> {
  const scope = await mfgScope(actor, spaceId);
  const [materials, suppliers, pending, bal] = await Promise.all([
    db.material.findMany({ where: { orgId: actor.orgId, workspaceId: spaceId }, orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }, { id: "asc" }], take: LIMITS.list }),
    db.supplier.findMany({ where: { orgId: actor.orgId, workspaceId: spaceId }, orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }, { id: "asc" }], take: LIMITS.list }),
    db.materialCount.findMany({ where: { orgId: actor.orgId, workspaceId: spaceId, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 100, include: COUNT_INCLUDE }),
    balances(actor.orgId, spaceId),
  ]);
  const pendingIds = new Set(pending.map((c) => c.materialId));
  return {
    spaceId,
    spaceName: scope.spaceName,
    canEdit: scope.canEdit,
    canCost: scope.canCost,
    materials: materials.map((m) => listItemOf(scope, m, bal.get(m.id), pendingIds)),
    suppliers: suppliers.map(supplierOf),
    pending: pending.map((c) => countItemOf(scope, c)),
  };
}

/** One material with everything on its page: conversions, lots (with the proof), movements, stocktakes and the average with its formula. */
export async function readMaterial(actor: Actor, materialId: string): Promise<MaterialDetail> {
  const { scope, row } = await loadMaterial(actor, materialId);
  const [units, suppliers, lots, movements, counts, sums] = await Promise.all([
    db.materialUnit.findMany({ where: { materialId }, orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }] }),
    db.supplier.findMany({ where: { orgId: actor.orgId, workspaceId: row.workspaceId }, orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }, { id: "asc" }], take: LIMITS.list }),
    db.materialLot.findMany({
      where: { materialId },
      orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: LIMITS.movements,
      include: { supplier: { select: { id: true, name: true } }, createdBy: { select: { name: true } } },
    }),
    db.materialMovement.findMany({
      where: { materialId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIMITS.movements,
      include: { createdBy: { select: { name: true } } },
    }),
    db.materialCount.findMany({ where: { materialId }, orderBy: { createdAt: "desc" }, take: 20, include: COUNT_INCLUDE }),
    db.materialMovement.aggregate({ where: { materialId }, _sum: { qtyMicro: true, valueMinor: true } }),
  ]);
  const qty = sums._sum.qtyMicro ?? 0n;
  const value = sums._sum.valueMinor ?? 0n;
  // which movements were reversed (by whom): the reversal points at its original
  const reversals = await db.materialMovement.findMany({ where: { materialId, reversesId: { not: null } }, select: { id: true, reversesId: true } });
  const reversedBy = new Map(reversals.map((r) => [r.reversesId as string, r.id] as const));
  const reversedLots = new Set(
    (await db.materialMovement.findMany({ where: { materialId, kind: "RECEIVE", id: { in: [...reversedBy.keys()] } }, select: { lotId: true } })).flatMap((m) => (m.lotId ? [m.lotId] : [])),
  );

  const proofIds = lots.flatMap((l) => (l.proofFileId ? [l.proofFileId] : []));
  const proofs = new Map(
    (proofIds.length === 0
      ? []
      : await db.storedFile.findMany({ where: { id: { in: proofIds }, orgId: actor.orgId, deletedAt: null, path: { not: PENDING_PATH } }, select: { id: true, name: true, mimeType: true } })
    ).map((f) => [f.id, f] as const),
  );

  const lotItems: LotItem[] = lots.map((l) => ({
    id: l.id,
    receivedOn: l.receivedOn.toISOString().slice(0, 10),
    expiresOn: l.expiresOn ? l.expiresOn.toISOString().slice(0, 10) : null,
    qtyMicro: num(l.qtyMicro),
    enteredQtyMicro: num(l.enteredQtyMicro),
    enteredUnitLabel: l.enteredUnitLabel,
    supplier: l.supplier,
    note: l.note,
    proof: l.proofFileId && proofs.has(l.proofFileId) ? { id: l.proofFileId, name: proofs.get(l.proofFileId)!.name, mimeType: proofs.get(l.proofFileId)!.mimeType, url: `/api/files/${l.proofFileId}/raw` } : null,
    proofNote: l.proofNote,
    createdBy: l.createdBy.name,
    createdAt: l.createdAt.toISOString(),
    cost: scope.canCost ? { currency: l.currency, unitCostMinor: num(l.unitCostMinor), totalCostMinor: num(l.totalCostMinor) } : null,
    reversed: reversedLots.has(l.id),
  }));

  const movementItems: MovementItem[] = movements.map((m) => {
    const kind = isMovementKind(m.kind) ? m.kind : "ADJUST";
    return {
      id: m.id,
      kind,
      qtyMicro: num(m.qtyMicro),
      reason: m.reason,
      lotId: m.lotId,
      reversesId: m.reversesId,
      reversedById: reversedBy.get(m.id) ?? null,
      createdBy: m.createdBy.name,
      createdAt: m.createdAt.toISOString(),
      valueMinor: scope.canCost ? num(m.valueMinor) : null,
      canReverse: scope.canEdit && kind !== "REVERSE" && !reversedBy.has(m.id),
    };
  });

  return {
    id: row.id,
    spaceId: row.workspaceId,
    spaceName: scope.spaceName,
    name: row.name,
    code: row.code,
    baseUnit: row.baseUnit,
    lowStockMicro: row.lowStockMicro === null ? null : num(row.lowStockMicro),
    low: row.archivedAt === null && isLow(qty, row.lowStockMicro),
    archived: row.archivedAt !== null,
    balanceMicro: num(qty),
    units: units.map(unitOf),
    suppliers: suppliers.map(supplierOf),
    canEdit: scope.canEdit,
    canCost: scope.canCost,
    cost: costOf(scope, row, qty, value),
    lots: lotItems,
    movements: movementItems,
    counts: counts.map((c) => countItemOf(scope, c)),
  };
}

// ───────────────────────────────────────── materials ─────────────────────────────────────────

export async function createMaterial(actor: Actor, input: z.infer<typeof createMaterialSchema>): Promise<{ id: string }> {
  const scope = await mfgScope(actor, input.spaceId);
  assertEdit(scope);
  const lowStockMicro = thresholdOf(input.lowStock);
  if (input.code) {
    const taken = await db.material.findFirst({ where: { workspaceId: input.spaceId, code: input.code }, select: { id: true } });
    if (taken) throw invalid("code", "mfg.e.code_taken");
  }
  const made = await db.material.create({
    data: { orgId: actor.orgId, workspaceId: input.spaceId, name: input.name, code: input.code, baseUnit: input.baseUnit, lowStockMicro, createdById: actor.userId },
    select: { id: true },
  });
  await recordMfg(actor, input.spaceId, "material_created", made.id, { name: input.name, baseUnit: input.baseUnit });
  return made;
}

export async function updateMaterial(actor: Actor, materialId: string, input: z.infer<typeof updateMaterialSchema>): Promise<{ ok: true }> {
  const { scope, row } = await loadMaterial(actor, materialId);
  assertEdit(scope);
  const data: Prisma.MaterialUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.code !== undefined) {
    if (input.code) {
      const taken = await db.material.findFirst({ where: { workspaceId: row.workspaceId, code: input.code, id: { not: row.id } }, select: { id: true } });
      if (taken) throw invalid("code", "mfg.e.code_taken");
    }
    data.code = input.code;
  }
  if (input.lowStock !== undefined) data.lowStockMicro = thresholdOf(input.lowStock);
  if (input.archived !== undefined && input.archived !== (row.archivedAt !== null)) {
    if (input.archived) {
      // archiving hides it: never while it still holds stock or has a stocktake waiting for its second person
      const [sum, pending] = await Promise.all([
        db.materialMovement.aggregate({ where: { materialId }, _sum: { qtyMicro: true } }),
        db.materialCount.count({ where: { materialId, status: "PENDING" } }),
      ]);
      if ((sum._sum.qtyMicro ?? 0n) !== 0n) throw invalid("archived", "mfg.e.archive_balance");
      if (pending > 0) throw invalid("archived", "mfg.e.archive_pending");
      data.archivedAt = new Date();
    } else {
      data.archivedAt = null;
    }
  }
  if (Object.keys(data).length === 0) return { ok: true };
  await db.material.update({ where: { id: materialId }, data });
  await recordMfg(actor, row.workspaceId, input.archived === undefined ? "material_edited" : input.archived ? "material_archived" : "material_restored", materialId, { name: row.name });
  return { ok: true };
}

// ───────────────────────────────────────── conversions ─────────────────────────────────────────

/** «1 كرتونة = 24 علبة»: adds a conversion (a label that was archived comes back with the new numbers). The fraction is kept in lowest terms. */
export async function addUnit(actor: Actor, materialId: string, input: z.infer<typeof addUnitSchema>): Promise<MfgUnit[]> {
  const { scope, row } = await loadMaterial(actor, materialId);
  assertEdit(scope);
  if (input.label === row.baseUnit) throw invalid("label", "mfg.e.unit_is_base");
  const g = gcd(input.num, input.den);
  const numerator = input.num / g;
  const denominator = input.den / g;
  const existing = await db.materialUnit.findMany({ where: { materialId } });
  const same = existing.find((u) => u.label === input.label);
  if (same && same.archivedAt === null) throw invalid("label", "mfg.e.unit_taken");
  if (existing.filter((u) => u.archivedAt === null).length >= LIMITS.conversions) throw invalid("label", "mfg.e.unit_limit");
  if (same) await db.materialUnit.update({ where: { id: same.id }, data: { num: numerator, den: denominator, archivedAt: null } });
  else await db.materialUnit.create({ data: { materialId, label: input.label, num: numerator, den: denominator } });
  await recordMfg(actor, row.workspaceId, "unit_added", materialId, { label: input.label, num: numerator, den: denominator });
  return (await db.materialUnit.findMany({ where: { materialId }, orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }] })).map(unitOf);
}

/** A conversion is archived, not deleted (lots keep the label they were typed in). */
export async function archiveUnit(actor: Actor, materialId: string, unitId: string): Promise<MfgUnit[]> {
  const { scope, row } = await loadMaterial(actor, materialId);
  assertEdit(scope);
  const unit = await db.materialUnit.findFirst({ where: { id: unitId, materialId } });
  if (!unit) throw new NotFoundError("mfg.not_found");
  if (unit.archivedAt === null) {
    await db.materialUnit.update({ where: { id: unit.id }, data: { archivedAt: new Date() } });
    await recordMfg(actor, row.workspaceId, "unit_archived", materialId, { label: unit.label });
  }
  return (await db.materialUnit.findMany({ where: { materialId }, orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }] })).map(unitOf);
}

// ───────────────────────────────────────── suppliers ─────────────────────────────────────────

export async function createSupplier(actor: Actor, input: z.infer<typeof createSupplierSchema>): Promise<SupplierItem> {
  const scope = await mfgScope(actor, input.spaceId);
  assertEdit(scope);
  const made = await db.supplier.create({ data: { orgId: actor.orgId, workspaceId: input.spaceId, name: input.name, note: input.note, createdById: actor.userId } });
  await recordMfg(actor, input.spaceId, "supplier_created", made.id, { name: input.name });
  return supplierOf(made);
}

export async function updateSupplier(actor: Actor, supplierId: string, input: z.infer<typeof updateSupplierSchema>): Promise<SupplierItem> {
  const row = await db.supplier.findFirst({ where: { id: supplierId, orgId: actor.orgId } });
  if (!row) throw notFound();
  const scope = await mfgScope(actor, row.workspaceId);
  assertEdit(scope);
  const data: Prisma.SupplierUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.note !== undefined) data.note = input.note;
  if (input.archived !== undefined && input.archived !== (row.archivedAt !== null)) data.archivedAt = input.archived ? new Date() : null;
  const saved = Object.keys(data).length > 0 ? await db.supplier.update({ where: { id: row.id }, data }) : row;
  if (Object.keys(data).length > 0) await recordMfg(actor, row.workspaceId, "supplier_edited", row.id, { name: saved.name });
  return supplierOf(saved);
}
