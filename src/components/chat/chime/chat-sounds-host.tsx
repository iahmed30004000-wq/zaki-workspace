"use client";

import { useEffect } from "react";
import { setChatSoundsActive } from "@/lib/chat/chime/active";
import { chimeFor, chimeFresh, chimeGate, openConversationOf } from "@/lib/chat/chime/decide";
import { playChime, primeChime } from "@/lib/chat/chime/player";
import { loadChatSoundPrefs, topicModeOf } from "@/lib/chat/chime/prefs";
import { fetchMe } from "@/lib/chat/cache/identity";
import { fetchChatJson } from "@/lib/chat/cache/http";
import { isMentioned } from "@/lib/chat/conversation/mentions";
import { soundsEnabled } from "@/lib/chat/sounds";
import { subscribeRealtime, type RealtimeEventPayload } from "@/lib/realtime/use-realtime";
import type { ConversationHeaderDto, MessagesPageDto } from "@/server/chat/dto";

/**
 * S5.1 — THE LISTENER (the owner, 2026-11-21: «ما في أصوات بالدردشات»). Mounted once by the app's layout while the company's switch `chatSounds` is on, it hears the live line and plays
 * the person's chosen tone (`src/lib/chat/chime`) for a message in ANY conversation they read, not only the open one. A frame carries ids only, so it asks the normal API who wrote the
 * message and whether the chat is muted (`GET …/header`, kept for 15 s, and `GET …/messages`): the rules are `chimeFor` and `chimeGate` (never my own message, never while the tab is hidden
 * — the push is shown then —, never in a muted chat, a topic on «الذكر بس» only for a mention, the open conversation makes its own arrival sound). Nothing here tells the server anything.
 * The audio is woken from the first touch (`primeChime`: an iPhone's Safari allows it only from a gesture).
 */

/** What the header says about a conversation, kept briefly so a busy chat does not ask for it at every message. */
const HEADER_TTL_MS = 15_000;
const headers = new Map<string, { at: number; header: Pick<ConversationHeaderDto, "kind" | "me"> }>();
let meId: string | null = null;

async function headerOf(conversationId: string): Promise<Pick<ConversationHeaderDto, "kind" | "me">> {
  const hit = headers.get(conversationId);
  if (hit && Date.now() - hit.at < HEADER_TTL_MS) return hit.header;
  const header = await fetchChatJson<ConversationHeaderDto>(`/api/chat/conversations/${encodeURIComponent(conversationId)}/header`);
  headers.set(conversationId, { at: Date.now(), header: { kind: header.kind, me: header.me } });
  return header;
}

async function myId(): Promise<string | null> {
  if (meId) return meId;
  const me = await fetchMe();
  if (me.status === "ok") meId = me.userId;
  return meId;
}

/** The ids of the messages already handled (a frame can arrive twice: the leader's line and a replay). */
const handled: string[] = [];

async function onMessage(conversationId: string, messageId: string): Promise<void> {
  const gate = chimeGate({
    enabled: soundsEnabled(),
    visible: typeof document !== "undefined" && document.visibilityState === "visible",
    openHere: openConversationOf(window.location.pathname) === conversationId,
  });
  if (!gate || handled.includes(messageId)) return;
  handled.push(messageId);
  if (handled.length > 60) handled.shift();
  const base = `/api/chat/conversations/${encodeURIComponent(conversationId)}`;
  const [header, page, me] = await Promise.all([headerOf(conversationId), fetchChatJson<MessagesPageDto>(`${base}/messages?limit=8`), myId()]);
  const message = page.messages.find((m) => m.id === messageId);
  if (!message || !me || !chimeFresh(message.createdAt, Date.now())) return;
  const prefs = loadChatSoundPrefs();
  const kind = chimeFor({
    mine: message.mine,
    silent: message.silent === true,
    system: message.kind === "SYSTEM",
    deleted: message.deleted,
    convKind: header.kind,
    muted: header.me.muted === true,
    oversight: header.me.oversight === true,
    mentionsMe: !message.mine && !message.deleted && isMentioned(message.mentions, me),
    topicMode: topicModeOf(prefs, conversationId),
  });
  if (!kind) return;
  // the page may have changed while the answers were on their way (a hidden tab, the conversation opened)
  if (!chimeGate({ enabled: soundsEnabled(), visible: document.visibilityState === "visible", openHere: openConversationOf(window.location.pathname) === conversationId })) return;
  playChime({ tone: prefs.tone, volume: prefs.volume, mention: kind === "mention" });
}

/** One frame of the live line (exported for the tests). */
export function onFrame(e: RealtimeEventPayload): Promise<void> | void {
  // a mute, a topic's door: the next message asks the header again
  if (e.kind === "conversation.changed" || e.kind === "membership.changed") {
    if (e.conversationId) headers.delete(e.conversationId);
    else headers.clear();
    return;
  }
  if (e.kind !== "message.created" || e.synthetic || !e.conversationId || !e.messageId) return;
  return onMessage(e.conversationId, e.messageId).catch(() => undefined);
}

export function ChatSoundsHost({ enabled }: { enabled: boolean }): null {
  useEffect(() => {
    if (!enabled) return;
    setChatSoundsActive(true);
    // an iPhone's audio is asleep until a touch: a gesture wakes it. Safari counts the END of a touch (or a click or a key), so the listeners go only after one of those;
    // the start of a touch and a pointer press try as well (other browsers take them)
    const gestures = ["touchstart", "pointerdown", "touchend", "click", "keydown"] as const;
    const wake = (event: Event) => {
      primeChime();
      if (event.type === "touchstart" || event.type === "pointerdown") return;
      for (const g of gestures) window.removeEventListener(g, wake, true);
    };
    for (const g of gestures) window.addEventListener(g, wake, { capture: true, passive: true });
    const off = subscribeRealtime((e) => void onFrame(e));
    return () => {
      off();
      for (const g of gestures) window.removeEventListener(g, wake, true);
      setChatSoundsActive(false);
      headers.clear();
    };
  }, [enabled]);
  return null;
}
