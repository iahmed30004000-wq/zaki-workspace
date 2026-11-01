"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollMs } from "@/lib/economy";

/**
 * The one realtime seam for every UI agent: useRealtime / useTyping / useOnline.
 *
 * ONE shared EventSource per tab (module singleton with ref counting), automatic
 * reconnect, a polling fallback after 3 failed stream attempts (synthetic
 * `conversation.changed` events make the UI refetch through the normal APIs),
 * a pause when the tab is hidden for more than 60 s (with a refetch on return)
 * and `navigator.onLine` awareness.
 */

export type RealtimeEventPayload = {
  kind: string;
  conversationId?: string;
  messageId?: string;
  spaceId?: string;
  userId?: string;
  callId?: string;
};

type Handler = (e: RealtimeEventPayload) => void;

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
}

// eslint-disable-next-line init-declarations
let stream: SharedStream | null = null;

const POLL_MS = 15_000;
const HIDDEN_PAUSE_MS = 60_000;

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
  };
  return stream;
}

function dispatch(payload: RealtimeEventPayload): void {
  if (!stream) return;
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
    dispatch({ kind: "conversation.changed" });
  }, pollMs(POLL_MS));
}

function teardown(): void {
  if (!stream) return;
  if (stream.es) {
    stream.es.close();
    stream.es = null;
  }
  stopPolling();
  if (stream.reconnectTimer) {
    clearTimeout(stream.reconnectTimer);
    stream.reconnectTimer = null;
  }
}

function connect(): void {
  if (!stream || stream.es) return;
  if (!stream.online || stream.paused) return;
  // A reconnect asks for what it missed: the route replays the visible events after this id (or
  // sends `reload`). EventSource cannot set the Last-Event-ID header on a new object, so a query.
  const since = stream.lastEventId ? `?lastEventId=${encodeURIComponent(stream.lastEventId)}` : "";
  const es = new EventSource(`/api/rt${since}`);
  stream.es = es;
  es.onopen = () => {
    if (stream) stream.failures = 0;
    stopPolling();
  };
  es.onmessage = (m) => {
    try {
      const payload = JSON.parse(m.data) as RealtimeEventPayload;
      if (m.lastEventId) stream!.lastEventId = m.lastEventId;
      dispatch(payload);
    } catch {
      // a malformed frame never takes the tab down
    }
  };
  es.onerror = () => {
    if (!stream) return;
    es.close();
    stream.es = null;
    stream.failures++;
    if (stream.failures >= 3) startPolling();
    // EventSource would retry on its own; since we closed it, retry ourselves with a small backoff.
    stream.reconnectTimer = setTimeout(connect, Math.min(10_000, 500 * stream.failures));
  };
  // The server's named event for an unknown Last-Event-ID gap.
  es.addEventListener("reload", () => {
    dispatch({ kind: "conversation.changed" });
  });
}

function refetchAfterHidden(): void {
  dispatch({ kind: "conversation.changed" });
}

function onVisibility(): void {
  if (!stream) return;
  if (typeof document === "undefined") return;
  if (document.hidden) {
    stream.hiddenSince = Date.now();
  } else {
    const hiddenFor = stream.hiddenSince ? Date.now() - stream.hiddenSince : 0;
    stream.hiddenSince = null;
    if (hiddenFor > HIDDEN_PAUSE_MS || stream.paused) {
      stream.paused = false;
      connect();
      refetchAfterHidden();
    }
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
  } else {
    stream.paused = false;
    connect();
  }
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
    connect();
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
  const s = acquire();
  s.handlers.add(handler);
  return () => {
    s.handlers.delete(handler);
    release();
  };
}

/** Test hook: the current shared stream state (never call from app code). */
export function streamStateForTests(): { refs: number; failures: number; lastEventId: string; polling: boolean } | null {
  if (!stream) return null;
  return { refs: stream.refs, failures: stream.failures, lastEventId: stream.lastEventId, polling: stream.pollTimer !== null };
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
