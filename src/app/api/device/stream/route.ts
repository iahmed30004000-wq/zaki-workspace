import { db } from "@/server/db";
import { log } from "@/server/log";
import { goHref } from "@/lib/space-link";
import { featureOn } from "@/lib/features";
import { bearerOf, deviceByToken, lineAllowed, touchDevice } from "@/server/devices/devices";
import { openLine, type DeviceEvent } from "@/server/devices/hub";

/**
 * THE LIVE LINE OF THE ANDROID APP. The app (a paired phone, authenticated by its key: `Authorization: Bearer zk_…`, never a cookie) keeps
 * this request open; the server writes one `event: note|ring|missed` per thing the phone must show NOW. A comment line goes out every 20
 * seconds so the connection is not cut as idle, and the key is checked again every minute (an unpaired phone is cut). On connecting, the
 * notifications written since `?since=<ms>` (the app's last one) are replayed, so a phone that was offline misses nothing of the bell.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PING_MS = 20_000;
const RECHECK_MS = 60_000;
const REPLAY_MAX = 20;
const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export async function GET(req: Request) {
  const token = bearerOf(req.headers.get("authorization"));
  const device = token ? await deviceByToken(token) : null;
  if (!device) return Response.json({ error: "auth.required" }, { status: 401 });
  if (!(await lineAllowed(device.userId))) return Response.json({ error: "not_found", message: "features.off" }, { status: 404 });

  const since = Number(new URL(req.url).searchParams.get("since"));
  const from = Number.isFinite(since) && since > 0 ? Math.max(since, Date.now() - REPLAY_WINDOW_MS) : 0;

  let close: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const timers: ReturnType<typeof setInterval>[] = [];
      const end = () => {
        if (closed) return;
        closed = true;
        timers.forEach(clearInterval);
        unregister();
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };
      close = end;
      const unregister = openLine(device.userId, device.id, (event: DeviceEvent) => {
        if (closed) throw new Error("line closed");
        controller.enqueue(frame(event.kind, { ...event, at: Date.now() }));
      });
      req.signal.addEventListener("abort", end);
      controller.enqueue(frame("hello", { at: Date.now() }));
      await touchDevice(device.id);

      if (from > 0) {
        try {
          const rows = await db.notification.findMany({
            where: { userId: device.userId, createdAt: { gt: new Date(from) } },
            orderBy: { createdAt: "asc" },
            take: REPLAY_MAX,
            select: { id: true, type: true, title: true, body: true, linkUrl: true, workspaceId: true, organizationId: true, createdAt: true },
          });
          // the company's switch «إشعارات على التلفون واللابتوب» governs the replay as it governs the live push
          const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((id): id is string => !!id))];
          const orgs = await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, settings: true } });
          const settings = new Map(orgs.map((o) => [o.id, o.settings]));
          for (const r of rows) {
            if (r.organizationId && !featureOn(settings.get(r.organizationId), "pushEverything")) continue;
            const target = r.linkUrl ?? "/";
            const url = r.workspaceId && !target.startsWith("/go?") ? goHref(r.workspaceId, target) : target;
            controller.enqueue(frame("note", { kind: "note", title: r.title, body: r.body ?? "", url, tag: `${r.type}:${target}`, at: r.createdAt.getTime() }));
          }
        } catch (err) {
          log.warn("device.replay_failed", { message: err instanceof Error ? err.message : String(err) });
        }
      }

      timers.push(setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          end();
        }
      }, PING_MS));
      timers.push(setInterval(() => {
        void (async () => {
          const still = await deviceByToken(token);
          if (!still || !(await lineAllowed(device.userId))) end();
          else await touchDevice(device.id);
        })().catch(() => undefined);
      }, RECHECK_MS));
    },
    cancel() {
      close?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
