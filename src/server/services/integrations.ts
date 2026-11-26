import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { Prisma } from "@prisma/client";
import type { IntegrationType } from "@prisma/client";
import { decryptSecrets, encryptSecrets } from "@/server/crypto";
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/server/net-guard";
import { unixSeconds, zakiSignatureHeader } from "@/server/webhook-signing";
import { requireOrgMember, ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { can } from "@/server/policy/capabilities";

/** Connect/disconnect/config changes (org-level assets): the `integrations.manage` capability. */
export async function assertOrgManager(orgId: string): Promise<OrgAccessContext> {
  // Integrations (n8n, Telegram, Google Drive) belong to whoever holds the capability: the OWNER,
  // an ADMIN by default, or anybody the owner switched it on for (e.g. the automation person).
  const ctx = await requireOrgMember(orgId);
  const member = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: ctx.userId } },
    select: { role: true, status: true, capabilities: true, revokedCapabilities: true, spaceOnly: true },
  });
  if (!member || member.status !== "ACTIVE" || !can(member, "integrations.manage")) {
    throw new ForbiddenError("insufficient_role");
  }
  return ctx;
}

/**
 * The caller's active org = their oldest membership (same rule as ideas).
 * Shared by every /api/integrations route.
 */
export async function activeOrgCtx(): Promise<OrgAccessContext> {
  const actor = await requireActor();
  return { orgId: actor.orgId, orgRole: actor.role, userId: actor.userId };
}

export interface IntegrationConfigMeta extends Record<string, unknown> {}

/**
 * Returns the existing integration row for the org or null when never set up.
 * Secrets stay encrypted at rest and are never part of returned objects.
 */
export async function getIntegration(orgId: string, type: IntegrationType) {
  return db.integration.findUnique({
    where: { orgId_type: { orgId, type } },
  });
}

export async function requireConnected(orgId: string, type: IntegrationType) {
  const row = await getIntegration(orgId, type);
  if (!row || !row.connected || !row.secretEnc) {
    throw new NotFoundError("integration.not_connected");
  }
  const secrets = decryptSecrets<Record<string, string>>(row.secretEnc);
  if (!secrets) throw new NotFoundError("integration.bad_secret");
  return { row, secrets };
}

/**
 * Creates or updates an integration row.
 *   secrets: {...}     encrypt and store
 *   secrets: null      DROP the stored secret (a disconnect). The row stays, so the
 *                      conversation history that hangs off it is not cascade-deleted.
 *   secrets omitted    leave the stored secret alone
 */
export async function upsertIntegration(
  orgId: string,
  type: IntegrationType,
  data: { connected: boolean; secrets?: Record<string, unknown> | null; config?: Prisma.InputJsonValue; lastSyncAt?: Date },
) {
  const secretEnc = data.secrets ? encryptSecrets(data.secrets) : undefined;
  if (secretEnc === undefined && data.secrets === undefined && !data.connected) {
    // disconnect: drop stored secrets entirely
    await db.integration.deleteMany({ where: { orgId, type } });
    return null;
  }
  return db.integration.upsert({
    where: { orgId_type: { orgId, type } },
    create: {
      orgId,
      type,
      connected: data.connected,
      secretEnc,
      config: data.config,
    },
    update: {
      connected: data.connected,
      ...(secretEnc !== undefined ? { secretEnc } : data.secrets === null ? { secretEnc: null } : {}),
      ...(data.config !== undefined ? { config: data.config } : {}),
      ...(data.lastSyncAt !== undefined ? { lastSyncAt: data.lastSyncAt } : {}),
    },
  });
}

/** Logs an integration event; failures are recorded, never hidden, never thrown. */
export async function logEvent(
  orgId: string,
  input: { direction: "OUT" | "IN"; type: string; payload?: Prisma.InputJsonValue; status?: "OK" | "FAILED"; detail?: string },
): Promise<void> {
  try {
    await db.integrationEvent.create({
      data: {
        orgId,
        direction: input.direction,
        type: input.type,
        payload: input.payload,
        status: input.status ?? "OK",
        detail: input.detail,
      },
    });
  } catch {
    // logging must never crash the caller
  }
}

/**
 * Outbound webhook delivery, signed the way every Zaki system signs (see
 * webhook-signing.ts):
 *   X-Zaki-Event, X-Zaki-Delivery (uuid), X-Zaki-Timestamp (unix seconds),
 *   X-Zaki-Signature = sha256=HMAC(secret, "<timestamp>.<raw body>").
 * The shared secret itself is NEVER sent: the receiver holds its own copy and
 * recomputes the signature (it refuses anything more than five minutes old).
 * X-Zaki-Org is a routing id, not a secret, and stays.
 *
 * The URL is checked again here, right before the request, because DNS answers
 * and old saved rows change after the save-time check; redirects are not followed
 * (a webhook that redirects is a webhook pointed somewhere else).
 *
 * Fire-and-audit: the caller's business logic never fails because of n8n.
 */
export async function emitOutbound(orgId: string, event: string, payload: unknown): Promise<void> {
  const row = await getIntegration(orgId, "N8N");
  if (!row?.connected || !row.secretEnc) return;
  const meta = (row.config ?? {}) as { webhookUrl?: string; events?: string[] };
  const secrets = decryptSecrets<{ sharedSecret: string }>(row.secretEnc);
  if (!meta.webhookUrl || !secrets?.sharedSecret) return;
  const events = meta.events ?? [];
  if (events.length && !events.includes(event)) return;

  const body = JSON.stringify({ event, orgId, at: new Date().toISOString(), payload });
  const record = (status: "OK" | "FAILED", detail?: string) =>
    logEvent(orgId, { direction: "OUT", type: event, payload: payload as Prisma.InputJsonValue, status, detail });

  let target: URL;
  try {
    target = await assertPublicHttpsUrl(meta.webhookUrl);
  } catch (err) {
    // `n8n.url_<reason>` is also the i18n key explaining why
    await record("FAILED", err instanceof UnsafeUrlError ? `n8n.url_${err.code}` : "n8n.url_invalid");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const timestamp = unixSeconds();
    const res = await fetch(target.href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Zaki-Event": event,
        "X-Zaki-Delivery": randomUUID(),
        "X-Zaki-Timestamp": timestamp,
        "X-Zaki-Signature": zakiSignatureHeader(secrets.sharedSecret, timestamp, body),
        "X-Zaki-Org": orgId,
      },
      body,
      signal: controller.signal,
      redirect: "manual",
    });
    // the answer's body is of no interest: release the connection
    void res.body?.cancel().catch(() => undefined);
    const redirected = res.status >= 300 && res.status < 400;
    await record(res.ok ? "OK" : "FAILED", res.ok ? undefined : redirected ? `HTTP ${res.status} (redirect not followed)` : `HTTP ${res.status}`);
  } catch (err) {
    await record("FAILED", err instanceof Error ? err.message.slice(0, 200) : "network error");
  } finally {
    clearTimeout(timer);
  }
}
