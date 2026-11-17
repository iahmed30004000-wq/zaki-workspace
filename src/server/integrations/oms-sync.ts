import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { isFeatureOn } from "@/server/services/features";
import { knowledgeSettingsOf } from "@/lib/cards/knowledge-settings";
import { emptyProductData, templateFor } from "@/lib/cards/product-templates";
import { positionOnTop } from "@/lib/cards/order";
import { priceChanged, type ProductSnapshot, type ProductsRead } from "@/lib/oms/snapshot";
import { OmsError, readProductList } from "./oms";

/**
 * THE SYNC OF THE ORDERS SYSTEM (Q1.0): every 5 minutes, for each company that connected it and turned `omsLink` on, read the
 * products and write the snapshot of each sheet that is ALREADY linked (`Card.external`).
 *
 *  - It writes `Card.external` only: no `CardRevision`, no `version`, and `updatedAt` is left where it was — a refreshed price is not an
 *    edit of the sheet. It never deletes a sheet, never creates one (a draft for a product that has none is Q1.1's), and never
 *    touches a sheet of another company or one that is not linked.
 *  - LINKING: by the product's `id` once the door gives it, else by code AND name. A code is unique per store only: when two products
 *    share it and the sheet has no id, nothing is linked by itself (counted as `ambiguous`).
 *  - A product that is gone from the answer marks its sheet (`missingSince`), keeping the last price and its old `fetchedAt` (so it
 *    reads as stale); it comes back clean. An EMPTY answer marks nothing: it is never read as «every product is gone».
 *  - DRAFT SHEETS (Q1.1): while `knowledgeCards` is on and a knowledge space is set, each product that has NO sheet gets one: a DRAFT PRODUCT card
 *    in that space (the template of its category, no caution), its snapshot in `external`, authored by the person who connected the orders system
 *    (the primary owner when he is no longer active). Never for a product whose code another product shares (an editor chooses), never twice,
 *    and never again for a sheet an editor deleted (the deleted card still carries its snapshot, so the product counts as having one).
 *  - A row the door sent but that could not be READ (a price that is text, a code that is missing) never marks its sheet gone: the sheet
 *    is only marked when its product is truly absent from the answer. An answer that is not a LIST at all is a failed read (`bad_body`).
 *  - Two processes: the five-minute claim is ONE conditional write (the integration row's `updatedAt` must still be the one that was read),
 *    so only one of them does the work, and `changed` is counted once. A sheet edited by a person while the sync runs is skipped this time
 *    (its `updatedAt` is never moved back); `external` is replaced whole, so anything else a sheet keeps belongs in `Card.data`.
 *  - A failure leaves the last snapshot, an `IntegrationEvent` (FAILED, `oms.<code>`, written by the client) and `lastSyncAt` where it
 *    was. The five-minute wait counts from the last ATTEMPT (`config.lastAttemptAt`), so a system that is down is not asked every tick.
 *  - `changed` counts the sheets whose price or offers moved: Q1.6 turns it into the «لازم ينقرأ» notice. No price is written anywhere
 *    but the snapshot.
 */

export const OMS_SYNC_EVERY_MS = 5 * 60_000;

export interface OmsSyncRun {
  /** Companies that were read this time. */
  orgs: number;
  /** Sheets whose snapshot was rewritten. */
  refreshed: number;
  /** Sheets newly marked «مش موجود بنظام الطلبات». */
  missing: number;
  /** Sheets left alone because two products share their code. */
  ambiguous: number;
  /** Sheets whose price or offers differ from the snapshot before. */
  changed: number;
  /** Draft sheets made for products that had none. */
  drafts: number;
  /** Companies whose read failed. */
  failed: number;
}

export interface OrgSyncResult {
  ok: boolean;
  /** The code of the failure (`http_401`, `timeout`…), never the other side's words. */
  errorCode?: string;
  refreshed: number;
  missing: number;
  ambiguous: number;
  changed: number;
  /** Draft sheets made for products that had none. */
  drafts?: number;
  /** True when another process had already claimed this round: nothing was read. */
  skipped?: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What a sheet holds in `external`, if it is a snapshot (a code and a name at least). */
function readExternal(raw: unknown): ProductSnapshot | null {
  if (!isObj(raw)) return null;
  return typeof raw["code"] === "string" && typeof raw["name"] === "string" ? (raw as unknown as ProductSnapshot) : null;
}

/** Does a sheet already stand for this product? By id when the sheet has one, else by code and name. */
function hasSheet(product: ProductSnapshot, sheets: ProductSnapshot[]): boolean {
  return sheets.some((s) => (s.id ? s.id === product.id : s.code === product.code && s.name === product.name));
}

/** A DRAFT sheet for each product that has none (see the header). Returns how many were made. */
async function makeDrafts(orgId: string, products: ProductSnapshot[], sheets: ProductSnapshot[], connectedById: unknown): Promise<number> {
  if (products.length === 0 || !(await isFeatureOn(orgId, "knowledgeCards"))) return 0;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const settings = knowledgeSettingsOf(org?.settings ?? {});
  if (!settings.spaceId) return 0;
  const space = await db.workspace.findFirst({ where: { id: settings.spaceId, organizationId: orgId, archivedAt: null }, select: { id: true } });
  if (!space) return 0;
  // the author: the person who connected the system if he is still active, else the primary owner
  let authorId: string | null = null;
  if (typeof connectedById === "string") {
    const m = await db.organizationMember.findFirst({ where: { organizationId: orgId, userId: connectedById, status: "ACTIVE" }, select: { userId: true } });
    authorId = m?.userId ?? null;
  }
  if (!authorId) {
    const owner = await db.organizationMember.findFirst({ where: { organizationId: orgId, status: "ACTIVE", role: "OWNER" }, orderBy: [{ primaryOwner: "desc" }, { createdAt: "asc" }], select: { userId: true } });
    authorId = owner?.userId ?? null;
  }
  if (!authorId) return 0;
  const codeCount = new Map<string, number>();
  for (const p of products) codeCount.set(p.code, (codeCount.get(p.code) ?? 0) + 1);
  let made = 0;
  for (const p of products) {
    if ((codeCount.get(p.code) ?? 0) > 1 || hasSheet(p, sheets)) continue;
    const first = await db.card.findFirst({ where: { workspaceId: space.id, archivedAt: null }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { position: true } });
    const category = p.category ?? null;
    await db.card.create({
      data: {
        orgId,
        workspaceId: space.id,
        createdById: authorId,
        kind: "PRODUCT",
        title: p.name.slice(0, 140),
        category: category ? category.slice(0, 40) : null,
        data: emptyProductData(templateFor(category, settings.templates)) as unknown as Prisma.InputJsonValue,
        external: p as unknown as Prisma.InputJsonValue,
        status: "DRAFT",
        position: positionOnTop(first?.position),
      },
    });
    made += 1;
  }
  return made;
}

/** The sheet's product was in the answer but could not be read (by id, or by code): it is not gone. */
function stillThere(prev: ProductSnapshot, read: ProductsRead): boolean {
  return (!!prev.id && read.unreadable.ids.has(prev.id)) || (!prev.id && read.unreadable.codes.has(prev.code));
}

/** Reads the products of one company now and refreshes its linked sheets. No due-time and no switch check: the callers do those. */
export async function syncOrg(orgId: string, now: Date, claim?: { updatedAt: Date }): Promise<OrgSyncResult> {
  const out: OrgSyncResult = { ok: false, refreshed: 0, missing: 0, ambiguous: 0, changed: 0, drafts: 0 };
  // the attempt is noted BEFORE the call, so a failure also waits its five minutes
  const integ = await db.integration.findUnique({ where: { orgId_type: { orgId, type: "OMS" } }, select: { id: true, config: true } });
  if (!integ) return { ...out, errorCode: "not_connected" };
  // ONE conditional write is both the note of the attempt and, for the job, the claim: whoever finds the row changed does nothing
  const claimed = await db.integration.updateMany({
    where: { id: integ.id, ...(claim ? { updatedAt: claim.updatedAt } : {}) },
    data: { config: { ...(isObj(integ.config) ? integ.config : {}), lastAttemptAt: now.toISOString() } as Prisma.InputJsonValue },
  });
  if (claimed.count === 0) return { ...out, ok: true, skipped: true };

  let read: ProductsRead;
  try {
    read = await readProductList(orgId);
  } catch (err) {
    return { ...out, errorCode: err instanceof OmsError ? err.code : "unknown" };
  }
  const stamped = read.products.map((p) => ({ ...p, fetchedAt: now.toISOString() }));

  const cards = await db.card.findMany({ where: { orgId, external: { not: Prisma.DbNull } }, select: { id: true, external: true, updatedAt: true } });
  for (const card of cards) {
    const prev = readExternal(card.external);
    if (!prev) continue;
    let match: ProductSnapshot | undefined;
    if (prev.id) {
      match = stamped.find((p) => p.id === prev.id);
    } else {
      const sameCode = stamped.filter((p) => p.code === prev.code);
      if (sameCode.length > 1) {
        out.ambiguous += 1;
        continue;
      }
      match = sameCode.find((p) => p.name === prev.name);
    }
    if (match) {
      // `missingSince` is not in the new snapshot: a product that is back is clean. The write holds only while nobody edited the sheet.
      const done = await db.card.updateMany({ where: { id: card.id, updatedAt: card.updatedAt }, data: { external: match as unknown as Prisma.InputJsonValue, updatedAt: card.updatedAt } });
      if (done.count > 0) {
        out.refreshed += 1;
        if (priceChanged(prev, match)) out.changed += 1;
      }
    } else if (stamped.length > 0 && !prev.missingSince && !stillThere(prev, read)) {
      const done = await db.card.updateMany({ where: { id: card.id, updatedAt: card.updatedAt }, data: { external: { ...prev, missingSince: now.toISOString() } as unknown as Prisma.InputJsonValue, updatedAt: card.updatedAt } });
      if (done.count > 0) out.missing += 1;
    }
  }
  try {
    out.drafts = await makeDrafts(orgId, stamped, cards.map((c) => readExternal(c.external)).filter((e): e is ProductSnapshot => e !== null), isObj(integ.config) ? integ.config["connectedById"] : null);
  } catch (err) {
    // a draft that could not be made never fails the read: the snapshots above are already written, the next round tries again
    log.error("oms.drafts_failed", { org: orgId, name: err instanceof Error ? err.name : "error" });
  }
  await db.integration.update({ where: { id: integ.id }, data: { lastSyncAt: now } });
  return { ...out, ok: true };
}

/** The job: each connected company whose switch is on and whose five minutes have passed. */
export async function runOmsSync(now: Date = new Date()): Promise<OmsSyncRun> {
  const run: OmsSyncRun = { orgs: 0, refreshed: 0, missing: 0, ambiguous: 0, changed: 0, drafts: 0, failed: 0 };
  const rows = await db.integration.findMany({ where: { type: "OMS", connected: true }, select: { orgId: true, lastSyncAt: true, config: true, updatedAt: true } });
  const dueBefore = now.getTime() - OMS_SYNC_EVERY_MS;
  for (const row of rows) {
    const attempt = isObj(row.config) && typeof row.config["lastAttemptAt"] === "string" ? Date.parse(row.config["lastAttemptAt"]) : NaN;
    const last = Math.max(row.lastSyncAt?.getTime() ?? 0, Number.isFinite(attempt) ? attempt : 0);
    if (last > dueBefore) continue;
    if (!(await isFeatureOn(row.orgId, "omsLink"))) continue;
    try {
      const r = await syncOrg(row.orgId, now, { updatedAt: row.updatedAt });
      if (r.skipped) continue;
      run.orgs += 1;
      run.refreshed += r.refreshed;
      run.missing += r.missing;
      run.ambiguous += r.ambiguous;
      run.changed += r.changed;
      run.drafts += r.drafts ?? 0;
      if (!r.ok) run.failed += 1;
    } catch (err) {
      run.orgs += 1;
      run.failed += 1;
      log.error("oms.sync_crashed", { org: row.orgId, name: err instanceof Error ? err.name : "error" });
    }
  }
  return run;
}
