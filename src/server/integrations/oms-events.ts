import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { FixedWindowLimiter } from "@/server/rate-limit";
import { ForbiddenError, ValidationError, audit } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { AR } from "@/lib/i18n/dict";
import { decryptSecrets, encryptSecrets, encryptionKeyConfigured, generateSharedSecret } from "@/server/crypto";
import { verifyZakiSignature } from "@/server/webhook-signing";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { isOrderNumber, stateKey } from "@/lib/oms/order-ref";
import { hasPhoneNumber, cardBodyOf, type MessageCard } from "@/server/door/message-payload";
import { storeAppCard, topicForAuthor } from "@/server/chat/door-message";
import { applyEventTicketRules } from "@/server/services/problem-tickets";

/**
 * THE ORDERS SYSTEM'S OWN EVENTS (I1.1a): `POST /api/integrations/oms/events/[receiverId]`.
 *
 * The opaque id in the address names the company (a delivery carries no tenant of its own). What happens, in this order:
 *   1. the receiver exists and the switch `omsEvents` is on — else 404, the same answer for an id nobody knows;
 *   2. the delivery is SIGNED: `verifyZakiSignature` (HMAC over `timestamp.body` of the RAW body, constant time, 5-minute window, seconds or milliseconds).
 *      An unsigned delivery, a wrong signature or an old timestamp is refused 401, and nothing is stored (the orders system signs only when a secret is set:
 *      a receiver with no secret saved refuses everything);
 *   3. `X-Zaki-Delivery` names the delivery: each one is taken ONCE (`InboundDelivery`, unique on company, source and that id): the second arrival is answered 200
 *      `duplicate` and changes nothing;
 *   4. the body is read by WHITELIST (`readOmsEvent`): the order id and number, the states, the product name and the quantity. `total`, `currency`, `city` and everything else
 *      are dropped here, never held, never stored. The RAW BODY IS NEVER STORED (not in a row, not in an event, not in a log line);
 *   5. the delivery row and the order's state (`OmsOrderState`, Q1.4) are written in ONE transaction; then, after it, the CARD rules (a card into the topic the owner chose)
 *      and the ticket rules (returned, cancelled) run: each one in its own try, a failure is a FAILED `IntegrationEvent` (a code only) and never fails the delivery.
 *
 * The contract of the orders system is NOT copied here yet (the owner brings its real files): the field names are PROVISIONAL, written from the spec
 * (tests/fixtures/oms-events.provisional.json), and this reader is the one place to change when the real example arrives.
 */

export const OMS_EVENTS_SOURCE = "oms";
export const OMS_DAILY_SOURCE = "oms-daily";
export const MAX_EVENT_BODY_BYTES = 64 * 1024;
/** The five events the daily card counts. */
export const COUNTED_EVENTS = ["order.confirmed", "order.cancelled", "order.shipped", "order.delivered", "order.returned"] as const;
export type CountedEvent = (typeof COUNTED_EVENTS)[number];

/** Refused deliveries from ONE address (a guess at the secret, a sender with a wrong clock): over it the address is answered 429 for the rest of the window. */
export const refusedDeliveriesLimiter = new FixedWindowLimiter({ limit: 30, windowMs: 10 * 60_000 });

const EVENT_NAME = /^[a-z][a-z0-9_.]{1,60}$/;
const DELIVERY_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const RECEIVER_ID = /^[a-f0-9]{32}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------- reading an event ----------

/** The ONLY shape of an event Zaki keeps. */
export interface OmsEvent {
  event: string;
  at: Date | null;
  orderId: string | null;
  number: string | null;
  status: string | null;
  confirmationState: string | null;
  shippingState: string | null;
  productName: string | null;
  quantity: number | null;
}

export type ReadEvent = { ok: true; event: OmsEvent } | { ok: false; reason: "bad_json" | "bad_event" };

/** The state words an event name itself says, when the data does not carry them. */
function derivedStates(event: string): { status: string | null; confirmationState: string | null; shippingState: string | null } {
  switch (event) {
    case "order.created":
      return { status: "pending", confirmationState: null, shippingState: null };
    case "order.confirmed":
      return { status: "confirmed", confirmationState: "confirmed", shippingState: null };
    case "order.shipped":
      return { status: "shipped", confirmationState: null, shippingState: "shipped" };
    case "order.delivered":
      return { status: "delivered", confirmationState: null, shippingState: "delivered" };
    case "order.returned":
      return { status: "returned", confirmationState: null, shippingState: "returned" };
    case "order.cancelled":
      return { status: "cancelled", confirmationState: null, shippingState: null };
    default:
      return { status: null, confirmationState: null, shippingState: null };
  }
}

function atOf(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v >= 1e12 ? v : v * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * The envelope is `{ event, at, data }`. Reads by whitelist: every key not named here is dropped on the spot. A name that does not look like an event name is no event.
 * An order number that does not have the orders system's shape (or an order id that is not a plain token) is read as «no order»: the event is still counted, the state is not written.
 */
export function readOmsEvent(raw: string): ReadEvent {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "bad_json" };
  }
  if (!isObj(body)) return { ok: false, reason: "bad_json" };
  const name = typeof body["event"] === "string" ? body["event"].trim() : "";
  if (!EVENT_NAME.test(name)) return { ok: false, reason: "bad_event" };
  const data = isObj(body["data"]) ? body["data"] : {};
  const rawNumber = data["order_number"] ?? data["number"];
  const number = typeof rawNumber === "string" || typeof rawNumber === "number" ? String(rawNumber).trim() : "";
  const rawId = data["order_id"] ?? data["id"];
  const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
  const qty = data["quantity"];
  const productRaw = typeof data["product_name"] === "string" ? data["product_name"].trim().slice(0, 200) : "";
  const derived = derivedStates(name);
  return {
    ok: true,
    event: {
      event: name,
      at: atOf(body["at"]),
      orderId: /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null,
      number: isOrderNumber(number) ? number : null,
      status: stateKey(data["status"]) ?? derived.status,
      confirmationState: stateKey(data["confirmation_state"]) ?? derived.confirmationState,
      shippingState: stateKey(data["shipping_state"]) ?? derived.shippingState,
      // a product name that carries a phone number is no product name: it is dropped
      productName: productRaw && !hasPhoneNumber(productRaw) ? productRaw : null,
      quantity: typeof qty === "number" && Number.isInteger(qty) && qty > 0 && qty < 100_000 ? qty : null,
    },
  };
}

// ---------- the receiver's settings (kept on its own Integration row) ----------

export interface EventRoute {
  event: string;
  conversationId: string;
}
export interface DailyCard {
  /** 0-23 in the company's time zone */
  hour: number;
  conversationId: string;
}
export interface EventsConfig {
  receiverId: string;
  /** the person who connected it: the author of the cards and the ticket maker */
  connectedById: string;
  routes: EventRoute[];
  dailyCard: DailyCard | null;
}

/** The settings of a row: only the valid parts (a broken entry is dropped, never trusted). */
export function eventsConfigOf(config: unknown): EventsConfig | null {
  if (!isObj(config)) return null;
  const receiverId = config["receiverId"];
  const connectedById = config["connectedById"];
  if (typeof receiverId !== "string" || !RECEIVER_ID.test(receiverId) || typeof connectedById !== "string" || !connectedById) return null;
  const routes: EventRoute[] = [];
  if (Array.isArray(config["routes"])) {
    for (const r of config["routes"]) {
      if (isObj(r) && typeof r["event"] === "string" && EVENT_NAME.test(r["event"]) && typeof r["conversationId"] === "string" && r["conversationId"]) routes.push({ event: r["event"], conversationId: r["conversationId"] });
    }
  }
  const d = config["dailyCard"];
  const dailyCard = isObj(d) && typeof d["hour"] === "number" && Number.isInteger(d["hour"]) && d["hour"] >= 0 && d["hour"] <= 23 && typeof d["conversationId"] === "string" && d["conversationId"] ? { hour: d["hour"], conversationId: d["conversationId"] } : null;
  return { receiverId, connectedById, routes, dailyCard };
}

export function newReceiverId(): string {
  return randomBytes(16).toString("hex");
}

// ---------- once per delivery ----------

/**
 * Takes a delivery id ONCE (`InboundDelivery`): true the first time, false when this company already took it from this source. Pass a transaction to take it together
 * with what the delivery changes. `IdempotencyRecord` cannot do this: its `tokenId` is required and points at an API token, and a signed delivery has none.
 */
export async function claimInboundDelivery(client: Prisma.TransactionClient | typeof db, input: { orgId: string; source: string; deliveryId: string; event?: string | null; now?: Date }): Promise<boolean> {
  // a single INSERT that does nothing on a conflict: inside a transaction a failed INSERT would poison it
  const rows = await client.$executeRaw`
    INSERT INTO "InboundDelivery" ("id", "orgId", "source", "deliveryId", "event", "receivedAt")
    VALUES (${`c${randomBytes(12).toString("hex")}`}, ${input.orgId}, ${input.source}, ${input.deliveryId}, ${input.event ?? null}, ${input.now ?? new Date()})
    ON CONFLICT ("orgId", "source", "deliveryId") DO NOTHING`;
  return rows === 1;
}

// ---------- the delivery ----------

export interface ReceiveInput {
  receiverId: string;
  deliveryId: string | null;
  eventHeader: string | null;
  timestamp: string | null;
  signature: string | null;
  /** The body exactly as it came: verified, parsed and dropped. Never stored. */
  rawBody: string;
  now?: Date;
}
export interface ReceiveResult {
  status: number;
  body: { ok: boolean; error?: string; duplicate?: boolean };
}

const refuse = (status: number, error: string): ReceiveResult => ({ status, body: { ok: false, error: `oms_events.${error}` } });

/** The row of a receiver, or null. */
export async function findReceiver(receiverId: string) {
  if (!RECEIVER_ID.test(receiverId)) return null;
  return db.integration.findFirst({
    where: { type: "OMS_EVENTS", connected: true, config: { path: ["receiverId"], equals: receiverId } },
    select: { id: true, orgId: true, config: true, secretEnc: true },
  });
}

/** A failure the owner can see under «التكاملات»: a code, never a field of the delivery. */
async function failureEvent(orgId: string, integrationId: string, code: string): Promise<void> {
  try {
    await db.integrationEvent.create({ data: { orgId, integrationId, direction: "IN", type: "oms.event", status: "FAILED", detail: code.slice(0, 80) } });
  } catch (err) {
    log.warn("oms_events.failure_row_failed", { name: err instanceof Error ? err.name : "error" });
  }
}

export async function receiveOmsEvent(input: ReceiveInput): Promise<ReceiveResult> {
  const now = input.now ?? new Date();
  const row = await findReceiver(input.receiverId);
  if (!row) return refuse(404, "not_found");
  if (!(await isFeatureOn(row.orgId, "omsEvents"))) return refuse(404, "not_found");
  const cfg = eventsConfigOf(row.config);
  if (!cfg) return refuse(404, "not_found");

  // an unsigned delivery is refused: the orders system signs only when a secret is set, so a receiver that has none refuses everything
  if (!input.timestamp?.trim() || !input.signature?.trim()) return refuse(401, "unsigned");
  const secret = decryptSecrets<{ secret?: string }>(row.secretEnc)?.secret ?? null;
  const verdict = verifyZakiSignature({ secret, timestampHeader: input.timestamp, signatureHeader: input.signature, rawBody: input.rawBody, now });
  if (!verdict.ok) {
    log.warn("oms_events.refused", { reason: verdict.reason });
    return refuse(401, verdict.reason.toLowerCase());
  }

  if (!input.deliveryId || !DELIVERY_ID.test(input.deliveryId)) return refuse(400, "delivery_required");
  const read = readOmsEvent(input.rawBody);
  if (!read.ok) return refuse(read.reason === "bad_json" ? 400 : 422, read.reason);
  const event = read.event;
  if (input.eventHeader && input.eventHeader.trim() !== event.event) return refuse(400, "event_mismatch");

  // the delivery and the order's state are ONE write: a delivery taken is a delivery stored, and a failed write can be sent again
  const first = await db.$transaction(async (tx) => {
    if (!(await claimInboundDelivery(tx, { orgId: row.orgId, source: OMS_EVENTS_SOURCE, deliveryId: input.deliveryId!, event: event.event, now }))) return false;
    if (event.number) await writeOrderState(tx, row.orgId, event, now);
    await tx.integration.update({ where: { id: row.id }, data: { lastSyncAt: now } });
    return true;
  });
  if (!first) return { status: 200, body: { ok: true, duplicate: true } };

  // the delivery rows are only needed for the replay window and the daily counts: old ones are removed now and then (a hundredth of the deliveries)
  if (Math.random() < 0.01) void db.inboundDelivery.deleteMany({ where: { orgId: row.orgId, source: OMS_EVENTS_SOURCE, receivedAt: { lt: new Date(now.getTime() - 40 * 86_400_000) } } }).catch(() => undefined);
  await afterStored(row.orgId, row.id, cfg, event);
  return { status: 200, body: { ok: true } };
}

/** `OmsOrderState` (Q1.4) refreshed by the event: an older event never overwrites a newer state, and a field the event does not carry keeps what was known. */
async function writeOrderState(tx: Prisma.TransactionClient, orgId: string, event: OmsEvent, now: Date): Promise<void> {
  const where = { orgId_orderNumber: { orgId, orderNumber: event.number! } };
  const known = await tx.omsOrderState.findUnique({ where, select: { movedAt: true } });
  const moved = event.at ?? now;
  if (known?.movedAt && known.movedAt.getTime() > moved.getTime()) return;
  const data = {
    ...(event.orderId ? { orderId: event.orderId } : {}),
    ...(event.status ? { status: event.status } : {}),
    ...(event.confirmationState ? { confirmationState: event.confirmationState } : {}),
    ...(event.shippingState ? { shippingState: event.shippingState } : {}),
    ...(event.productName ? { productName: event.productName } : {}),
    ...(event.quantity ? { quantity: event.quantity } : {}),
    movedAt: moved,
    fetchedAt: now,
  };
  await tx.omsOrderState.upsert({ where, create: { orgId, orderNumber: event.number!, ...data }, update: data });
}

const STATUS_OF_EVENT: Record<string, "info" | "ok" | "warn" | "danger"> = {
  "order.created": "info",
  "order.confirmed": "ok",
  "order.shipped": "info",
  "order.delivered": "ok",
  "order.returned": "warn",
  "order.cancelled": "danger",
};

/** The card of one event: the words, the order number as a chip, and the product and quantity when the event carried them. No money, no customer data. */
export function eventCardOf(event: OmsEvent): MessageCard & { status: "info" | "ok" | "warn" | "danger" } {
  const lines: Array<{ label: string; value: string }> = [];
  if (event.productName) lines.push({ label: AR["oms.events.line.product"] ?? "", value: event.productName });
  if (event.quantity) lines.push({ label: AR["oms.events.line.quantity"] ?? "", value: String(event.quantity) });
  return {
    title: AR[`oms.events.title.${event.event}`] ?? AR["oms.events.title.other"] ?? event.event,
    ...(lines.length ? { lines } : {}),
    status: STATUS_OF_EVENT[event.event] ?? "info",
    ...(event.number ? { ref: event.number } : {}),
  };
}

async function afterStored(orgId: string, integrationId: string, cfg: EventsConfig, event: OmsEvent): Promise<void> {
  // the cards: one per rule of this event
  const routes = cfg.routes.filter((r) => r.event === event.event);
  if (routes.length) {
    try {
      const author = await db.organizationMember.findFirst({ where: { organizationId: orgId, userId: cfg.connectedById, status: "ACTIVE", role: { not: "GUEST" } }, select: { userId: true } });
      if (!author) throw new Error("author_inactive");
      const card = eventCardOf(event);
      const via = AR["oms.events.via"] ?? "";
      const stored: Record<string, unknown> = {
        type: "app",
        title: card.title,
        ...(card.lines ? { lines: card.lines } : {}),
        status: card.status,
        ...(card.ref ? { ref: card.ref } : {}),
        // a symbolic button: the address of an order's page is not in the contract yet, so the screen resolves it once it is
        buttons: [{ label: AR["oms.events.open"] ?? "", action: "open_oms_order" }],
      };
      for (const route of routes) {
        try {
          // the topic and the author are asked again NOW: the topic may be gone and the person may have left it since the rule was saved
          const topic = await topicForAuthor(orgId, author.userId, route.conversationId);
          if (!topic.ok) {
            await failureEvent(orgId, integrationId, `oms_events.${topic.reason}`);
            continue;
          }
          await db.$transaction((tx) => storeAppCard(tx, { orgId, conversationId: topic.id, spaceId: topic.spaceId, authorId: author.userId, body: cardBodyOf(card, via), card: stored, viaApp: via }));
        } catch (err) {
          log.warn("oms_events.card_failed", { name: err instanceof Error ? err.name : "error" });
          await failureEvent(orgId, integrationId, "oms_events.card_failed");
        }
      }
    } catch (err) {
      log.warn("oms_events.card_failed", { name: err instanceof Error ? err.name : "error" });
      await failureEvent(orgId, integrationId, "oms_events.card_failed");
    }
  }
  // the tickets (returned, cancelled)
  try {
    await applyEventTicketRules({ orgId, userId: cfg.connectedById, event: event.event, number: event.number });
  } catch (err) {
    log.warn("oms_events.ticket_failed", { name: err instanceof Error ? err.name : "error" });
    await failureEvent(orgId, integrationId, "oms_events.ticket_failed");
  }
}

// ---------- the counts ----------

export type EventCounts = Record<CountedEvent, number>;

/** How many deliveries of each counted event were received in the window, from the delivery rows alone. */
export async function countEvents(orgId: string, from: Date, to: Date): Promise<EventCounts> {
  const rows = await db.inboundDelivery.groupBy({
    by: ["event"],
    where: { orgId, source: OMS_EVENTS_SOURCE, event: { in: [...COUNTED_EVENTS] }, receivedAt: { gte: from, lte: to } },
    _count: { _all: true },
  });
  const out = Object.fromEntries(COUNTED_EVENTS.map((e) => [e, 0])) as EventCounts;
  for (const r of rows) if (r.event && (COUNTED_EVENTS as readonly string[]).includes(r.event)) out[r.event as CountedEvent] = r._count._all;
  return out;
}

// ---------- the owner's door: the receiver, its secret, the rules, the daily card ----------

/**
 * What the OWNER sees and sets under «التكاملات» (the receiver's own row, `IntegrationType.OMS_EVENTS`, beside the row of the link to the orders system). Owner only: the
 * secret signs what the orders system says about every order. The secret is stored encrypted in `secretEnc`, never selected into an answer; one made HERE is shown ONCE, in
 * the answer that makes it. Making or changing anything needs the switch `omsEvents` (404 while it is off); looking, and taking the receiver out (the secret goes with it), never do.
 */
export interface EventsStatusDTO {
  switchOn: boolean;
  keyConfigured: boolean;
  receiverId: string | null;
  /** the path the orders system is told to send to (the host is the company's own address) */
  path: string | null;
  secretSaved: boolean;
  routes: EventRoute[];
  dailyCard: DailyCard | null;
  lastEventAt: string | null;
  /** deliveries received in the last 24 hours, by counted event */
  last24h: EventCounts;
}

function assertOwner(actor: Pick<Actor, "isOwner">): void {
  if (!actor.isOwner) throw new ForbiddenError("oms.events.e.owner_only");
}
function refuseField(path: string, key: string): never {
  throw new ValidationError([{ path, message: key }]);
}

export const receiverPathOf = (receiverId: string): string => `/api/integrations/oms/events/${receiverId}`;

export async function getEventsStatus(actor: Actor, now: Date = new Date()): Promise<EventsStatusDTO> {
  assertOwner(actor);
  const [switchOn, row] = await Promise.all([isFeatureOn(actor.orgId, "omsEvents"), db.integration.findUnique({ where: { orgId_type: { orgId: actor.orgId, type: "OMS_EVENTS" } }, select: { config: true, secretEnc: true, lastSyncAt: true } })]);
  const cfg = row ? eventsConfigOf(row.config) : null;
  return {
    switchOn,
    keyConfigured: encryptionKeyConfigured(),
    receiverId: cfg?.receiverId ?? null,
    path: cfg ? receiverPathOf(cfg.receiverId) : null,
    secretSaved: !!row?.secretEnc,
    routes: cfg?.routes ?? [],
    dailyCard: cfg?.dailyCard ?? null,
    lastEventAt: row?.lastSyncAt?.toISOString() ?? null,
    last24h: await countEvents(actor.orgId, new Date(now.getTime() - 86_400_000), now),
  };
}

export type ReceiverAction = "create" | "rotate_id" | "generate_secret";

/**
 * «create»: the receiver's address (an opaque id), once. «rotate_id»: a new address (the old one stops answering at once; the secret stays). «generate_secret»: a fresh secret made
 * here, returned ONCE in this answer (the orders system is then told to sign with it); the other way is to paste the secret the orders system made (`saveEventsSettings`).
 */
export async function receiverAction(actor: Actor, action: ReceiverAction): Promise<{ secret?: string }> {
  assertOwner(actor);
  await assertFeatureOn(actor.orgId, "omsEvents");
  if (!encryptionKeyConfigured()) refuseField("secret", "oms.events.e.no_key");
  const where = { orgId_type: { orgId: actor.orgId, type: "OMS_EVENTS" as const } };
  const row = await db.integration.findUnique({ where, select: { config: true } });
  const cfg = row ? eventsConfigOf(row.config) : null;
  if (action !== "create" && !cfg) refuseField("receiver", "oms.events.e.no_receiver");
  const next: EventsConfig = cfg && action !== "rotate_id" ? cfg : { receiverId: newReceiverId(), connectedById: actor.userId, routes: cfg?.routes ?? [], dailyCard: cfg?.dailyCard ?? null };
  const secret = action === "generate_secret" ? generateSharedSecret() : undefined;
  const config = next as unknown as Prisma.InputJsonValue;
  const secretEnc = secret ? encryptSecrets({ secret }) : undefined;
  await db.integration.upsert({
    where,
    create: { orgId: actor.orgId, type: "OMS_EVENTS", connected: true, config, ...(secretEnc ? { secretEnc } : {}) },
    update: { connected: true, config, ...(secretEnc ? { secretEnc } : {}) },
  });
  await audit(`oms_events.${action}`, { actorId: actor.userId, orgId: actor.orgId, target: actor.orgId });
  return secret ? { secret } : {};
}

export interface EventsSettingsInput {
  /** a secret the orders system made, pasted by the owner (never returned) */
  secret?: string | undefined;
  routes?: Array<{ event: string; conversationId: string }> | undefined;
  dailyCard?: { hour: number; conversationId: string } | null | undefined;
}

/**
 * Saves what the owner typed: the secret (encrypted), the rules (event to topic) and the daily card (hour and topic). A topic must be a live topic of THIS company, and the person
 * who connected the receiver (the author of the cards) must be able to read it and post in it (`topicForAuthor`): else 422, nothing is saved.
 */
export async function saveEventsSettings(actor: Actor, input: EventsSettingsInput): Promise<void> {
  assertOwner(actor);
  await assertFeatureOn(actor.orgId, "omsEvents");
  const where = { orgId_type: { orgId: actor.orgId, type: "OMS_EVENTS" as const } };
  const row = await db.integration.findUnique({ where, select: { config: true } });
  const cfg = row ? eventsConfigOf(row.config) : null;
  if (!cfg) return refuseField("receiver", "oms.events.e.no_receiver");

  const secret = input.secret?.trim();
  if (secret !== undefined && secret !== "") {
    if (!encryptionKeyConfigured()) refuseField("secret", "oms.events.e.no_key");
    if (secret.length < 16 || secret.length > 200 || /\s/.test(secret)) refuseField("secret", "oms.events.e.secret");
  }
  const wanted = new Set<string>([...(input.routes ?? []).map((r) => r.conversationId), ...(input.dailyCard ? [input.dailyCard.conversationId] : [])]);
  // every topic must take a card from the person who connected the receiver (the author of the cards), not from the owner who types here
  for (const id of wanted) {
    const topic = await topicForAuthor(actor.orgId, cfg.connectedById, id);
    if (!topic.ok) refuseField("conversationId", topic.reason === "topic_gone" ? "oms.events.e.topic" : "oms.events.e.author_forbidden");
  }

  let routes = cfg.routes;
  if (input.routes !== undefined) {
    const seen = new Set<string>();
    routes = [];
    for (const r of input.routes.slice(0, 30)) {
      if (!EVENT_NAME.test(r.event)) refuseField("routes", "oms.events.e.event");
      const k = `${r.event}|${r.conversationId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      routes.push({ event: r.event, conversationId: r.conversationId });
    }
  }
  let dailyCard = cfg.dailyCard;
  if (input.dailyCard !== undefined) {
    if (input.dailyCard === null) dailyCard = null;
    else {
      if (!Number.isInteger(input.dailyCard.hour) || input.dailyCard.hour < 0 || input.dailyCard.hour > 23) refuseField("dailyCard.hour", "oms.events.e.hour");
      dailyCard = { hour: input.dailyCard.hour, conversationId: input.dailyCard.conversationId };
    }
  }
  const config = { ...cfg, routes, dailyCard } as unknown as Prisma.InputJsonValue;
  await db.integration.update({ where, data: { config, ...(secret ? { secretEnc: encryptSecrets({ secret }) } : {}) } });
  // the audit row says THAT it changed, nothing of what was typed
  await audit("oms_events.saved", { actorId: actor.userId, orgId: actor.orgId, target: actor.orgId });
}

/** Takes the receiver out: its address stops answering and the secret is deleted with it. Allowed while the switch is off too. */
export async function removeReceiver(actor: Actor): Promise<void> {
  assertOwner(actor);
  await db.integration.deleteMany({ where: { orgId: actor.orgId, type: "OMS_EVENTS" } });
  await audit("oms_events.removed", { actorId: actor.userId, orgId: actor.orgId, target: actor.orgId });
}
