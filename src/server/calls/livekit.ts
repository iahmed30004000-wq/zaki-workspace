import { SignJWT } from "jose";
import { ForbiddenError } from "@/server/auth";
import { log } from "@/server/log";

/**
 * THE CALLS SERVER — LiveKit, free and self-hosted on the owner's Coolify (service «zaki-calls»,
 * https://calls.workspace.zakiai.io). This module is the only place that talks to it: it signs the short pass a browser
 * joins a room with, and asks the server who is in a room or takes somebody out of it (its RoomService API).
 *
 * The three settings are read from the CURRENT process.env on every call (like `appUrl()`), so a test or a
 * fresh Coolify variable needs no restart of the module. None of them is ever logged or sent to a browser,
 * except the public address the browser connects to.
 */

export interface CallsServer {
  /** where browsers connect: wss://calls.workspace.zakiai.io */
  url: string;
  /** the same server over https, for its RoomService API */
  httpUrl: string;
  apiKey: string;
  apiSecret: string;
}

/** A browser's pass lives two minutes: enough to connect; LiveKit refreshes it for whoever is already in. */
export const PASS_TTL_SECONDS = 120;

/** The calls server's settings, or null while Coolify has none (the app still runs; calls say so). */
export function callsServer(source: NodeJS.ProcessEnv = process.env): CallsServer | null {
  const url = (source["LIVEKIT_URL"] ?? "").trim().replace(/\/+$/, "");
  const apiKey = (source["LIVEKIT_API_KEY"] ?? "").trim();
  const apiSecret = (source["LIVEKIT_API_SECRET"] ?? "").trim();
  if (!url || !apiKey || !apiSecret) return null;
  if (!/^wss?:\/\//.test(url)) return null;
  return { url, httpUrl: url.replace(/^ws/, "http"), apiKey, apiSecret };
}

export function requireCallsServer(): CallsServer {
  const server = callsServer();
  if (!server) throw new ForbiddenError("calls.e.not_configured");
  return server;
}

/** The room of a call on the calls server. */
export const roomOf = (callId: string): string => `zk-${callId}`;

interface VideoGrant {
  room?: string;
  roomJoin?: boolean;
  roomAdmin?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
}

async function sign(server: CallsServer, claims: { sub?: string; name?: string; video: VideoGrant; metadata?: string }, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ video: claims.video, ...(claims.name ? { name: claims.name } : {}), ...(claims.metadata ? { metadata: claims.metadata } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(server.apiKey)
    .setNotBefore(now - 5)
    .setExpirationTime(now + ttlSeconds);
  if (claims.sub) jwt.setSubject(claims.sub).setJti(claims.sub);
  return jwt.sign(new TextEncoder().encode(server.apiSecret));
}

/** The pass ONE person joins ONE call's room with (their user id is their identity there). */
export async function passFor(server: CallsServer, opts: { callId: string; userId: string; name: string }): Promise<string> {
  return sign(
    server,
    {
      sub: opts.userId,
      name: opts.name,
      video: { room: roomOf(opts.callId), roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
    },
    PASS_TTL_SECONDS,
  );
}

/** The identity the assistant joins a room with (never a user id: people's identities are user ids). */
export const ASSISTANT_IDENTITY = "assistant";

/** The pass the voice agent (the assistant) joins ONE call's room with: it listens and speaks, nothing else; valid for five minutes. */
export async function assistantPass(server: CallsServer, callId: string): Promise<string> {
  return sign(
    server,
    {
      sub: ASSISTANT_IDENTITY,
      name: "المساعد",
      metadata: JSON.stringify({ bot: true }),
      video: { room: roomOf(callId), roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
    },
    300,
  );
}

// ---------- RoomService (server to server) ----------

type Fetch = typeof fetch;

let fetchImpl: Fetch | null = null;

/** Test hook: answer the calls server's API without a calls server (never call from server code). */
export function setCallsFetchForTests(next: Fetch | null): void {
  fetchImpl = next;
}

async function roomService<T>(server: CallsServer, method: string, room: string, body: Record<string, unknown>): Promise<T | null> {
  const token = await sign(server, { video: { room, roomAdmin: true } }, 60);
  const res = await (fetchImpl ?? fetch)(`${server.httpUrl}/twirp/livekit.RoomService/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ room, ...body }),
    signal: AbortSignal.timeout(5000),
  });
  // a room nobody has opened yet (or that emptied out) does not exist on the server
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`calls server ${method}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The identities (user ids) in a call's room right now; [] for a room that does not exist, null when the calls
 * server cannot be asked (not set up, down): "unknown" never ends a call.
 */
export async function peopleInRoom(callId: string): Promise<{ identity: string; name: string }[] | null> {
  const server = callsServer();
  if (!server) return null;
  try {
    const out = await roomService<{ participants?: { identity?: string; name?: string }[] }>(server, "ListParticipants", roomOf(callId), {});
    return (out?.participants ?? []).filter((p) => !!p.identity).map((p) => ({ identity: p.identity as string, name: p.name ?? "" }));
  } catch (err) {
    log.warn("calls.server_unreachable", { method: "ListParticipants", message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Takes one person out of a call's room now (their pass is refused from then on: CallPerson.removedAt). */
export async function dropFromRoom(callId: string, userId: string): Promise<void> {
  const server = callsServer();
  if (!server) return;
  try {
    await roomService(server, "RemoveParticipant", roomOf(callId), { identity: userId });
  } catch (err) {
    log.warn("calls.server_unreachable", { method: "RemoveParticipant", message: err instanceof Error ? err.message : String(err) });
  }
}

/** Ends a call's room for everybody now: the calls server closes it and every browser hears that the call ended. */
export async function closeRoom(callId: string): Promise<void> {
  const server = callsServer();
  if (!server) return;
  try {
    await roomService(server, "DeleteRoom", roomOf(callId), {});
  } catch (err) {
    log.warn("calls.server_unreachable", { method: "DeleteRoom", message: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Mutes one person's microphone in a call's room (the host's «اكتم»). They unmute themselves when they want to speak:
 * the calls server never turns a microphone on from afar. False when the calls server could not be asked.
 */
export async function muteInRoom(callId: string, userId: string): Promise<boolean> {
  const server = callsServer();
  if (!server) return false;
  try {
    const out = await roomService<{ participants?: { identity?: string; tracks?: { sid?: string; type?: string; source?: string }[] }[] }>(
      server,
      "ListParticipants",
      roomOf(callId),
      {},
    );
    const person = (out?.participants ?? []).find((p) => p.identity === userId);
    const mics = (person?.tracks ?? []).filter((t) => t.sid && (t.source === "MICROPHONE" || (t.source === undefined && t.type === "AUDIO")));
    for (const track of mics) {
      await roomService(server, "MutePublishedTrack", roomOf(callId), { identity: userId, track_sid: track.sid, muted: true });
    }
    return true;
  } catch (err) {
    log.warn("calls.server_unreachable", { method: "MutePublishedTrack", message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
