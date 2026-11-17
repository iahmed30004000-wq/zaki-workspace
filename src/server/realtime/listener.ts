import type { Client } from "pg";
import { log } from "@/server/log";
import { deliverEvent, type RtEvent } from "./hub";
import { isRealtimeKind, type RealtimeIds } from "./emit";

/**
 * The ONE Postgres LISTEN client per server process (module singleton on
 * `globalThis` so hot reload and several imports share it): LISTEN zaki_rt,
 * automatic reconnect with backoff, and on each notification the RealtimeEvent
 * row is loaded by id and handed to the hub. The FIRST connect of a process starts at the newest row (a deploy replays nothing: a
 * client that was away resumes from its own `lastEventId`, which the route replays per client); a RECONNECT replays, in the
 * background, the events with an id greater than the last one delivered, so a gap during the disconnect loses nothing. An event
 * is handed to the hub once, however it reached us (live or replay).
 */

const CHANNEL = "zaki_rt";
const REPLAY_CHUNK = 500;

interface ListenerState {
  client: Client | null;
  connecting: Promise<void> | null;
  lastId: bigint;
  /** the first connect of this process has set the cursor */
  booted: boolean;
  /** ids delivered lately (live or replay), so an event that arrives both ways is delivered once */
  recent: Set<bigint>;
  attempts: number;
  stopped: boolean;
  url: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __zkRtListener: ListenerState | undefined;
}

function state(): ListenerState {
  if (!globalThis.__zkRtListener) {
    globalThis.__zkRtListener = {
      client: null,
      connecting: null,
      lastId: 0n,
      booted: false,
      recent: new Set<bigint>(),
      attempts: 0,
      stopped: false,
      url: "",
    };
  }
  return globalThis.__zkRtListener;
}

/** Test hook: never call from server code. */
export async function stopRealtimeListenerForTests(): Promise<void> {
  const s = state();
  s.stopped = true;
  if (s.client) {
    try {
      await s.client.end();
    } catch {
      // already closed
    }
  }
  s.client = null;
  s.connecting = null;
  globalThis.__zkRtListener = undefined;
}

/** Test hook: a process boot — the state is reset, so the cursor starts at the newest row (never call from server code). */
export async function connectListenerForTests(): Promise<void> {
  const s = state();
  s.lastId = 0n;
  s.booted = false;
  s.recent.clear();
  s.stopped = false;
  await ensureListener();
}

/** Test hook: drop ONLY the pg connection and keep the cursor, as a lost connection would (never call from server code). */
export async function dropListenerConnectionForTests(): Promise<void> {
  const s = state();
  const client = s.client;
  s.client = null;
  if (client) {
    try {
      await client.end();
    } catch {
      // already closed
    }
  }
}

/**
 * DATABASE_URL as `pg` accepts it: Prisma tolerates `?pgbouncer=true&schema=public`
 * (it configures its own engine), but the raw `pg` driver would send them to the
 * server and fail on `pgbouncer`. Keep everything else (sslmode, ...) — pg honours it.
 */
export function directPgUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const drop = new Set(["pgbouncer", "schema", "connection_limit", "connect_timeout", "pool_timeout"]);
    const kept: string[] = [];
    url.searchParams.forEach((v, k) => {
      if (!drop.has(k)) kept.push(`${k}=${v}`);
    });
    url.search = kept.length ? `?${kept.join("&")}` : "";
    return url.toString();
  } catch {
    return raw;
  }
}

function pgUrl(): string {
  const s = state();
  if (s.url) return s.url;
  const raw = process.env["DATABASE_URL"];
  if (!raw) throw new Error("DATABASE_URL is not set: the realtime listener cannot connect");
  s.url = directPgUrl(raw);
  return s.url;
}

const isKind = isRealtimeKind;

const RECENT_LIMIT = 2000;

/** True the first time an id is seen: the cursor moves forward and the id is remembered for a while. */
function firstSight(id: bigint): boolean {
  const s = state();
  if (s.recent.has(id)) return false;
  s.recent.add(id);
  if (s.recent.size > RECENT_LIMIT) s.recent.delete(s.recent.values().next().value as bigint);
  if (id > s.lastId) s.lastId = id;
  return true;
}

async function newestId(): Promise<bigint> {
  const { db } = await import("@/server/db");
  const row = await db.realtimeEvent.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
  return row?.id ?? 0n;
}

async function loadAndDeliver(id: string): Promise<void> {
  const { db } = await import("@/server/db");
  const row = await db.realtimeEvent.findUnique({ where: { id: BigInt(id) } });
  if (!row) return; // purged before delivery: the client's periodic refetch covers it
  if (!firstSight(row.id)) return;
  const ids = (row.ids ?? {}) as RealtimeIds;
  const event: RtEvent = {
    id: row.id.toString(),
    orgId: row.orgId,
    kind: isKind(row.kind) ? row.kind : "conversation.changed",
    ids,
  };
  await deliverEvent(event);
}

async function replaySince(lastId: bigint): Promise<void> {
  const { db } = await import("@/server/db");
  let cursor = lastId;
  for (;;) {
    const rows = await db.realtimeEvent.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: REPLAY_CHUNK,
      select: { id: true, orgId: true, kind: true, ids: true },
    });
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.id;
      if (!firstSight(row.id)) continue; // already delivered live
      const ids = (row.ids ?? {}) as RealtimeIds;
      await deliverEvent({
        id: row.id.toString(),
        orgId: row.orgId,
        kind: isKind(row.kind) ? row.kind : "conversation.changed",
        ids,
      });
    }
    if (rows.length < REPLAY_CHUNK) break;
  }
}

async function connectOnce(): Promise<void> {
  const { Client } = await import("pg");
  const s = state();
  const client = new Client({ connectionString: pgUrl() });
  client.on("notification", (msg) => {
    if (!msg.payload) return;
    void loadAndDeliver(msg.payload).catch((err) => {
      log.error("rt.notify_failed", { message: err instanceof Error ? err.message : String(err) });
    });
  });
  client.on("error", (err) => {
    log.error("rt.connection_lost", { message: err.message });
    s.client = null;
    scheduleReconnect();
  });
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  s.client = client;
  s.attempts = 0;
  if (!s.booted) {
    // the first connect of this process: start at the newest row, replay nothing (and do not make every stream wait for a walk)
    s.lastId = await newestId();
    s.booted = true;
  } else {
    // a reconnect: what was written while away is replayed in the background; the stream is ready as soon as LISTEN is on
    void replaySince(s.lastId).catch((err) => {
      log.error("rt.replay_failed", { message: err instanceof Error ? err.message : String(err) });
    });
  }
  log.info("rt.listening", { channel: CHANNEL });
}

function scheduleReconnect(): void {
  const s = state();
  if (s.stopped || s.connecting) return;
  s.attempts++;
  const delay = Math.min(30_000, 250 * 2 ** Math.min(s.attempts, 7));
  setTimeout(() => {
    void ensureListener();
  }, delay).unref?.();
}

/** Idempotent: every caller awaits the same connection attempt. */
export async function ensureListener(): Promise<void> {
  const s = state();
  if (s.client || s.connecting) return s.connecting ?? Promise.resolve();
  s.connecting = (async () => {
    try {
      await connectOnce();
    } catch (err) {
      log.error("rt.listen_failed", {
        message: err instanceof Error ? err.message : String(err),
        attempts: s.attempts + 1,
      });
      s.client = null;
      scheduleReconnect();
    } finally {
      s.connecting = null;
    }
  })();
  return s.connecting;
}

// The purge job lives in ./purge but the DB test suite pins it on this module
// (one entry point for the realtime persistence side); re-exported for that seam.
export { purgeRealtimeEvents, startPurgeJob, stopPurgeTimerForTests } from "./purge";
