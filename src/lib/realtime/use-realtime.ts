"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollMs } from "@/lib/economy";
import { EMOJI_EFFECT_EVENT } from "@/lib/chat/emoji-anim";

/**
 * The one realtime seam for every UI agent: useRealtime / useTyping / useOnline.
 *
 * C1.3 - ONE line per BROWSER. The tabs of a browser race for the Web Lock "zk-rt"; the winner (the LEADER) owns the EventSource and
 * re-broadcasts every frame on a BroadcastChannel "zk-rt"; the others (FOLLOWERS) open no stream and hear the leader. When the leader
 * closes or dies another tab takes the lock, resumes from the last event id it heard and asks the screens to refetch. A browser without
 * Web Locks or BroadcastChannel keeps the old way: one stream per tab ("solo"). What the leader must do for everybody:
 *  - tell the server the OR of every tab's visibility (F0.5: a hidden leader must not swallow the push of a visible follower);
 *  - pause the stream only when EVERY tab has been hidden for 60 s (F0.3), and wake when any tab is shown;
 *  - say `evicted` and `signed_out` to every tab (F0.2), and send its refetch signals (reload, polling, resume) to every tab.
 * A follower that hears nothing from the leader for 60 s polls every 15 s, like a stream that is down.
 *
 * One shared stream per tab (module singleton with ref counting), automatic
 * reconnect with jitter, a polling fallback after 3 failed stream attempts (synthetic
 * `conversation.changed` events make the UI refetch through the normal APIs),
 * a 60 s watchdog (the server pings every 25 s; any frame resets it), a real pause when
 * the tab has been hidden for 60 s (the stream closes; on return it resumes from the last
 * event id with a refetch), `navigator.onLine` awareness, and the server's goodbye:
 * `bye` + `signed_out` goes to the sign-in page, `bye` + `evicted` stops reconnecting
 * (it would evict another of the person's streams: ping-pong) and polls every 60 s.
 */

export type RealtimeEventPayload = {
  kind: string;
  conversationId?: string;
  messageId?: string;
  spaceId?: string;
  userId?: string;
  callId?: string;
  /** Set by the server on the reader's OWN `conversation.read` frames: my other tab or device read it (my badge follows). */
  self?: boolean;
  /** Made by the page itself (a reconnect, a poll, a return to the tab): "ask again", not something that happened. */
  synthetic?: boolean;
};

type Handler = (e: RealtimeEventPayload) => void;

/** What the tabs of one browser say to each other over the channel. */
type LineMessage =
  | { t: "frame"; payload: RealtimeEventPayload; id?: string }
  | { t: "alive" }
  | { t: "leader" }
  | { t: "hello" }
  | { t: "vis"; tab: string; visible: boolean }
  | { t: "gone"; tab: string }
  | { t: "evicted"; value: boolean }
  | { t: "signed_out" };

interface SharedStream {
  es: EventSource | null;
  refs: number;
  handlers: Set<Handler>;
  /** conversationId -> handler (called whenever that conversation's typing set changes). */
  typingHandlers: Set<(conversationId: string) => void>;
  typingByConversation: Map<string, Map<string, { name: string; at: number }>>;
  pollTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  failures: number;
  hiddenSince: number | null;
  lastEventId: string;
  online: boolean;
  paused: boolean;
  /** a silent stream is closed and reopened after WATCHDOG_MS without any frame */
  watchdog: ReturnType<typeof setTimeout> | null;
  /** the tab has been hidden for HIDDEN_PAUSE_MS: the stream closes */
  hiddenTimer: ReturnType<typeof setTimeout> | null;
  /** the server said `bye` + `evicted`: another stream of this person took this one's place */
  evicted: boolean;
  /** the screens that want to know when somebody comes or goes (the people dock); they also hear every refetch signal */
  presenceHandlers: Set<Handler>;
  /** this browser can share ONE stream between its tabs (Web Locks + BroadcastChannel); false: one stream per tab, as before */
  useLocks: boolean;
  /** this tab holds the lock and owns the stream */
  leader: boolean;
  channel: BroadcastChannel | null;
  /** cancels a request for the lock that was not granted yet */
  lockAbort: AbortController | null;
  /** ends the leadership: resolves the promise that holds the lock */
  releaseLock: (() => void) | null;
  /** the leader's view of the other tabs: tab id -> visible (and when it said so) */
  peers: Map<string, { visible: boolean; at: number }>;
  /** a follower: no sign of life from the leader for LEADER_SILENCE_MS -> poll */
  silence: ReturnType<typeof setTimeout> | null;
  /** another tab was seen leading: so a takeover means a gap, and the screens refetch */
  sawLeader: boolean;
  /** what this stream's owner last told the server about the browser's visibility */
  reported: boolean | null;
}

// eslint-disable-next-line init-declarations
let stream: SharedStream | null = null;

/** This tab's own id: the server keeps the visibility each tab reports under it (F0.5). One per page load, kept across reconnects. */
let tabId = "";
function tab(): string {
  if (!tabId) {
    tabId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
  return tabId;
}

/** Tell the server whether this tab is being looked at: it holds a push back only for a person who has a visible tab. */
function sendVisibility(visible: boolean): void {
  if (typeof document === "undefined" || typeof fetch === "undefined") return;
  void Promise.resolve(
    fetch("/api/rt/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visible, tab: tab() }),
      keepalive: true,
    }),
  ).catch(() => undefined);
}

/** Is THIS tab being looked at? */
function ownVisible(): boolean {
  return typeof document === "undefined" ? true : document.visibilityState !== "hidden" && !document.hidden;
}

/** Is ANY tab of this browser being looked at? (this one, or a follower that said so lately; the leader keeps that list) */
function anyVisible(): boolean {
  if (ownVisible()) return true;
  if (!stream) return false;
  const now = Date.now();
  for (const p of stream.peers.values()) if (p.visible && now - p.at <= PEER_FRESH_MS) return true;
  return false;
}

/**
 * Tell the server whether this browser is being looked at: it holds a push back only for a person who has a visible tab. The stream
 * belongs to the LEADER, so the leader reports - for everybody (the OR of its own tab and the followers it heard); a follower says
 * its own state to the leader over the channel and never posts.
 */
function reportVisibility(onlyIfChanged = false): void {
  const s = stream;
  if (s?.useLocks && !s.leader) {
    postLine({ t: "vis", tab: tab(), visible: ownVisible() });
    return;
  }
  const visible = anyVisible();
  // a follower's answer that changes nothing is not worth a request (every ping makes every tab answer; the ping's own report is the heartbeat)
  if (onlyIfChanged && s && s.reported === visible) return;
  if (s) s.reported = visible;
  sendVisibility(visible);
}

function postLine(message: LineMessage): void {
  try {
    stream?.channel?.postMessage(message);
  } catch {
    // a closed channel: the tab is going away
  }
}

const LOCK_NAME = "zk-rt";
const CHANNEL_NAME = "zk-rt";
/** a follower's "visible" is believed for this long without hearing it again (the leader's pings ask every 25 s) */
const PEER_FRESH_MS = 75_000;
/** a follower that hears nothing from the leader for this long polls, like a stream that is down */
const LEADER_SILENCE_MS = 60_000;

/** One stream for all the tabs of this browser is possible: Web Locks to elect the owner, BroadcastChannel to share what it hears. */
function linesAvailable(): boolean {
  if (typeof navigator === "undefined" || typeof BroadcastChannel === "undefined") return false;
  const locks = (navigator as { locks?: { request?: unknown } }).locks;
  return !!locks && typeof locks.request === "function";
}

const POLL_MS = 15_000;
const EVICTED_POLL_MS = 60_000;
const HIDDEN_PAUSE_MS = 60_000;
const WATCHDOG_MS = 60_000;

/** Backoff with ±30 % jitter, so a restart of the server does not bring every tab back in the same instant. */
function reconnectDelay(failures: number): number {
  return Math.min(10_000, 500 * failures) * (0.7 + 0.6 * Math.random());
}

/** The people who want to know that this tab's stream was taken over by another (the small line). */
const evictedHandlers = new Set<(evicted: boolean) => void>();
function setEvicted(value: boolean): void {
  if (!stream || stream.evicted === value) return;
  stream.evicted = value;
  for (const h of evictedHandlers) h(value);
  if (stream.leader) postLine({ t: "evicted", value }); // every tab of the browser shows the small line
}

function armWatchdog(): void {
  if (!stream) return;
  if (stream.watchdog) clearTimeout(stream.watchdog);
  stream.watchdog = setTimeout(() => {
    // 60 s without a single frame (the server pings every 25 s): the connection is half-open; reopen it
    if (!stream?.es) return;
    stream.es.close();
    stream.es = null;
    stream.failures++;
    stream.reconnectTimer = setTimeout(connect, reconnectDelay(stream.failures));
  }, WATCHDOG_MS);
}

function clearWatchdog(): void {
  if (stream?.watchdog) {
    clearTimeout(stream.watchdog);
    stream.watchdog = null;
  }
}

function ensureStream(): SharedStream {
  if (stream) return stream;
  stream = {
    es: null,
    refs: 0,
    handlers: new Set(),
    typingHandlers: new Set(),
    typingByConversation: new Map(),
    pollTimer: null,
    reconnectTimer: null,
    failures: 0,
    hiddenSince: null,
    lastEventId: "",
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    paused: false,
    watchdog: null,
    hiddenTimer: null,
    evicted: false,
    presenceHandlers: new Set(),
    useLocks: false,
    leader: false,
    channel: null,
    lockAbort: null,
    releaseLock: null,
    peers: new Map(),
    silence: null,
    sawLeader: false,
    reported: null,
  };
  return stream;
}

function dispatch(payload: RealtimeEventPayload): void {
  if (!stream) return;
  if (payload.kind === "presence.changed") {
    // stream-only, for the people dock: never a screen's handler (they would refetch a whole conversation for it)
    for (const h of stream.presenceHandlers) h(payload);
    return;
  }
  if (payload.kind === "emoji.effect") {
    // stream-only, for the one big emoji that is on screen: no screen's handler (they would refetch the conversation for it)
    if (payload.messageId && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EMOJI_EFFECT_EVENT, { detail: { messageId: payload.messageId } }));
    return;
  }
  if (payload.kind === "typing" && payload.conversationId && payload.userId) {
    // In-memory typing state per tab: 6 s expiry, mirroring the server's hub TTL.
    const cv = payload.conversationId;
    const entry = stream.typingByConversation.get(cv) ?? new Map();
    entry.set(payload.userId, { name: (payload as { name?: string }).name ?? "", at: Date.now() });
    stream.typingByConversation.set(cv, entry);
    for (const h of stream.typingHandlers) h(cv);
    return;
  }
  if (payload.kind === "message.created" && payload.conversationId) {
    // a fresh message clears the typing bubble of its conversation — and is then handed to the
    // screens like every other event (it used to stop here, so no screen ever saw a new message)
    stream.typingByConversation.delete(payload.conversationId);
    for (const h of stream.typingHandlers) h(payload.conversationId);
  }
  for (const h of stream.handlers) h(payload);
  // a refetch signal (reload, resume, polling) also tells the people dock to ask again
  if (payload.synthetic) for (const h of stream.presenceHandlers) h(payload);
}

/** A refetch signal made by the page; the leader also sends it to the other tabs (they would otherwise never hear of a reconnect). */
function dispatchSynthetic(payload: RealtimeEventPayload): void {
  const made = { ...payload, synthetic: true };
  dispatch(made);
  if (stream?.leader) postLine({ t: "frame", payload: made });
}

function stopPolling(): void {
  if (stream?.pollTimer) {
    clearInterval(stream.pollTimer);
    stream.pollTimer = null;
  }
}

function startPolling(): void {
  if (!stream || stream.pollTimer) return;
  stream.pollTimer = setInterval(() => {
    // A synthetic event: the UI refetches through the normal APIs (authorization applies there).
    dispatchSynthetic({ kind: "conversation.changed" });
  }, pollMs(POLL_MS));
}

/** The slow fallback of a tab whose live stream another tab took over: a refetch every 60 s, no stream (F0.2). */
function startEvictedPolling(): void {
  if (!stream || stream.pollTimer) return;
  stream.pollTimer = setInterval(() => {
    dispatchSynthetic({ kind: "conversation.changed" });
  }, pollMs(EVICTED_POLL_MS));
}

function teardown(): void {
  if (!stream) return;
  if (stream.es) {
    stream.es.close();
    stream.es = null;
  }
  stopPolling();
  clearWatchdog();
  if (stream.hiddenTimer) {
    clearTimeout(stream.hiddenTimer);
    stream.hiddenTimer = null;
  }
  if (stream.reconnectTimer) {
    clearTimeout(stream.reconnectTimer);
    stream.reconnectTimer = null;
  }
  if (stream.silence) {
    clearTimeout(stream.silence);
    stream.silence = null;
  }
  if (stream.useLocks) {
    // the stream is closed above; now the others hear that this tab is gone, and the lock goes to the next tab in the queue
    postLine({ t: "gone", tab: tab() });
    stream.lockAbort?.abort();
    stream.lockAbort = null;
    const release = stream.releaseLock;
    stream.releaseLock = null;
    stream.leader = false;
    try {
      stream.channel?.close();
    } catch {
      // already closed
    }
    stream.channel = null;
    release?.();
  }
}

function connect(): void {
  if (!stream || stream.es) return;
  if (stream.useLocks && !stream.leader) return; // a follower hears the leader; it opens no stream
  if (!stream.online || stream.paused || stream.evicted) return;
  // A reconnect asks for what it missed: the route replays the visible events after this id (or
  // sends `reload`). EventSource cannot set the Last-Event-ID header on a new object, so a query.
  const since = stream.lastEventId ? `&lastEventId=${encodeURIComponent(stream.lastEventId)}` : "";
  const es = new EventSource(`/api/rt?tab=${encodeURIComponent(tab())}${since}`);
  stream.es = es;
  armWatchdog();
  es.onopen = () => {
    if (stream) stream.failures = 0;
    stopPolling();
    armWatchdog();
    reportVisibility(); // a tab opened in the background says so from the start
  };
  es.onmessage = (m) => {
    armWatchdog();
    try {
      const payload = JSON.parse(m.data) as RealtimeEventPayload;
      if (m.lastEventId) stream!.lastEventId = m.lastEventId;
      dispatch(payload);
      if (stream?.leader) postLine({ t: "frame", payload, ...(m.lastEventId ? { id: m.lastEventId } : {}) });
    } catch {
      // a malformed frame never takes the tab down
    }
  };
  es.onerror = () => {
    if (!stream) return;
    es.close();
    stream.es = null;
    clearWatchdog();
    stream.failures++;
    if (stream.failures >= 3) startPolling();
    // EventSource would retry on its own; since we closed it, retry ourselves with a small backoff (with jitter).
    stream.reconnectTimer = setTimeout(connect, reconnectDelay(stream.failures));
  };
  // The server's named event for an unknown Last-Event-ID gap.
  es.addEventListener("reload", () => {
    armWatchdog();
    dispatchSynthetic({ kind: "conversation.changed" });
  });
  // The server's heartbeat: a real event (a browser never surfaces an SSE comment), so any silence is noticed.
  // and the page says again whether it is looked at, so one report that was lost never leaves the server believing a stale state
  es.addEventListener("ping", () => {
    armWatchdog();
    reportVisibility();
    evaluatePause(); // a follower that froze without a word went stale since the last beat: nobody may be looking any more
    postLine({ t: "alive" }); // the followers answer with how they stand, and know the leader is alive
  });
  // The server ended this stream and said why.
  es.addEventListener("bye", (m) => {
    let reason = "";
    try {
      reason = String((JSON.parse((m as MessageEvent).data) as { reason?: string }).reason ?? "");
    } catch {
      // an unreadable goodbye is treated as a plain loss
    }
    if (!stream) return;
    es.close();
    stream.es = null;
    clearWatchdog();
    if (reason === "signed_out") {
      postLine({ t: "signed_out" });
      goToSignIn();
      return;
    }
    if (reason === "evicted") {
      // reconnecting would evict another of this person's streams (ping-pong): stay quiet, refetch every 60 s, say so
      setEvicted(true);
      startEvictedPolling();
      return;
    }
    stream.failures++;
    stream.reconnectTimer = setTimeout(connect, reconnectDelay(stream.failures));
  });
}

function goToSignIn(): void {
  if (typeof window !== "undefined") window.location.assign("/login");
}

/** The screens refetch after a return from hiding; the leader tells the other tabs too when it was the one that slept. */
function refetchAfterHidden(broadcast = true): void {
  if (broadcast) dispatchSynthetic({ kind: "conversation.changed" });
  else dispatch({ kind: "conversation.changed", synthetic: true });
}

/**
 * Pause when NOBODY is looking: this tab and, for a leader, every follower have been hidden for 60 s. The stream closes and frees the
 * server's slot; any tab being shown wakes it (a follower tells the leader over the channel). A follower never pauses: it has no stream.
 */
function evaluatePause(): void {
  const s = stream;
  if (!s || (s.useLocks && !s.leader)) return;
  if (anyVisible()) {
    if (s.hiddenTimer) {
      clearTimeout(s.hiddenTimer);
      s.hiddenTimer = null;
    }
    return;
  }
  if (s.hiddenTimer || s.paused) return;
  s.hiddenTimer = setTimeout(() => {
    s.hiddenTimer = null;
    if (stream !== s || anyVisible()) return;
    s.paused = true;
    if (s.es) {
      s.es.close();
      s.es = null;
    }
    clearWatchdog();
  }, HIDDEN_PAUSE_MS);
}

function onVisibility(): void {
  const s = stream;
  if (!s) return;
  if (typeof document === "undefined") return;
  reportVisibility();
  if (document.hidden) {
    s.hiddenSince = Date.now();
    evaluatePause();
    return;
  }
  if (s.hiddenTimer) {
    clearTimeout(s.hiddenTimer);
    s.hiddenTimer = null;
  }
  const hiddenFor = s.hiddenSince ? Date.now() - s.hiddenSince : 0;
  s.hiddenSince = null;
  if (s.useLocks && !s.leader) {
    // a follower has no stream to wake; after a long sleep its own screens refetch (it heard the leader meanwhile, so this is a safety)
    if (hiddenFor > HIDDEN_PAUSE_MS) refetchAfterHidden(false);
    return;
  }
  if (s.useLocks && !s.paused) {
    // the leader was hidden while a follower was looking: its stream never stopped
    if (hiddenFor > HIDDEN_PAUSE_MS) refetchAfterHidden(false);
    return;
  }
  if (hiddenFor > HIDDEN_PAUSE_MS || s.paused) {
    s.paused = false;
    connect();
    refetchAfterHidden();
  }
}

function onOfflineOnline(): void {
  if (!stream) return;
  stream.online = navigator.onLine;
  if (!stream.online) {
    if (stream.es) {
      stream.es.close();
      stream.es = null;
    }
  } else if (typeof document !== "undefined" && !anyVisible()) {
    // back online but nobody is looking: stay paused (the return of the tab reconnects), do not take a stream slot
    stream.paused = true;
  } else {
    stream.paused = false;
    connect();
  }
}

// ───────────────────────────── one line per browser ─────────────────────────────

/** A follower waits for a sign of life from the leader; with none for LEADER_SILENCE_MS it polls, like a stream that is down. */
function armSilence(): void {
  const s = stream;
  if (!s) return;
  if (s.silence) clearTimeout(s.silence);
  s.silence = setTimeout(() => {
    s.silence = null;
    if (stream !== s || !s.useLocks || s.leader) return;
    // a tab nobody is looking at has nothing to refetch for; the leader may be paused because EVERY tab is hidden (it pings no more)
    if (!ownVisible()) {
      armSilence();
      return;
    }
    startPolling();
  }, LEADER_SILENCE_MS);
}

/** A follower heard the leader: its silence timer starts again, and a poll that the silence started stops. */
function hearLeader(): void {
  const s = stream;
  if (!s) return;
  s.sawLeader = true;
  if (!s.leader) stopPolling();
  armSilence();
}

/** The leader heard that the set of visible tabs changed: report the OR, and pause or wake as that asks. */
function peersChanged(): void {
  const s = stream;
  if (!s || !s.leader) return;
  reportVisibility(true);
  if (anyVisible() && s.paused) {
    s.paused = false;
    connect();
    refetchAfterHidden();
  } else {
    evaluatePause();
  }
}

function onLine(message: LineMessage): void {
  const s = stream;
  if (!s || !message || typeof message !== "object") return;
  switch (message.t) {
    case "frame":
      if (s.leader) return;
      hearLeader();
      if (message.id) s.lastEventId = message.id;
      dispatch(message.payload);
      return;
    case "alive":
    case "leader":
      if (s.leader) return;
      hearLeader();
      reportVisibility(); // the leader asks how this tab stands
      return;
    case "hello":
      if (s.leader) {
        postLine({ t: "leader" });
        if (s.evicted) postLine({ t: "evicted", value: true }); // a tab opened later shows the small line too
      }
      return;
    case "vis":
      if (!s.leader) return;
      s.peers.set(message.tab, { visible: message.visible, at: Date.now() });
      peersChanged();
      return;
    case "gone":
      if (!s.leader) return;
      s.peers.delete(message.tab);
      peersChanged();
      return;
    case "evicted":
      if (!s.leader) setEvicted(message.value);
      return;
    case "signed_out":
      if (!s.leader) goToSignIn();
      return;
  }
}

/** This tab has the lock: it owns the stream from now on. */
function becomeLeader(): void {
  const s = stream;
  if (!s) return;
  s.leader = true;
  if (s.silence) {
    clearTimeout(s.silence);
    s.silence = null;
  }
  stopPolling();
  s.paused = false;
  if (s.hiddenTimer) {
    clearTimeout(s.hiddenTimer);
    s.hiddenTimer = null;
  }
  s.peers.clear();
  s.reported = null;
  // the old leader may have been evicted by another browser: try again, it may be gone now
  if (s.evicted) setEvicted(false);
  postLine({ t: "leader" }); // the followers answer with how they stand
  connect();
  // somebody else was leading before: what came in between was never heard, so every screen asks again
  if (s.sawLeader) dispatchSynthetic({ kind: "conversation.changed" });
  evaluatePause();
}

function requestLeadership(s: SharedStream): void {
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
  s.lockAbort = ac;
  const locks = (navigator as unknown as { locks: { request: (name: string, options: object, cb: () => Promise<void>) => Promise<unknown> } }).locks;
  void locks
    .request(LOCK_NAME, ac ? { mode: "exclusive", signal: ac.signal } : { mode: "exclusive" }, () =>
      new Promise<void>((resolve) => {
        // the screens left (or the module was reset) while this request waited: let the next tab have it
        if (stream !== s || s.refs <= 0) {
          resolve();
          return;
        }
        s.lockAbort = null;
        s.releaseLock = resolve;
        becomeLeader();
      }),
    )
    .catch(() => undefined); // aborted: this tab stopped listening before it was ever leader
}

function onPageHide(): void {
  postLine({ t: "gone", tab: tab() });
}

function onPageShow(): void {
  if (!stream?.useLocks || stream.leader) return;
  postLine({ t: "hello" });
  reportVisibility();
}

function startLine(s: SharedStream): void {
  s.useLocks = true;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (m: MessageEvent) => onLine(m.data as LineMessage);
  s.channel = channel;
  // a tab that opens while a leader is running learns it fast (the leader answers), and says how it stands
  postLine({ t: "hello" });
  reportVisibility();
  armSilence(); // until a leader is heard (the lock below ends it for the first tab)
  requestLeadership(s);
}

function acquire(): SharedStream {
  const s = ensureStream();
  s.refs++;
  if (s.refs === 1) {
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOfflineOnline);
      window.addEventListener("offline", onOfflineOnline);
    }
    if (linesAvailable()) {
      if (typeof window !== "undefined") {
        window.addEventListener("pagehide", onPageHide);
        window.addEventListener("pageshow", onPageShow);
      }
      startLine(s);
    } else {
      connect();
    }
  }
  return s;
}

function release(): void {
  if (!stream) return;
  stream.refs--;
  if (stream.refs > 0) return;
  teardown();
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  if (typeof window !== "undefined") {
    window.removeEventListener("online", onOfflineOnline);
    window.removeEventListener("offline", onOfflineOnline);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
  }
  stream = null;
}

/** Test hook: reset the module singleton (never call from app code). */
export function resetRealtimeForTests(): void {
  teardown();
  stream = null;
}

/** Test hook: subscribe a handler to the shared stream without React, as useRealtime does (never call from app code). */
export function subscribeForTests(handler: Handler): () => void {
  return subscribeRealtime(handler);
}

/**
 * Listen to the live line without React (the hooks and `watchFrames` of live-refresh.ts are built on it). `handler` hears every
 * frame a screen cares about; `presence` hears `presence.changed` and every refetch signal, never a screen's frames. Returns the
 * function that stops listening (the last one to stop closes the stream, or hands the lock on).
 */
export function subscribeRealtime(handler: Handler | null, presence?: Handler): () => void {
  const s = acquire();
  if (handler) s.handlers.add(handler);
  if (presence) s.presenceHandlers.add(presence);
  return () => {
    if (handler) s.handlers.delete(handler);
    if (presence) s.presenceHandlers.delete(presence);
    release();
  };
}

export type StreamRole = "solo" | "leader" | "follower";

/** Test hook: the current shared stream state (never call from app code). */
export function streamStateForTests(): { refs: number; failures: number; lastEventId: string; polling: boolean; evicted: boolean; role: StreamRole } | null {
  if (!stream) return null;
  return {
    refs: stream.refs,
    failures: stream.failures,
    lastEventId: stream.lastEventId,
    polling: stream.pollTimer !== null,
    evicted: stream.evicted,
    role: stream.useLocks ? (stream.leader ? "leader" : "follower") : "solo",
  };
}

/** Test hook: who is typing in a conversation, as this tab knows it (never call from app code). */
export function typingStateForTests(conversationId: string): string[] {
  const entry = stream?.typingByConversation.get(conversationId);
  return entry ? [...entry.values()].map((v) => v.name) : [];
}

/** Was this tab's stream taken over by another tab (a screen opened later still needs to know)? */
export function streamEvictedNow(): boolean {
  return stream?.evicted ?? false;
}

/** True while this tab's live stream was taken over by another tab of the same person (F0.2): the screen says so once. */
export function useStreamEvicted(): boolean {
  const [evicted, setValue] = useState(() => streamEvictedNow());
  useEffect(() => {
    const h = (v: boolean) => setValue(v);
    evictedHandlers.add(h);
    return () => {
      evictedHandlers.delete(h);
    };
  }, []);
  return evicted;
}

export function useRealtime(handler: Handler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const wrapped: Handler = (e) => ref.current(e);
    const s = acquire();
    s.handlers.add(wrapped);
    return () => {
      s.handlers.delete(wrapped);
      release();
    };
  }, []);
}


export interface TypingState {
  typingNames: string[];
  notifyTyping: () => void;
}

export function useTyping(conversationId: string | null): TypingState {
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const lastSent = useRef(0);

  useEffect(() => {
    if (!conversationId) return;
    const s = acquire();
    const TYPING_TTL_MS = 6000;
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = () => {
      const entry = s.typingByConversation.get(conversationId);
      const now = Date.now();
      const names: string[] = [];
      if (entry) {
        for (const [uid, v] of entry) {
          if (now - v.at > TYPING_TTL_MS) entry.delete(uid);
          else names.push(v.name);
        }
      }
      setTypingNames(names);
    };
    const handler = (cv: string) => {
      if (cv === conversationId) refresh();
    };
    s.typingHandlers.add(handler);
    refresh();
    // The expiry is client-side too: an entry older than 6 s disappears even without a new event.
    timer = setInterval(refresh, 2000);
    return () => {
      s.typingHandlers.delete(handler);
      if (timer) clearInterval(timer);
      release();
    };
  }, [conversationId]);

  const notifyTyping = useCallback(() => {
    if (!conversationId) return;
    const now = Date.now();
    if (now - lastSent.current < 3000) return;
    lastSent.current = now;
    void fetch("/api/rt/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    }).catch(() => undefined);
  }, [conversationId]);

  return { typingNames, notifyTyping };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
