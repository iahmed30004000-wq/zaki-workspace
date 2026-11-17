import { z } from "zod";
import { db } from "@/server/db";
import type { OrgRole, Prisma } from "@prisma/client";
import { ValidationError } from "@/server/auth";
import { can } from "@/server/policy/capabilities";
import { activeMember } from "@/server/services/active-people";
import { decryptSecrets, generateSharedSecret, safeEqual } from "@/server/crypto";
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/server/net-guard";
import { verifyZakiSignature } from "@/server/webhook-signing";
import {
  emitOutbound,
  getIntegration,
  logEvent,
  upsertIntegration,
} from "@/server/services/integrations";

/** Events we allow orgs to forward to n8n — the UI shows exactly this list. */
export const N8N_EVENTS = [
  "task.created",
  "task.completed",
  "task.moved",
  "idea.created",
  "idea.accepted",
  "idea.rejected",
  "comment.created",
  "member.joined",
] as const;

export type N8nEvent = (typeof N8N_EVENTS)[number];

export function isN8nEvent(value: string): value is N8nEvent {
  return (N8N_EVENTS as readonly string[]).includes(value);
}

export interface N8nStatus {
  connected: boolean;
  webhookUrl: string | null;
  events: string[];
  sharedSecret: string | null; // masked client-side (shown copy-once on connect)
}

/**
 * Throws a ValidationError (422, details.path = webhookUrl) carrying a specific i18n key -
 * n8n.url_invalid | url_https_only | url_credentials | url_private | url_unresolvable -
 * unless the URL is a public https endpoint (see net-guard.ts).
 */
export async function assertWebhookUrl(url: string): Promise<void> {
  try {
    await assertPublicHttpsUrl(url);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new ValidationError([{ path: "webhookUrl", message: `n8n.url_${err.code}` }]);
    throw err;
  }
}

/** Config save (for whoever holds `integrations.manage`; the route checks): webhook URL + event filter; generates the secret once. */
export async function configureN8n(
  orgId: string,
  input: { webhookUrl: string; events: string[]; rotateSecret?: boolean },
): Promise<N8nStatus & { generatedSecret?: string }> {
  // An unsafe URL is refused before anything is stored - and before the secret is touched.
  await assertWebhookUrl(input.webhookUrl);

  // keep the existing shared secret while connected (unless rotated), otherwise mint one
  const currentSecret = input.rotateSecret ? null : await readSharedSecret(orgId);
  const sharedSecret = currentSecret ?? generateSharedSecret();

  const meta: Prisma.InputJsonValue = {
    webhookUrl: input.webhookUrl,
    events: input.events.filter(isN8nEvent),
  };
  const secretsBlob: Record<string, string> = { sharedSecret };

  await upsertIntegration(orgId, "N8N", {
    connected: Boolean(input.webhookUrl),
    secrets: secretsBlob,
    config: meta,
  });
  await logEvent(orgId, { direction: "IN", type: "n8n.configured", payload: { events: meta.events } });

  const status = await getN8nStatus(orgId);
  return { ...status, generatedSecret: currentSecret ? undefined : sharedSecret };
}

/**
 * The org's shared secret, only while n8n is connected: a removed connection has no
 * secret to authenticate with, and connecting again starts from a fresh one.
 */
async function readSharedSecret(orgId: string): Promise<string | null> {
  const row = await getIntegration(orgId, "N8N");
  if (!row?.connected || !row.secretEnc) return null;
  return decryptSecrets<{ sharedSecret: string }>(row.secretEnc)?.sharedSecret ?? null;
}

/**
 * Does `viewer` hold `integrations.manage` in this org? `viewer` is the person asking:
 *  - `{ userId }` (the route's context has one): judged by their own switches, as an ACTIVE member;
 *  - a bare role such as "MEMBER": only what the rank gives by default (the OWNER and ADMIN hold it);
 *  - omitted: the caller already knows it is a manager.
 */
async function viewerManagesIntegrations(orgId: string, viewer: string | { userId: string } | undefined): Promise<boolean> {
  if (viewer === undefined) return true;
  // an unknown role string holds nothing (the default set of a role that does not exist is empty)
  if (typeof viewer === "string") return can({ role: viewer as OrgRole }, "integrations.manage");
  const member = await activeMember(orgId, viewer.userId);
  return member !== null && can(member, "integrations.manage");
}

/**
 * The connection state. The webhook URL (its path can act as a secret) and the event filter are
 * the business of whoever holds the `integrations.manage` capability (see `viewerManagesIntegrations`
 * for how `viewer` is read): everybody else gets only the connected flag and the stored-secret
 * marker. Leave `viewer` out only when the caller already knows it is a manager (configureN8n
 * answering the manager who just saved).
 */
export async function getN8nStatus(orgId: string, viewer?: string | { userId: string }): Promise<N8nStatus> {
  const row = await getIntegration(orgId, "N8N");
  if (!row) return { connected: false, webhookUrl: null, events: [], sharedSecret: null };
  const meta = (row.config ?? {}) as { webhookUrl?: string; events?: string[] };
  const manager = await viewerManagesIntegrations(orgId, viewer);
  return {
    connected: row.connected && Boolean(meta.webhookUrl),
    webhookUrl: manager ? meta.webhookUrl ?? null : null,
    events: manager ? meta.events ?? [] : [],
    sharedSecret: row.secretEnc ? "__stored__" : null,
  };
}

export async function disconnectN8n(orgId: string): Promise<void> {
  await upsertIntegration(orgId, "N8N", { connected: false, secrets: null });
  await logEvent(orgId, { direction: "OUT", type: "n8n.disconnected" });
}

export async function recentEvents(orgId: string, take = 12) {
  return db.integrationEvent.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, direction: true, type: true, status: true, detail: true, createdAt: true },
  });
}

const inboundSchema = z.object({
  // n8n sends {action}, generic senders may send {event} — both accepted
  action: z.string().min(1).optional(),
  event: z.string().min(1).optional(),
  title: z.string().min(1).max(180).optional(),
  description: z.string().max(4000).optional(),
  workspaceId: z.string().min(3).optional(),
  projectId: z.string().min(3).optional(),
  boardId: z.string().min(3).optional(),
});

export interface InboundResult {
  ok: boolean;
  status: number;
  body:
    | { ok: true; action: string; taskId?: string; ignored?: boolean }
    // `reason` is a machine code for the sender's logs (clock skew, wrong secret, ...); never a secret
    | { ok: false; error: string; reason?: string };
}

/** The credentials a caller may present; which form it used decides how they are checked. */
export interface InboundAuth {
  /** Legacy: the shared secret itself (x-zaki-token). */
  token?: string | null;
  /** Signed form: x-zaki-timestamp + x-zaki-signature over "<timestamp>.<raw body>". */
  timestamp?: string | null;
  signature?: string | null;
}

/**
 * Inbound webhook from n8n (or any script). Two ways to prove who is calling:
 *
 *  1. Signed (preferred): X-Zaki-Timestamp + X-Zaki-Signature = sha256=HMAC(secret,
 *     "<timestamp>.<raw body>"). A timestamp more than five minutes from our clock, either
 *     way, is refused, so a captured request cannot be replayed later. If a signature is
 *     present it must verify - a valid token beside a bad signature does not rescue it.
 *  2. Legacy: the shared secret itself in x-zaki-token (constant-time compare), kept so
 *     existing workflows keep working.
 *
 * The org must be connected: a removed connection stops authenticating at once. Failures
 * are uniform - an unknown org, a disconnected org and a wrong secret are indistinguishable.
 * `rawBody` is the body exactly as received (the signature covers its bytes).
 *
 * Only `action: "createTask"` is implemented today; unknown actions are
 * acknowledged-but-ignored so workflows never hard-fail.
 */
export async function handleInbound(
  orgId: string,
  auth: InboundAuth,
  rawBody: string,
  now: Date = new Date(),
): Promise<InboundResult> {
  const denied = (reason: string): InboundResult => ({ ok: false, status: 401, body: { ok: false, error: "n8n.unauthorized", reason } });

  const secret = await readSharedSecret(orgId); // null: no such org, not connected, or unreadable

  if (auth.signature?.trim()) {
    const verdict = verifyZakiSignature({
      secret,
      timestampHeader: auth.timestamp,
      signatureHeader: auth.signature,
      rawBody,
      now,
    });
    if (!verdict.ok) return denied(verdict.reason.toLowerCase());
  } else if (auth.token?.trim()) {
    if (!secret || !safeEqual(auth.token.trim(), secret)) return denied("bad_token");
  } else {
    return denied("missing_credentials");
  }

  let json: unknown = null;
  try {
    json = JSON.parse(rawBody);
  } catch {
    json = null;
  }
  const parsed = inboundSchema.safeParse(json);
  if (!parsed.success) {
    await logEvent(orgId, {
      direction: "IN",
      type: "n8n.inbound",
      status: "FAILED",
      detail: parsed.error.issues.map((i) => i.path.join(".")).join(",") || "invalid",
    });
    return { ok: false, status: 400, body: { ok: false, error: "n8n.invalid_payload" } };
  }

  const action = parsed.data.action ?? parsed.data.event ?? "";
  if (action !== "createTask") {
    await logEvent(orgId, { direction: "IN", type: `n8n.inbound.${action || "ping"}`, payload: parsed.data as Prisma.InputJsonValue });
    return { ok: true, status: 200, body: { ok: true, action, ignored: true } };
  }

  if (!parsed.data.title || !parsed.data.workspaceId || !parsed.data.projectId || !parsed.data.boardId) {
    await logEvent(orgId, { direction: "IN", type: "n8n.inbound", status: "FAILED", detail: "missing task fields" });
    return { ok: false, status: 400, body: { ok: false, error: "n8n.create_task_requires_fields" } };
  }

  // The webhook has no human actor — the (oldest) ACTIVE org OWNER acts on its behalf. A suspended or
  // offboarded owner does not: with none active left the webhook refuses (n8n.no_owner).
  const owner = await db.organizationMember.findFirst({
    where: { organizationId: orgId, role: "OWNER", status: "ACTIVE" },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) {
    return { ok: false, status: 503, body: { ok: false, error: "n8n.no_owner" } };
  }

  const { createTask } = await import("@/server/services/tasks");
  try {
    const task = await createTask(
      { userId: owner.userId, orgId },
      {
        visibility: "SPACE",
        workspaceId: parsed.data.workspaceId,
        projectId: parsed.data.projectId,
        boardId: parsed.data.boardId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
      },
    );
    await logEvent(orgId, { direction: "IN", type: "n8n.inbound", payload: { taskId: task.id } });
    return { ok: true, status: 201, body: { ok: true, action: "createTask", taskId: task.id } };
  } catch (err) {
    await logEvent(orgId, {
      direction: "IN",
      type: "n8n.inbound",
      status: "FAILED",
      detail: err instanceof Error ? err.message.slice(0, 200) : "task create failed",
    });
    return { ok: false, status: 400, body: { ok: false, error: "n8n.create_task_failed" } };
  }
}

export async function dispatchEvent(orgId: string, event: N8nEvent, payload: unknown): Promise<void> {
  await emitOutbound(orgId, event, payload);
}

/** Sends a self-describing test payload through the exact production path. */
export async function sendTestPayload(orgId: string): Promise<{ delivered: boolean; detail?: string }> {
  const row = await getIntegration(orgId, "N8N");
  if (!row?.connected) return { delivered: false, detail: "integration.not_connected" };
  await emitOutbound(orgId, "n8n.test", { message: "Zaki Workspace test event" });
  const recent = await db.integrationEvent.findFirst({
    where: { orgId, direction: "OUT", type: "n8n.test" },
    orderBy: { createdAt: "desc" },
    select: { status: true, detail: true },
  });
  return { delivered: recent?.status === "OK", detail: recent?.detail ?? undefined };
}
