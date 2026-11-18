import type { FileKind } from "@/lib/chat/file-kinds";

export function conversationDetailUrl(id: string, before?: string, around?: string): string {
  const query = new URLSearchParams({ limit: "40" });
  if (before) query.set("before", before);
  if (around) query.set("around", around);
  return `/api/chat/conversations/${encodeURIComponent(id)}?${query.toString()}`;
}

/**
 * C1.2: the URLs of the new chat endpoints, in one place (the client cache of C1.4 builds every request here).
 * `conversationDetailUrl` above is the old screen's and stays as it is.
 */
export function chatListUrl(spaceId?: string): string {
  return spaceId ? `/api/chat/list?spaceId=${encodeURIComponent(spaceId)}` : "/api/chat/list";
}

export function spaceTopicsUrl(spaceId: string): string {
  return `/api/chat/spaces/${encodeURIComponent(spaceId)}/topics`;
}

export function conversationHeaderUrl(id: string): string {
  return `/api/chat/conversations/${encodeURIComponent(id)}/header`;
}

/** One window of messages: the newest, or ONE of `before` / `after` / `around` (a message id). */
export function conversationMessagesUrl(id: string, opts: { before?: string; after?: string; around?: string; limit?: number } = {}): string {
  const query = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.before) query.set("before", opts.before);
  else if (opts.after) query.set("after", opts.after);
  else if (opts.around) query.set("around", opts.around);
  return `/api/chat/conversations/${encodeURIComponent(id)}/messages?${query.toString()}`;
}

/** The delta feed: `after` is the `cursor` of the last answer (none: «where is now?»). */
export function chatSyncUrl(after?: string, limit?: number): string {
  const query = new URLSearchParams();
  if (after) query.set("after", after);
  if (limit) query.set("limit", String(limit));
  const q = query.toString();
  return q ? `/api/chat/sync?${q}` : "/api/chat/sync";
}

export function createChatUploadFormData(file: File, kind: FileKind): FormData {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  return form;
}

export interface ChatMessagePayloadInput {
  body: string;
  attachmentIds: string[];
  mentions: string[];
  replyToId?: string;
  clientId: string;
  /** a voice note: its one attachment is the recording (the server makes it a VOICE message) */
  voice?: boolean;
  /** the body carries «@الكل» and the person may use it (the server checks both again) */
  mentionAll?: boolean;
}

export function buildChatMessagePayload(input: ChatMessagePayloadInput) {
  return {
    body: input.body.trim(),
    attachmentIds: input.attachmentIds,
    mentions: input.mentions,
    ...(input.replyToId ? { replyToId: input.replyToId } : {}),
    clientId: input.clientId,
    ...(input.voice ? { voice: true } : {}),
    ...(input.mentionAll ? { mentionAll: true } : {}),
  };
}

/** The upload form of a recording: the take, its length and its waveform (the server caps both). */
export function createVoiceUploadFormData(take: { blob: Blob; mime: string; durationMs: number; peaks: number[] }): FormData {
  const ext = take.mime.includes("mp4") ? "m4a" : take.mime.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new File([take.blob], `voice.${ext}`, { type: take.mime }));
  form.append("kind", "VOICE");
  form.append("durationMs", String(Math.round(take.durationMs)));
  form.append("peaks", JSON.stringify(take.peaks));
  return form;
}

export function messageClientId(): string {
  return globalThis.crypto.randomUUID();
}

/** How close to the bottom (px) still counts as «at the newest message». */
export const STICK_PX = 80;

export function isAtBottom(el: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
}

/**
 * Where a new newest message leaves the view, like a messaging app (the owner, 2026-10-26: «بس ابعت رسالة ما بمول
 * المحادثة»): «bottom» on opening, on one's own message, or when already at the bottom; «badge» when the person is up
 * reading older messages (they stay there, and «↓ رسائل جديدة» counts what came); «stay» around a search hit.
 */
export function onNewest(state: { opening: boolean; mine: boolean; atBottom: boolean; aroundHit: boolean }): "bottom" | "badge" | "stay" {
  if (state.aroundHit) return "stay";
  if (state.opening || state.mine || state.atBottom) return "bottom";
  return "badge";
}

/** The composer's Enter: it sends (the owner, 2026-10-26), Shift+Enter is a new line, and never while an input method composes. */
export function enterSends(event: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}
