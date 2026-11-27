/**
 * «النقطة» beside a voice note that was not played yet (`tgPhone`). Remembered on THIS device only (`zk-voice-heard` in `localStorage`; the server keeps no
 * «heard» mark and no column was added for it), so another device shows its own dots.
 *
 *  - Only a note the open conversation told it about (`know`, with when it was sent), only somebody else's.
 *  - A note sent more than `UNPLAYED_GRACE_MS` before this device started remembering counts as played: without that, the first day would put a dot on
 *    every old note of every conversation.
 *  - Only our own attachment addresses are kept (a `blob:` of a preview never is), the newest `VOICE_HEARD_MAX` of them.
 *  - With no storage (a private window) it remembers until the page closes. It never throws.
 */
export const VOICE_HEARD_KEY = "zk-voice-heard";
export const VOICE_HEARD_MAX = 1500;
export const UNPLAYED_GRACE_MS = 24 * 60 * 60 * 1000;

export interface HeardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface KnownNote {
  src: string;
  mine?: boolean;
  /** when the message was sent (ISO) */
  sentAt?: string;
}

interface Stored {
  since: number;
  played: string[];
}

const ours = (src: string): boolean => src.startsWith("/api/");

export function createHeardStore(storage: HeardStorage | null | (() => HeardStorage | null), now: () => number = () => Date.now()) {
  const listeners = new Set<() => void>();
  const notes = new Map<string, { mine: boolean; sentAt: number }>();
  let loaded: { since: number; played: Set<string> } | null = null;

  const store = (): HeardStorage | null => {
    try {
      return typeof storage === "function" ? storage() : storage;
    } catch {
      return null;
    }
  };
  const save = (): void => {
    if (!loaded) return;
    const value: Stored = { since: loaded.since, played: [...loaded.played].slice(-VOICE_HEARD_MAX) };
    try {
      store()?.setItem(VOICE_HEARD_KEY, JSON.stringify(value));
    } catch {
      /* no storage here: remembered until the page closes */
    }
  };
  const state = (): { since: number; played: Set<string> } => {
    if (loaded) return loaded;
    let since = 0;
    let played: string[] = [];
    try {
      const raw = JSON.parse(store()?.getItem(VOICE_HEARD_KEY) ?? "null") as Partial<Stored> | null;
      if (raw && typeof raw.since === "number" && Number.isFinite(raw.since)) since = raw.since;
      if (raw && Array.isArray(raw.played)) played = raw.played.filter((p): p is string => typeof p === "string" && ours(p)).slice(-VOICE_HEARD_MAX);
    } catch {
      /* damaged: start again */
    }
    const fresh = since === 0;
    loaded = { since: fresh ? now() : since, played: new Set(played) };
    if (fresh) save();
    return loaded;
  };
  const tell = (): void => {
    for (const l of [...listeners]) l();
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    know(list: readonly KnownNote[]): void {
      state();
      let changed = false;
      for (const note of list) {
        const sentAt = note.sentAt ? Date.parse(note.sentAt) : Number.NaN;
        if (!Number.isFinite(sentAt) || notes.has(note.src)) continue;
        notes.set(note.src, { mine: note.mine === true, sentAt });
        changed = true;
      }
      if (changed) tell();
    },
    isUnplayed(src: string): boolean {
      const note = notes.get(src);
      if (!note || note.mine) return false;
      const { since, played } = state();
      return !played.has(src) && note.sentAt >= since - UNPLAYED_GRACE_MS;
    },
    markPlayed(src: string): void {
      if (!ours(src)) return;
      const { played } = state();
      if (played.has(src)) return;
      played.add(src);
      while (played.size > VOICE_HEARD_MAX) played.delete(played.values().next().value as string);
      save();
      tell();
    },
  };
}

export type HeardStore = ReturnType<typeof createHeardStore>;

/** The one memory of the page. */
export const voiceHeard: HeardStore = createHeardStore(() => (typeof window === "undefined" ? null : window.localStorage));
