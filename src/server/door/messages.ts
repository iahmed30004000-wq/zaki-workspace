import { db } from "@/server/db";
import { clientIp } from "@/server/rate-limit";
import { log } from "@/server/log";
import { can } from "@/server/policy/capabilities";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { isFeatureOn } from "@/server/services/features";
import { canMark } from "@/server/chat/must-read-policy";
import { resolveDoorTopic, storeAppCard } from "@/server/chat/door-message";
import { bearerOf, parseToken, permits, tokenMatches } from "@/server/door/tokens";
import { DoorError, safeErrorFacts } from "@/server/door/http";
import { DOOR_V2_LIMITS, failureLimiter, messageLimiter } from "@/server/door/limits";
import { IDEMPOTENCY_TTL_MS, parseDoorBody, requestHash, storedIdempotencyKey } from "@/server/door/payload";
import { cardBodyOf, disallowedButtonHosts, messageBodySchema, phoneFieldsOf, storedCardOf, type MessageBody } from "@/server/door/message-payload";
import type { DoorPrincipal } from "@/server/services/api-door";

/**
 * «باب الرسائل» (docs/contracts/workspace-door.v2.md): `POST /api/v2/messages`, the ONE endpoint of v2.
 *
 * The gate is v1's (`authenticateDoor`), in the same order and with the same answers, with three differences that are the reason it is written again here
 * instead of called: the switch is `doorMessages` (and the door's own master switch `apiDoor` must be on too: one kill switch for every door), the limit is
 * 120 a minute per token (v1's is 60 and counts v1 requests), and the permission is `messages.write`.
 *
 *  - the person the token acts for posts the card (`resolveDoorTopic`: reads the topic, may post in it); the bubble carries `viaApp` = the token's name;
 *  - every refusal after the token was accepted is also written as a FAILED `IntegrationEvent` (code only: never a value, a text or the token) so the owner sees it
 *    under «التكاملات»; one write per token per minute for the rate limit (a flood must not become a flood of rows).
 */

const UNAUTHORIZED = () => new DoorError(401, "door.unauthorized", "The token is missing, unknown, revoked, expired or no longer allowed.", undefined, { "www-authenticate": 'Bearer realm="zaki-door"' });
const TOUCH_EVERY_MS = 60_000;

export interface MessagesPrincipal extends DoorPrincipal {
  /** hosts a card button may point at (the owner's list, per token) */
  buttonHosts: string[];
}

/** Reads the token and decides whether it may post messages. Throws a `DoorError` (401, 404, 429, 403) like v1's gate. */
export async function authenticateMessages(req: Request, requestId: string): Promise<MessagesPrincipal> {
  const ip = clientIp(req);
  const blocked = failureLimiter.check(ip);
  const tooMany = () => new DoorError(429, "door.rate_limited", "Too many refused requests from this address.", undefined, { "retry-after": String(Math.max(1, blocked.retryAfterSec)) });
  const refuse = (reason: string, tokenId?: string): never => {
    if (!blocked.ok) throw tooMany();
    failureLimiter.hit(ip);
    log.warn("door.refused", { requestId, reason, tokenId, door: "v2" });
    throw UNAUTHORIZED();
  };

  const token = bearerOf(req.headers.get("authorization"));
  if (!token) return refuse("no_bearer");
  const parsed = parseToken(token);
  if (!parsed) return refuse("malformed");

  const row = await db.apiToken.findUnique({
    where: { prefix: parsed.prefix },
    select: { id: true, name: true, system: true, organizationId: true, workspaceId: true, createdById: true, permissions: true, tokenHash: true, expiresAt: true, lastUsedAt: true, revokedAt: true, buttonHosts: true },
  });
  if (!tokenMatches(token, row?.tokenHash ?? null) || !row) return refuse("unknown_or_wrong");
  const now = new Date();
  if (row.revokedAt) return refuse("revoked", row.id);
  if (row.expiresAt && row.expiresAt <= now) return refuse("expired", row.id);

  const issuer = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: row.organizationId, userId: row.createdById } },
    select: { role: true, status: true, capabilities: true, revokedCapabilities: true, primaryOwner: true },
  });
  // a BOT's token (docs/contracts/bots.md) is issued by the bot's own account, an ordinary member: it needs no «integrations.manage», but it must be the live token of a live bot
  // (this door only; the bot's token holds `messages.write` and nothing else, so no other door ever sees it)
  const botIssuer = row.system === "bot" ? await db.bot.findFirst({ where: { userId: row.createdById, orgId: row.organizationId, tokenId: row.id, deletedAt: null }, select: { id: true } }) : null;
  if (!issuer || issuer.status !== "ACTIVE" || issuer.role === "GUEST" || (!botIssuer && !can(issuer, "integrations.manage"))) return refuse("issuer_inactive", row.id);
  if (!(await accessibleWorkspaceIds(row.createdById)).includes(row.workspaceId)) return refuse("space_unreachable", row.id);

  // one kill switch for every door, and this door's own
  if (!(await isFeatureOn(row.organizationId, "apiDoor")) || !(await isFeatureOn(row.organizationId, "doorMessages"))) throw new DoorError(404, "door.not_found", "Not found.");

  const limited = messageLimiter.check(`t:${row.id}`);
  if (!limited.ok) {
    await failureRow(row.organizationId, row.id, "door.rate_limited");
    throw new DoorError(429, "door.rate_limited", "Too many requests for this token.", undefined, { "retry-after": String(Math.max(1, limited.retryAfterSec)) });
  }
  messageLimiter.hit(`t:${row.id}`);

  if (!permits(row.permissions, "messages.write")) {
    await failureRow(row.organizationId, row.id, "door.forbidden");
    throw new DoorError(403, "door.forbidden", "This token does not hold the permission messages.write.");
  }

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await db.apiToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { lastUsedAt: now } }).catch((err: unknown) => log.warn("door.touch_failed", { requestId, ...safeErrorFacts(err) }));
  }

  return {
    tokenId: row.id,
    tokenName: row.name,
    orgId: row.organizationId,
    issuerId: row.createdById,
    workspaceId: row.workspaceId,
    permissions: row.permissions,
    requestId,
    buttonHosts: row.buttonHosts ?? [],
  };
}

const lastRateRow = new Map<string, number>();

/**
 * A refusal the owner can see under «التكاملات»: the code only. ONE row per token per code per minute, for EVERY code (a sender that retries a refused request all day, or a
 * flood of them, must not become a flood of rows; the 120-a-minute limit would otherwise allow a row for each).
 */
async function failureRow(orgId: string, tokenId: string, code: string): Promise<void> {
  try {
    const throttleKey = `${tokenId}:${code}`;
    const last = lastRateRow.get(throttleKey) ?? 0;
    if (Date.now() - last < 60_000) return;
    if (lastRateRow.size > 1000) lastRateRow.clear();
    lastRateRow.set(throttleKey, Date.now());
    await db.integrationEvent.create({ data: { orgId, direction: "IN", type: "door.message", status: "FAILED", detail: code.slice(0, 80) } });
  } catch (err) {
    log.warn("door.failure_row_failed", safeErrorFacts(err));
  }
}

export interface PostedMessage {
  status: number;
  body: unknown;
  replayed: boolean;
}

function isUniqueViolation(err: unknown, field: string): boolean {
  if (typeof err !== "object" || err === null || (err as { code?: unknown }).code !== "P2002") return false;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? "").includes(field);
}

/** Validates, then posts once however often the sender retries (the record of the answer is born in the SAME transaction as the card). */
export async function doorPostMessage(who: MessagesPrincipal, clientKey: string, rawBody: unknown): Promise<PostedMessage> {
  try {
    return await post(who, clientKey, rawBody);
  } catch (err) {
    if (err instanceof DoorError && err.status !== 429 && err.status !== 401) await failureRow(who.orgId, who.tokenId, err.code);
    throw err;
  }
}

async function post(who: MessagesPrincipal, clientKey: string, rawBody: unknown): Promise<PostedMessage> {
  const parsed = parseDoorBody(messageBodySchema, rawBody);
  if (!parsed.ok) {
    if (parsed.code === "door.customer_data_rejected") throw new DoorError(422, parsed.code, "The payload names customer data. The door takes opaque identifiers only.", { keys: parsed.keys });
    throw new DoorError(422, parsed.code, "The request body is not valid.", parsed.issues);
  }
  const body: MessageBody = parsed.data;
  // every text except `ref`: no phone number, no long number (the paths are told, never the values)
  const phones = phoneFieldsOf(body.card);
  if (phones.length) throw new DoorError(422, "door.customer_data_rejected", "A text of the card holds a phone number. The door takes opaque identifiers only.", { keys: phones });
  const badHosts = disallowedButtonHosts(body.card, who.buttonHosts);
  if (badHosts.length) throw new DoorError(422, "door.validation_failed", "A button points at a host this token may not use.", badHosts.map((path) => ({ path, message: "door.field.button_host" })));

  const type = "message.create" as const;
  const key = storedIdempotencyKey({ organizationId: who.orgId, tokenId: who.tokenId, type, key: clientKey });
  const hash = requestHash(type, body);

  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await db.idempotencyRecord.findUnique({ where: { key } });
    if (found) {
      if (found.expiresAt > new Date()) {
        if (found.requestHash !== hash) throw new DoorError(409, "door.idempotency_conflict", "This Idempotency-Key was already used with a different request body.");
        return { status: found.responseStatus, body: found.responseBody, replayed: true };
      }
      await db.idempotencyRecord.deleteMany({ where: { id: found.id, expiresAt: { lte: new Date() } } });
    }

    // the daily cap: counted from the records of the answers (a replay is not a new card)
    const today = await db.idempotencyRecord.count({ where: { tokenId: who.tokenId, resourceType: "message", createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (today >= DOOR_V2_LIMITS.perTokenPerDay) throw new DoorError(429, "door.daily_cap", "This token reached its daily limit of cards.", undefined, { "retry-after": "3600" });

    const topic = await resolveDoorTopic(who, body.topicKey);
    if (body.mustRead === true) {
      const ok =
        (await isFeatureOn(who.orgId, "mustRead")) &&
        (await canMark({ orgId: who.orgId, orgRole: topic.org.role, userId: who.issuerId }, topic.facts, topic.org));
      if (!ok) throw new DoorError(403, "door.forbidden", "mustRead is not allowed here: the switch is off or the person this token acts for may not mark messages.");
    }

    try {
      const made = await db.$transaction(async (tx) => {
        const msg = await storeAppCard(tx, {
          orgId: who.orgId,
          conversationId: topic.id,
          spaceId: topic.spaceId,
          authorId: who.issuerId,
          body: cardBodyOf(body.card, who.tokenName),
          card: storedCardOf(body.card),
          viaApp: who.tokenName,
          mustRead: body.mustRead === true,
        });
        await tx.auditLog.create({
          data: {
            action: "door.message.posted",
            actorId: who.issuerId,
            orgId: who.orgId,
            target: msg.id,
            workspaceId: who.workspaceId,
            // the token and the request, never the words of the card
            meta: { tokenId: who.tokenId, via: "api-door-v2", topicKey: body.topicKey, requestId: who.requestId },
          },
        });
        const out = { status: 201, body: { data: { id: msg.id, topicKey: body.topicKey, createdAt: msg.createdAt.toISOString() } } };
        await tx.idempotencyRecord.create({
          data: {
            organizationId: who.orgId,
            tokenId: who.tokenId,
            key,
            requestHash: hash,
            responseStatus: out.status,
            responseBody: out.body,
            resourceType: "message",
            resourceId: msg.id,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });
        return out;
      });
      void db.idempotencyRecord.deleteMany({ where: { organizationId: who.orgId, expiresAt: { lte: new Date() } } }).catch(() => undefined);
      return { status: made.status, body: made.body, replayed: false };
    } catch (err) {
      if (isUniqueViolation(err, "key")) continue;
      throw err;
    }
  }
  throw new DoorError(409, "door.idempotency_conflict", "The request is being processed by another call: retry in a moment.");
}
