import { DEFAULT_CHAT_TONE, isChatToneId, type ChatToneId } from "@/lib/chat/chime/tones";

/**
 * S5.1 — what THIS device chooses for the chat's message tone: which tone, how loud, and for which topics only a mention should sound. They live in `localStorage`
 * (`zk-chat-sound`), like the tab wheel's (`src/lib/nav/tab-wheel.ts`): pure parse / load / save, so the tests need no browser. The master switch «أصوات الدردشة» is
 * the one that already exists (`src/lib/chat/sounds.ts`, the key `zk.chat.sounds`): there is one switch, not two.
 *
 * The per-topic choice is kept here and not on the server: a conversation member has no notify-level field (only `mutedUntil`), and a schema change for a sound is not
 * worth it. Only the exceptions are stored («الذكر بس»); a topic that was never chosen, or was set back to «كل الرسائل», has no entry.
 */

export type TopicSoundMode = "all" | "mentions";

export interface ChatSoundPrefs {
  tone: ChatToneId;
  /** 0..1 — the master gain; quiet by default */
  volume: number;
  /** conversation id -> mode, exceptions only */
  topics: Record<string, TopicSoundMode>;
}

export const DEFAULT_CHAT_SOUND_PREFS: ChatSoundPrefs = { tone: DEFAULT_CHAT_TONE, volume: 0.5, topics: {} };

export const CHAT_SOUND_KEY = "zk-chat-sound";
/** Fired on `window` when the choice is saved, so a screen that is open follows a change at once. */
export const CHAT_SOUND_EVENT = "zk-chat-sound-change";
/** The most topics kept (the oldest choice goes first): the key must not grow for ever. */
export const MAX_TOPIC_CHOICES = 200;

/** The remembered choice, read tolerantly: whatever is missing or invalid keeps its default. */
export function parseChatSoundPrefs(raw: unknown): ChatSoundPrefs {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_CHAT_SOUND_PREFS, topics: {} };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_CHAT_SOUND_PREFS, topics: {} };
  const o = value as Record<string, unknown>;
  const tone = isChatToneId(o.tone) ? o.tone : DEFAULT_CHAT_SOUND_PREFS.tone;
  const volume = typeof o.volume === "number" && Number.isFinite(o.volume) ? Math.min(1, Math.max(0, o.volume)) : DEFAULT_CHAT_SOUND_PREFS.volume;
  const topics: Record<string, TopicSoundMode> = {};
  if (o.topics && typeof o.topics === "object" && !Array.isArray(o.topics)) {
    for (const [id, mode] of Object.entries(o.topics as Record<string, unknown>)) {
      if (id && mode === "mentions") topics[id] = "mentions";
    }
  }
  return { tone, volume, topics };
}

export function loadChatSoundPrefs(): ChatSoundPrefs {
  try {
    return parseChatSoundPrefs(localStorage.getItem(CHAT_SOUND_KEY));
  } catch {
    return { ...DEFAULT_CHAT_SOUND_PREFS, topics: {} };
  }
}

export function saveChatSoundPrefs(prefs: ChatSoundPrefs): void {
  try {
    localStorage.setItem(CHAT_SOUND_KEY, JSON.stringify(prefs));
  } catch {
    // storage blocked: the choice holds until the page is closed
  }
  try {
    window.dispatchEvent(new CustomEvent(CHAT_SOUND_EVENT, { detail: prefs }));
  } catch {
    // no window (a server test): nothing to tell
  }
}

/** What a topic sounds for: «كل الرسائل» unless «الذكر بس» was chosen for it. */
export function topicModeOf(prefs: ChatSoundPrefs, conversationId: string): TopicSoundMode {
  return prefs.topics[conversationId] === "mentions" ? "mentions" : "all";
}

/** The prefs after one topic's choice: «كل الرسائل» forgets the topic. */
export function withTopicMode(prefs: ChatSoundPrefs, conversationId: string, mode: TopicSoundMode): ChatSoundPrefs {
  const topics = { ...prefs.topics };
  delete topics[conversationId];
  if (mode === "mentions") topics[conversationId] = "mentions";
  const ids = Object.keys(topics);
  for (const old of ids.slice(0, Math.max(0, ids.length - MAX_TOPIC_CHOICES))) delete topics[old];
  return { ...prefs, topics };
}
