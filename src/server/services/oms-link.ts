import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, audit } from "@/server/auth";
import { decryptSecrets, encryptSecrets, encryptionKeyConfigured } from "@/server/crypto";
import type { Actor } from "@/server/policy/actor";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { assertOmsBaseUrl, OmsError } from "@/server/integrations/oms";
import { syncOrg } from "@/server/integrations/oms-sync";

/**
 * «ربط نظام الطلبات» — the card under «التكاملات» (Q1.0). The OWNER's alone: the token reads the company's products and orders and
 * may write a note on an order, so only the owner types it. The switch `omsLink` is OFF until the owner turns it on; off, the routes
 * answer «not found» (taking the link out still works, so a credential can always be removed).
 *
 * The token is typed once, stored encrypted in `Integration.secretEnc` ({ token }) and never selected into an answer: the card is
 * only ever told «محفوظ». The address and the token's end date are plain settings in `Integration.config`. ⚠️ A system token lives 90
 * days: the card says the day it ends and warns 14 days before. 🔧 The owner issues a new one and pastes it over the old.
 */

export const TOKEN_WARN_DAYS = 14;

export interface OmsStatusDTO {
  switchOn: boolean;
  keyConfigured: boolean;
  connected: boolean;
  tokenSaved: boolean;
  baseUrl: string | null;
  /** `YYYY-MM-DD`, typed by the owner when he issued the token. */
  tokenExpiresAt: string | null;
  daysLeft: number | null;
  tokenWarn: boolean;
  lastSyncAt: string | null;
  /** The code of the newest failure since the last good read (`http_401`, `timeout`…), never the other side's words. */
  lastErrorCode: string | null;
  /** Sheets that carry a snapshot, and those whose product is gone from the orders system. */
  linked: number;
  missing: number;
}

export interface OmsInput {
  baseUrl: string;
  /** Absent or empty on a save that keeps the saved one. Never returned. */
  token?: string | undefined;
  tokenExpiresAt?: string | null | undefined;
}

function assertOwner(actor: Pick<Actor, "isOwner">): void {
  if (!actor.isOwner) throw new ForbiddenError("oms.owner_only");
}

function refuse(path: string, key: string): never {
  throw new ValidationError([{ path, message: key }]);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whole days from `now` to the start of the day the token ends (negative once it has ended). */
export function daysLeftOf(tokenExpiresAt: string | null, now: Date = new Date()): number | null {
  if (!tokenExpiresAt) return null;
  const at = Date.parse(`${tokenExpiresAt}T00:00:00Z`);
  return Number.isFinite(at) ? Math.floor((at - now.getTime()) / 86_400_000) : null;
}

export async function getOmsStatus(actor: Actor, now: Date = new Date()): Promise<OmsStatusDTO> {
  assertOwner(actor);
  const [switchOn, row] = await Promise.all([
    isFeatureOn(actor.orgId, "omsLink"),
    db.integration.findUnique({ where: { orgId_type: { orgId: actor.orgId, type: "OMS" } }, select: { connected: true, secretEnc: true, config: true, lastSyncAt: true } }),
  ]);
  const config = row && isObj(row.config) ? row.config : {};
  const tokenExpiresAt = typeof config["tokenExpiresAt"] === "string" ? config["tokenExpiresAt"] : null;
  const daysLeft = daysLeftOf(tokenExpiresAt, now);
  const failure = await db.integrationEvent.findFirst({
    where: { orgId: actor.orgId, status: "FAILED", type: { startsWith: "oms." }, ...(row?.lastSyncAt ? { createdAt: { gt: row.lastSyncAt } } : {}) },
    orderBy: { createdAt: "desc" },
    select: { detail: true },
  });
  const [linked, missing] = await Promise.all([
    db.card.count({ where: { orgId: actor.orgId, external: { not: Prisma.DbNull } } }),
    db.card.count({ where: { orgId: actor.orgId, external: { path: ["missingSince"], not: Prisma.DbNull } } }),
  ]);
  return {
    switchOn,
    keyConfigured: encryptionKeyConfigured(),
    connected: row?.connected === true,
    tokenSaved: !!row?.secretEnc,
    baseUrl: typeof config["baseUrl"] === "string" ? config["baseUrl"] : null,
    tokenExpiresAt,
    daysLeft,
    tokenWarn: daysLeft !== null && daysLeft <= TOKEN_WARN_DAYS,
    lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
    lastErrorCode: failure?.detail?.replace(/^oms\./, "") ?? null,
    linked,
    missing,
  };
}

export async function saveOmsConfig(actor: Actor, input: OmsInput): Promise<void> {
  assertOwner(actor);
  await assertFeatureOn(actor.orgId, "omsLink");
  // the token is stored encrypted or not at all: no key, no save
  if (!encryptionKeyConfigured()) refuse("token", "oms.err.no_key");
  let baseUrl: string;
  try {
    baseUrl = await assertOmsBaseUrl(input.baseUrl);
  } catch (err) {
    refuse("baseUrl", err instanceof OmsError ? `oms.error.${err.code}` : "oms.error.url_invalid");
  }
  const token = input.token?.trim() ? input.token.trim() : null;
  const existing = await db.integration.findUnique({ where: { orgId_type: { orgId: actor.orgId, type: "OMS" } }, select: { secretEnc: true, config: true } });
  if (!existing?.secretEnc && token === null) refuse("token", "oms.err.token_required");
  const expires = input.tokenExpiresAt ?? null;
  if (expires !== null && !Number.isFinite(Date.parse(`${expires}T00:00:00Z`))) refuse("tokenExpiresAt", "oms.err.bad_date");
  const config = { ...(existing && isObj(existing.config) ? existing.config : {}), baseUrl, tokenExpiresAt: expires, connectedById: actor.userId } as Prisma.InputJsonValue;
  await db.integration.upsert({
    where: { orgId_type: { orgId: actor.orgId, type: "OMS" } },
    create: { orgId: actor.orgId, type: "OMS", connected: true, secretEnc: encryptSecrets({ token }), config },
    update: { connected: true, config, ...(token !== null ? { secretEnc: encryptSecrets({ token }) } : {}) },
  });
  // the audit row says THAT it changed, nothing of what was typed
  await audit("oms_link.saved", { actorId: actor.userId, orgId: actor.orgId, target: actor.orgId });
}

/** Takes the link out: the token is deleted with it. Allowed while the switch is off too. */
export async function removeOmsConfig(actor: Actor): Promise<void> {
  assertOwner(actor);
  await db.integration.deleteMany({ where: { orgId: actor.orgId, type: "OMS" } });
  await audit("oms_link.removed", { actorId: actor.userId, orgId: actor.orgId, target: actor.orgId });
}

export interface OmsSyncNowDTO {
  ok: boolean;
  errorCode?: string;
  refreshed: number;
  missing: number;
  ambiguous: number;
}

/** «اقرأي هلّق»: reads the products now, without waiting for the five minutes. */
export async function syncOmsNow(actor: Actor, now: Date = new Date()): Promise<OmsSyncNowDTO> {
  assertOwner(actor);
  await assertFeatureOn(actor.orgId, "omsLink");
  const row = await db.integration.findUnique({ where: { orgId_type: { orgId: actor.orgId, type: "OMS" } }, select: { connected: true, secretEnc: true } });
  if (!row?.connected || !row.secretEnc || !decryptSecrets(row.secretEnc)) throw new NotFoundError("integration.not_connected");
  const r = await syncOrg(actor.orgId, now);
  return { ok: r.ok, ...(r.errorCode ? { errorCode: r.errorCode } : {}), refreshed: r.refreshed, missing: r.missing, ambiguous: r.ambiguous };
}
