/**
 * THE CHAT'S SOUNDS (the owner, 2026-10-30: «الأصوات للدردشات، إرسال الرسائل…»): a soft pop when a message of mine
 * goes, another when somebody else's arrives in the conversation that is open, and the arrival pop twice when it
 * mentions me. They are small files under public/sounds (CC0, credited in public/brand/CREDITS.md), played by the
 * browser and nothing else: no server is told, so the owner's silent reading is not touched by them.
 *
 * Each person can switch them off (a button in the conversation's head); the choice stays in this browser. A
 * browser may refuse to play before the person has touched the page: then nothing plays and nothing breaks.
 */
import { chatSoundsActive } from "@/lib/chat/chime/active";
import { loadChatSoundPrefs } from "@/lib/chat/chime/prefs";
import { playChime } from "@/lib/chat/chime/player";

export type ChatSound = "sent" | "received" | "mention";

export const CHAT_SOUND_URLS = { sent: "/sounds/sent.mp3", received: "/sounds/received.mp3" } as const;
/** The pause between the two pops of a mention. */
export const MENTION_REPEAT_GAP_MS = 180;
export const SOUNDS_KEY = "zk.chat.sounds";

interface SoundStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): SoundStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** On until the person turns it off. A browser with no storage keeps them on. */
export function soundsEnabled(storage: SoundStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(SOUNDS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on: boolean, storage: SoundStorage | null = defaultStorage()): void {
  try {
    if (on) storage?.removeItem(SOUNDS_KEY);
    else storage?.setItem(SOUNDS_KEY, "off");
  } catch {
    /* private window: the choice lasts until the page closes */
  }
}

/** Which sound a newly arrived message makes (null: none). Opening a conversation, my own message, a system line and a message sent «بدون صوت» are silent. */
export function soundOfArrival(opts: { mine: boolean; opening: boolean; mentionsMe: boolean; kind: string; /** C3c.2: «ابعت بدون صوت»: the sender chose silence, so this device makes none either (a mention included) */ silent?: boolean }): ChatSound | null {
  if (opts.mine || opts.opening || opts.kind === "SYSTEM" || opts.silent === true) return null;
  return opts.mentionsMe ? "mention" : "received";
}

function pop(url: string): void {
  if (typeof Audio === "undefined") return;
  try {
    const sound = new Audio(url);
    sound.volume = 0.6;
    void Promise.resolve(sound.play()).catch(() => undefined);
  } catch {
    /* no audio here */
  }
}

export function playChatSound(kind: ChatSound, storage: SoundStorage | null = defaultStorage()): void {
  if (!soundsEnabled(storage)) return;
  if (kind === "sent") return pop(CHAT_SOUND_URLS.sent);
  // S5.1: with the company's switch `chatSounds` on, an arrival plays the tone the person chose (drawn by the browser, one voice for every chat) instead of the sound file
  if (chatSoundsActive()) {
    const prefs = loadChatSoundPrefs();
    playChime({ tone: prefs.tone, volume: prefs.volume, mention: kind === "mention" });
    return;
  }
  pop(CHAT_SOUND_URLS.received);
  if (kind === "mention") setTimeout(() => pop(CHAT_SOUND_URLS.received), MENTION_REPEAT_GAP_MS);
}
