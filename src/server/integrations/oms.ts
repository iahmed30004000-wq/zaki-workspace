import { assertPublicHttpsUrl, UnsafeUrlError, type HostResolver } from "@/server/net-guard";
import { logEvent, requireConnected } from "@/server/services/integrations";
import { readProducts, type ProductsRead, type ProductSnapshot } from "@/lib/oms/snapshot";
import { isOrderNumber } from "@/lib/oms/order-ref";
import { readOrderAnswer, type OrderStateRead } from "@/lib/oms/order-state";

/**
 * THE CLIENT OF THE ORDERS SYSTEM (Q1.0): three calls, nothing else.
 *
 *   listProducts()            GET  /api/v1/products
 *   orderStatus(orderId)      GET  /api/v1/orders/{id}            (the orders system's INTERNAL id)
 *   addOrderNote(id, text)    POST /api/v1/orders/{id}/notes      (an Idempotency-Key, the body { note })
 *
 * The token lives in `Integration.secretEnc` ({ token }, encrypted, never returned); the base URL is a setting in
 * `Integration.config` (never in a tracked file). Every call re-judges the base URL with the SSRF guard (public https only),
 * waits at most 5 seconds, follows no redirect, and on ANY failure writes an `IntegrationEvent` (FAILED, `oms.<code>`) that
 * holds the code only: NEVER the token, a response body or a customer's field, in the event, in an error or in a log.
 */

export const OMS_TIMEOUT_MS = 5000;
/** The most an answer may weigh: a door that sends more is refused, never read. */
export const OMS_MAX_BODY_CHARS = 4_000_000;
/** The orders system's own ids are plain tokens: anything that could leave the path (`..`, a slash, a query) is refused before a request. */
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type OmsErrorCode = "unsupported" | "no_base_url" | "url_invalid" | "url_https_only" | "url_credentials" | "url_private" | "url_unresolvable" | "no_token" | "timeout" | "network" | "redirect" | "bad_body" | "bad_id" | "too_big" | `http_${number}`;

/** A failure of a call. `code` is the whole story: it is also the key of the ⚠️ the integration card shows. */
export class OmsError extends Error {
  readonly code: OmsErrorCode;
  constructor(code: OmsErrorCode) {
    super(`oms: ${code}`);
    this.name = "OmsError";
    this.code = code;
  }
}

export interface OmsCallOptions {
  /** Injectable for tests; defaults to the global fetch, looked up at call time. */
  fetchImpl?: typeof fetch;
  resolve?: HostResolver;
  timeoutMs?: number;
}

let testOptions: OmsCallOptions | null = null;
/** Tests only: the fake orders system and a name resolver that never touches DNS, for calls that pass no options (the job, the routes). */
export function setOmsOptionsForTests(options: OmsCallOptions | null): void {
  testOptions = options;
}

export interface OrderState {
  number?: string;
  status?: string;
  updatedAt?: string;
}

interface Conn {
  base: URL;
  token: string;
}

/** The base URL as the owner typed it, judged by the SSRF guard (public https only): the address to keep, or an `OmsError` `url_*`. */
export async function assertOmsBaseUrl(raw: string, options: OmsCallOptions = {}): Promise<string> {
  const opts = { ...testOptions, ...options };
  try {
    const url = await assertPublicHttpsUrl(raw.trim(), opts.resolve ? { resolve: opts.resolve } : {});
    // only the origin is kept: the three doors are absolute paths of the orders system
    return url.origin;
  } catch (err) {
    throw new OmsError(err instanceof UnsafeUrlError ? (`url_${err.code}` as OmsErrorCode) : "url_invalid");
  }
}

async function connect(orgId: string, opts: OmsCallOptions): Promise<Conn> {
  // not connected / unreadable secret: the caller's problem, not an event (nothing was attempted)
  const { row, secrets } = await requireConnected(orgId, "OMS");
  const token = (secrets as Record<string, unknown>)["token"];
  if (typeof token !== "string" || !token) throw new OmsError("no_token");
  const baseUrl = ((row.config ?? {}) as { baseUrl?: unknown }).baseUrl;
  if (typeof baseUrl !== "string" || !baseUrl.trim()) throw new OmsError("no_base_url");
  // judged again on EVERY call: a name's address changes and an old saved row is not trusted
  return { base: new URL(await assertOmsBaseUrl(baseUrl, opts)), token };
}

async function call(orgId: string, eventType: string, path: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string; badId?: boolean }, given: OmsCallOptions): Promise<unknown> {
  const opts: OmsCallOptions = { ...testOptions, ...given };
  try {
    if (init.badId) throw new OmsError("bad_id");
    const { base, token } = await connect(orgId, opts);
    const doFetch = opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? OMS_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await doFetch(new URL(path, base).href, {
          method: init.method,
          headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...init.headers },
          ...(init.body !== undefined ? { body: init.body } : {}),
          signal: controller.signal,
          redirect: "manual",
          cache: "no-store",
        });
      } catch (err) {
        throw new OmsError(controller.signal.aborted || (err instanceof Error && err.name === "AbortError") ? "timeout" : "network");
      }
      if (res.status >= 300 && res.status < 400) {
        void res.body?.cancel().catch(() => undefined);
        throw new OmsError("redirect");
      }
      if (!res.ok) {
        // the body of an error is never read: it may hold anything
        void res.body?.cancel().catch(() => undefined);
        throw new OmsError(`http_${res.status}`);
      }
      let text: string;
      try {
        text = await res.text();
      } catch {
        throw new OmsError(controller.signal.aborted ? "timeout" : "network");
      }
      if (text.length > OMS_MAX_BODY_CHARS) throw new OmsError("too_big");
      try {
        return JSON.parse(text);
      } catch {
        throw new OmsError("bad_body");
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof OmsError) {
      await logEvent(orgId, { direction: "OUT", type: eventType, status: "FAILED", detail: `oms.${err.code}` });
    }
    throw err;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The products the token may read, each read into the snapshot shape, with what could not be read. An answer that is not a LIST (an
 * error object, a page of HTML) is a failed read (`bad_body`), never an empty catalogue; an empty list is a good read.
 */
export async function readProductList(orgId: string, opts: OmsCallOptions = {}): Promise<ProductsRead> {
  const body = await call(orgId, "oms.products", "/api/v1/products", { method: "GET" }, opts);
  const read = readProducts(body, new Date());
  if (read.shape !== "list") {
    await logEvent(orgId, { direction: "OUT", type: "oms.products", status: "FAILED", detail: "oms.bad_body" });
    throw new OmsError("bad_body");
  }
  return read;
}

/** Every product the token may read (a row with no code, name or a price above zero is dropped). */
export async function listProducts(orgId: string, opts: OmsCallOptions = {}): Promise<ProductSnapshot[]> {
  return (await readProductList(orgId, opts)).products;
}

/** The state of one order by the orders system's internal id: the number, the state and when it last moved — no customer field. */
export async function orderStatus(orgId: string, orderId: string, opts: OmsCallOptions = {}): Promise<OrderState> {
  const body = await call(orgId, "oms.order", `/api/v1/orders/${encodeURIComponent(orderId)}`, { method: "GET", badId: !ORDER_ID.test(orderId) }, opts);
  const o = isObj(body) ? body : {};
  const number = o["number"] === undefined || o["number"] === null ? undefined : String(o["number"]);
  return {
    ...(number ? { number } : {}),
    ...(typeof o["status"] === "string" ? { status: o["status"] } : {}),
    ...(typeof o["updated_at"] === "string" ? { updatedAt: o["updated_at"] } : {}),
  };
}

/** Writes a note on an order. The same `idempotencyKey` is the same note, however many times it is sent. */
export async function addOrderNote(orgId: string, orderId: string, text: string, idempotencyKey: string, opts: OmsCallOptions = {}): Promise<void> {
  await call(
    orgId,
    "oms.note",
    `/api/v1/orders/${encodeURIComponent(orderId)}/notes`,
    { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ note: text }), badId: !ORDER_ID.test(orderId) },
    opts,
  );
}

/**
 * An order by its NUMBER (Q1.4): `GET /api/v1/orders?number=` — item 3 of the ordered prompt. Until the orders system has it the door answers 404/400/405
 * and this throws `OmsError("unsupported")`, which the screen tells as «حالة الطلب بتتفعّل بعد تحديث نظام الطلبات». Only the fields of
 * `readOrderAnswer` survive the reading.
 */
export async function orderByNumber(orgId: string, number: string, opts: OmsCallOptions = {}): Promise<OrderStateRead> {
  let body: unknown;
  try {
    body = await call(orgId, "oms.order_by_number", `/api/v1/orders?number=${encodeURIComponent(number)}`, { method: "GET", badId: !isOrderNumber(number) }, opts);
  } catch (err) {
    if (err instanceof OmsError && ["http_400", "http_405", "http_501"].includes(err.code)) throw new OmsError("unsupported");
    throw err;
  }
  const read = readOrderAnswer(body, number);
  if (!read) throw new OmsError("bad_body");
  return read;
}
