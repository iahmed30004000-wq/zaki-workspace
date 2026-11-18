import { NextResponse } from "next/server";
import { BodyTooLargeError, readTextLimited } from "@/server/http/body-limit";
import { MAX_EVENT_BODY_BYTES, receiveOmsEvent, refusedDeliveriesLimiter } from "@/server/integrations/oms-events";
import { clientIp } from "@/server/rate-limit";
import { log } from "@/server/log";

/**
 * The orders system's own events (I1.1a; the rules are in src/server/integrations/oms-events.ts). No session: the opaque id in the address names the company and the
 * delivery proves itself with its signature (`X-Zaki-Timestamp`, `X-Zaki-Signature`, the existing `verifyZakiSignature`). The body is read with a ceiling of 64 KiB BEFORE
 * anything else (the signature is over the body, so it can only be checked once the body is in memory) and is never stored.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(req: Request, ctx: { params: { receiverId: string } }) {
  try {
    // an address that keeps sending refused deliveries is not served for a while (a good sender behind another address is not touched)
    const ip = clientIp(req);
    const blocked = refusedDeliveriesLimiter.check(ip);
    if (!blocked.ok) return NextResponse.json({ ok: false, error: "oms_events.rate_limited" }, { status: 429, headers: { ...NO_STORE, "retry-after": String(Math.max(1, blocked.retryAfterSec)) } });
    let raw: string;
    try {
      raw = await readTextLimited(req, MAX_EVENT_BODY_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) return NextResponse.json({ ok: false, error: "oms_events.body_too_large" }, { status: 413, headers: NO_STORE });
      return NextResponse.json({ ok: false, error: "oms_events.bad_body" }, { status: 400, headers: NO_STORE });
    }
    const out = await receiveOmsEvent({
      receiverId: ctx.params.receiverId,
      deliveryId: req.headers.get("x-zaki-delivery"),
      eventHeader: req.headers.get("x-zaki-event"),
      timestamp: req.headers.get("x-zaki-timestamp"),
      signature: req.headers.get("x-zaki-signature"),
      rawBody: raw,
    });
    if (out.status === 401) refusedDeliveriesLimiter.hit(ip);
    return NextResponse.json(out.body, { status: out.status, headers: NO_STORE });
  } catch (err) {
    // never the message: it may repeat a value of the delivery
    log.error("oms_events.unhandled", { name: err instanceof Error ? err.name : "error" });
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
