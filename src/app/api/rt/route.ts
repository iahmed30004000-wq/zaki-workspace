import type { NextRequest } from "next/server";
import { apiError } from "@/server/api";
import { db } from "@/server/db";
import { ForbiddenError, UnauthorizedError, requireUser } from "@/server/auth";
import { RateLimitedError } from "@/server/rate-limit";
import { log } from "@/server/log";
import { requireActor } from "@/server/policy/actor";
import {
  addClient,
  filterVisible,
  frameOf,
  removeClient,
  type RtClient,
  type RtEvent,
} from "@/server/realtime/hub";
import { ensureListener } from "@/server/realtime/listener";
import { REALTIME_KINDS } from "@/server/realtime/emit";
import { heartbeatInterval } from "@/server/realtime/stream-config";
import { touchPresence } from "@/server/realtime/presence";

/**
 * GET /api/rt — the one SSE stream per tab.
 *
 * Node runtime, never cached, never buffered: `X-Accel-Buffering: no` tells nginx
 * (and Traefik honours the same header) to flush every frame at once. A `ping` event
 * every 25 s keeps intermediaries from timing the connection out, lets the page see a
 * half-open connection (a comment frame is invisible to a browser), and doubles as the
 * re-check point: a suspended/offboarded person or a session whose token version moved
 * stops being served within one heartbeat. A stream that ends says why (`event: bye`)
 * and closes: `evicted` (a newer stream of the same person took its place) or
 * `signed_out`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPLAY_WINDOW_MS = 48 * 3600_000;

// ONE list of kinds: a kind added to REALTIME_KINDS survives a replay under its own name (F0.4)
const RT_KINDS: ReadonlySet<string> = new Set<string>(REALTIME_KINDS);

function kindOf(kind: string): RtEvent["kind"] {
  return RT_KINDS.has(kind) ? (kind as RtEvent["kind"]) : "conversation.changed";
}

export async function GET(req: NextRequest): Promise<Response> {
  // An SSE stream is a plain Response (not a NextResponse), so withApi's NextResponse
  // contract does not fit; the same error mapping is applied manually below.
  try {
    return await sse(req);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiError("forbidden", err.message);
    if (err instanceof UnauthorizedError) return apiError("auth.required", err.message);
    if (err instanceof RateLimitedError) {
      return apiError("rate_limited", err.message, undefined, { "retry-after": String(err.retryAfterSec) });
    }
    log.error("api.rt_unhandled", {
      name: err instanceof Error ? err.name : String(err),
      message: err instanceof Error ? err.message : String(err),
    });
    return apiError("internal");
  }
}

async function sse(req: NextRequest): Promise<Response> {
  {
    const actor = await requireActor();
    const sessionTv = (await requireUser()).tv;
    await ensureListener();

    const lastEventId = req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("lastEventId") ?? "";
    const encoder = new TextEncoder();
    let client: RtClient | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let done = false;
    let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;

    /** The stream ends here and says why, so the page neither waits in silence nor reconnects into a loop (F0.2). */
    function end(reason: "evicted" | "signed_out"): void {
      if (done) return;
      try {
        ctrl?.enqueue(encoder.encode(`event: bye\ndata: ${JSON.stringify({ reason })}\n\n`));
      } catch {
        // the consumer is gone already
      }
      cleanup();
      try {
        ctrl?.close();
      } catch {
        // closed already
      }
    }

    function cleanup(): void {
      if (done) return;
      done = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (client) {
        removeClient(client);
        client = null;
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        ctrl = controller;
        const write = (text: string) => {
          if (done) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            // the consumer is gone; cleanup happens in cancel()
          }
        };
        const send = (frame: string) => {
          write(frame);
        };

        write(`retry: 3000\n\n`);
        client = addClient({
          userId: actor.userId,
          orgId: actor.orgId,
          send,
          close: () => end("evicted"),
        });
        // a stream that opens counts the DMs that reached this person while away as delivered (✓✓)
        void import("@/server/chat/read-state")
          .then(({ markDeliveredForUser }) => markDeliveredForUser(actor.userId))
          .catch(() => undefined);

        try {
          // Replay: the events of the last 48 h this person may see. An id older
          // than that (or unparsable) means an unknown gap: one `reload` event makes
          // the client refetch through the normal APIs instead of a partial window.
          if (lastEventId) {
            const sinceId = BigInt(lastEventId);
            const since = new Date(Date.now() - REPLAY_WINDOW_MS);
            const boundary = await db.realtimeEvent.findFirst({
              where: { orgId: actor.orgId, id: { lte: sinceId }, createdAt: { lt: since } },
              select: { id: true },
            });
            if (boundary) {
              write(`event: reload\ndata: {}\n\n`);
            } else {
              const rows = await db.realtimeEvent.findMany({
                where: { orgId: actor.orgId, id: { gt: sinceId }, createdAt: { gte: since } },
                orderBy: { id: "asc" },
                take: 500,
                select: { id: true, kind: true, ids: true },
              });
              const visible = await filterVisible(
                actor.userId,
                rows.map((r) => ({ id: r.id.toString(), kind: r.kind, ids: (r.ids ?? {}) as RtEvent["ids"] })),
              );
              for (const r of visible) send(frameOf({ id: r.id, orgId: actor.orgId, kind: kindOf(r.kind), ids: r.ids }));
              // a full page means more was missed than one replay carries: refetch everything instead
              if (rows.length >= 500) write(`event: reload\ndata: {}\n\n`);
            }
          } else {
            write(`: connected\n\n`);
          }
        } catch {
          // replay is best-effort; the periodic refetch covers a failed window
        }

        // Every heartbeat: a session whose token version moved (password change,
        // "log out everywhere") or whose membership left ACTIVE is closed here.
        const recheckSession = async (): Promise<void> => {
          try {
            const user = await db.user.findUnique({
              where: { id: actor.userId },
              select: {
                tokenVersion: true,
                memberships: { where: { organizationId: actor.orgId }, select: { status: true } },
              },
            });
            const active = user?.memberships.some((m) => m.status === "ACTIVE") ?? false;
            if (!user || user.tokenVersion !== sessionTv || !active) end("signed_out");
          } catch {
            // a transient DB error must not kill a healthy stream
          }
        };

        heartbeat = setInterval(() => {
          write(`event: ping\ndata: ${Date.now()}\n\n`);
          // an open stream IS presence: without this, everybody counted as offline 30 s after
          // connecting, and every message turned into a notification for them (review A3)
          touchPresence(actor.userId, undefined, actor.orgId);
          void recheckSession();
        }, heartbeatInterval());
      },
      cancel() {
        cleanup();
      },
    });

    req.signal.addEventListener("abort", cleanup);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
}
