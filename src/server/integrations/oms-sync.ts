import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { isFeatureOn } from "@/server/services/features";
import { priceChanged, type ProductSnapshot } from "@/lib/oms/snapshot";
import { listProducts, OmsError } from "./oms";

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
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What a sheet holds in `external`, if it is a snapshot (a code and a name at least). */
function readExternal(raw: unknown): ProductSnapshot | null {
  if (!isObj(raw)) return null;
  return typeof raw["code"] === "string" && typeof raw["name"] === "string" ? (raw as unknown as ProductSnapshot) : null;
}

/** Reads the products of one company now and refreshes its linked sheets. No due-time and no switch check: the callers do those. */
export async function syncOrg(orgId: string, now: Date): Promise<OrgSyncResult> {
  const out: OrgSyncResult = { ok: false, refreshed: 0, missing: 0, ambiguous: 0, changed: 0 };
  // the attempt is noted BEFORE the call, so a failure also waits its five minutes
  const integ = await db.integration.findUnique({ where: { orgId_type: { orgId, type: "OMS" } }, select: { id: true, config: true } });
  if (!integ) return { ...out, errorCode: "not_connected" };
  await db.integration.update({ where: { id: integ.id }, data: { config: { ...(isObj(integ.config) ? integ.config : {}), lastAttemptAt: now.toISOString() } as Prisma.InputJsonValue } });

  let products: ProductSnapshot[];
  try {
    products = await listProducts(orgId);
  } catch (err) {
    return { ...out, errorCode: err instanceof OmsError ? err.code : "unknown" };
  }
  const stamped = products.map((p) => ({ ...p, fetchedAt: now.toISOString() }));

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
      if (priceChanged(prev, match)) out.changed += 1;
      // `missingSince` is not in the new snapshot: a product that is back is clean
      await db.card.update({ where: { id: card.id }, data: { external: match as unknown as Prisma.InputJsonValue, updatedAt: card.updatedAt } });
      out.refreshed += 1;
    } else if (stamped.length > 0 && !prev.missingSince) {
      await db.card.update({ where: { id: card.id }, data: { external: { ...prev, missingSince: now.toISOString() } as unknown as Prisma.InputJsonValue, updatedAt: card.updatedAt } });
      out.missing += 1;
    }
  }
  await db.integration.update({ where: { id: integ.id }, data: { lastSyncAt: now } });
  return { ...out, ok: true };
}

/** The job: each connected company whose switch is on and whose five minutes have passed. */
export async function runOmsSync(now: Date = new Date()): Promise<OmsSyncRun> {
  const run: OmsSyncRun = { orgs: 0, refreshed: 0, missing: 0, ambiguous: 0, changed: 0, failed: 0 };
  const rows = await db.integration.findMany({ where: { type: "OMS", connected: true }, select: { orgId: true, lastSyncAt: true, config: true } });
  const dueBefore = now.getTime() - OMS_SYNC_EVERY_MS;
  for (const row of rows) {
    const attempt = isObj(row.config) && typeof row.config["lastAttemptAt"] === "string" ? Date.parse(row.config["lastAttemptAt"]) : NaN;
    const last = Math.max(row.lastSyncAt?.getTime() ?? 0, Number.isFinite(attempt) ? attempt : 0);
    if (last > dueBefore) continue;
    if (!(await isFeatureOn(row.orgId, "omsLink"))) continue;
    run.orgs += 1;
    try {
      const r = await syncOrg(row.orgId, now);
      run.refreshed += r.refreshed;
      run.missing += r.missing;
      run.ambiguous += r.ambiguous;
      run.changed += r.changed;
      if (!r.ok) run.failed += 1;
    } catch (err) {
      run.failed += 1;
      log.error("oms.sync_crashed", { org: row.orgId, name: err instanceof Error ? err.name : "error" });
    }
  }
  return run;
}
