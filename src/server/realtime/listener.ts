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
/**
 * A reconnect replays from this many ids BEFORE the cursor, not from the cursor itself: an id is taken when its row is inserted but
 * published when its transaction commits, so a lower id can become visible after a higher one was delivered. Anything delivered
 * already is skipped by `firstSight`.
 */
const REPLAY_OVERLAP = 500n;
const REPLAY_ATTEMPTS = 5;

interface ListenerState {
  client: Client | null;
  connecting: Promise<void> | null;
  lastId: bigint;
  /** the first connect of this process has set the cursor */
  booted: boolean;
  /** the newest id when this process booted: what is older was never this process's to deliver, so no replay reaches below it */
  floor: bigint;
  /** ids delivered lately (live or replay), so an event that arrives both ways is delivered once */
  recent: Set<bigint>;
  /** while a replay runs: every id delivered live in the meantime, kept without a cap so the replay never delivers one twice */
  replaying: Set<bigint> | null;
  /** test hook: how many of the next replay attempts throw */
  replayFailures: number;
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
      floor: 0n,
      recent: new Set<bigint>(),
      replaying: null,
      replayFailures: 0,
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
  s.floor = 0n;
  s.booted = false;
  s.recent.clear();
  s.stopped = false;
  await ensureListener();
}

/** Test hook: make the next `n` replay attempts throw, to prove a failed replay is retried (never call from server code). */
export function failNextReplaysForTests(n: number): void {
  state().replayFailures = n;
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
  state().replaying?.add(row.id);
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
      if (state().replaying?.has(row.id)) continue; // delivered live while this replay was running
      if (!firstSight(row.id)) continue; // already delivered
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

/**
 * The replay of a gap, retried: the live events that arrive meanwhile have already moved the cursor, so a replay that failed once
 * and was not repeated would lose the gap for good.
 */
async function replayGap(from: bigint): Promise<void> {
  const s = state();
  s.replaying = new Set();
  try {
    for (let attempt = 0; attempt < REPLAY_ATTEMPTS; attempt++) {
      try {
        if (s.replayFailures > 0) {
          s.replayFailures--;
          throw new Error("replay failed (test hook)");
        }
        await replaySince(from);
        return;
      } catch (err) {
        log.error("rt.replay_failed", { message: err instanceof Error ? err.message : String(err), attempt: attempt + 1 });
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
    }
  } finally {
    s.replaying = null;
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
  try {
    await client.query(`LISTEN ${CHANNEL}`);
    s.client = client;
    s.attempts = 0;
    if (!s.booted) {
      // the first connect of this process: start at the newest row, replay nothing (and do not make every stream wait for a walk)
      s.lastId = await newestId();
      s.floor = s.lastId;
      s.booted = true;
    } else {
      // a reconnect: what was written while away is replayed in the background (retried, from a little before the cursor); the
      // stream is ready as soon as LISTEN is on
      const back = s.lastId > REPLAY_OVERLAP ? s.lastId - REPLAY_OVERLAP : 0n;
      const from = back > s.floor ? back : s.floor;
      void replayGap(from);
    }
  } catch (err) {
    // a half-made connection must not stay open and keep delivering
    s.client = null;
    try {
      await client.end();
    } catch {
      // already closed
    }
    throw err;
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

/** Is the LISTEN connection up right now? (the health check shows it as `realtime`) */
export function listenerConnected(): boolean {
  return state().client !== null;
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
    } finally {
      s.connecting = null;
    }
    // after the attempt is over (scheduling inside it returned early: `connecting` was still set, so a failed connect never retried)
    if (!s.client) scheduleReconnect();
  })();
  return s.connecting;
}

// The purge job lives in ./purge but the DB test suite pins it on this module
// (one entry point for the realtime persistence side); re-exported for that seam.
export { purgeRealtimeEvents, startPurgeJob, stopPurgeTimerForTests } from "./purge";
