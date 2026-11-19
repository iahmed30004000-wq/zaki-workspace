import { DEFAULT_VOICE_SPEED, VOICE_SPEEDS, type VoiceSpeed } from "@/lib/chat/prefs";
import { safeMediaUrl } from "@/lib/chat/album-layout";
import type { MessageDto } from "@/server/chat/dto";

/**
 * C3b.4 — voice notes: the queue of a conversation, the walk to the NEXT unheard note, and the one engine every voice bubble and the mini bar share.
 *
 *  - `voiceNotesOf` and `nextUnheard` are PURE (a list in, a list or a note out), so the rule is tested without a browser.
 *  - `createVoiceEngine` is the small store behind the screens: at most ONE note plays at a time, the speed is one number for all of them, and a note that
 *    ends hands over to `nextUnheard`. It takes its audio object from a factory, so it runs in a test with a stand-in. The screens read it as an external
 *    store (`subscribe` / `getSnapshot`).
 *  - A note is known by its address (`src`): the bubble shows that address, and so does the queue.
 *  - «Heard» is what this device played in this session (a note counts as heard when it starts). Nothing is stored: the server keeps no «heard» mark.
 */

/** A voice note of the open conversation, as the queue knows it. */
export interface VoiceNote {
  /** the address the bubble plays; the identity of the note */
  src: string;
  messageId: string;
  authorName: string;
  /** my own note: it is never «unheard», so the walk skips it */
  mine?: boolean;
  durationMs?: number;
}

/** The voice notes of the loaded messages, oldest to newest (the order of the list). Never a deleted one, a pending one or an address that is not ours. */
export function voiceNotesOf(messages: readonly Pick<MessageDto, "id" | "kind" | "deleted" | "mine" | "authorName" | "attachments">[]): VoiceNote[] {
  const out: VoiceNote[] = [];
  for (const m of messages) {
    if (m.kind !== "VOICE" || m.deleted || m.id.startsWith("pending:")) continue;
    for (const file of m.attachments) {
      const src = file.mime.startsWith("audio/") ? safeMediaUrl(file.url) : undefined;
      if (!src) continue;
      out.push({ src, messageId: m.id, authorName: m.authorName, mine: m.mine, durationMs: file.durationMs });
      break; // a voice message is one note
    }
  }
  return out;
}

/** The first note AFTER `currentSrc` that was not heard and is not mine; null at the end of the queue (or when the current note is not in it). */
export function nextUnheard(queue: readonly VoiceNote[], currentSrc: string, heard: ReadonlySet<string>): VoiceNote | null {
  const at = queue.findIndex((n) => n.src === currentSrc);
  if (at < 0) return null;
  for (let i = at + 1; i < queue.length; i++) {
    const n = queue[i]!;
    if (!n.mine && !heard.has(n.src)) return n;
  }
  return null;
}

/** «1×», «1.5×», «2×» (Western digits). */
export const voiceSpeedLabel = (speed: VoiceSpeed): string => `${speed}×`;

/** What the engine needs of an audio object: the browser's `HTMLAudioElement` fits it. */
export interface AudioLike {
  src: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface VoiceSnapshot {
  /** the note that is playing or paused part of the way; null when none is */
  activeSrc: string | null;
  /** the queue's entry for it, kept from the moment it started (so the bar still knows the sender when the list dropped the message) */
  note: VoiceNote | null;
  playing: boolean;
  /** 0..1 */
  at: number;
  durationMs: number;
  speed: VoiceSpeed;
  /** the active note's bubble is on screen (the mini bar is wanted when it is not) */
  activeVisible: boolean;
}

const IDLE: VoiceSnapshot = { activeSrc: null, note: null, playing: false, at: 0, durationMs: 0, speed: DEFAULT_VOICE_SPEED, activeVisible: true };

export interface VoiceEngineOptions {
  /** the ONE audio object the engine plays through (the default is the browser's `Audio`) */
  makeAudio?: () => AudioLike | null;
}

const browserAudio = (): AudioLike | null => {
  if (typeof Audio === "undefined") return null;
  const el = new Audio();
  el.preload = "auto";
  return el as unknown as AudioLike;
};

/**
 * Every note plays through ONE audio object that the engine owns, never through the bubble's own `<audio>` (that one only reads the length). Why: a bubble the
 * list drops would take its sound with it, the next note's bubble may not exist yet, and a phone browser lets an audio object play by itself only after the
 * person has played IT once: the single object is unlocked by the first tap and then carries the whole walk.
 */
export function createVoiceEngine(options: VoiceEngineOptions = {}) {
  const makeAudio = options.makeAudio ?? browserAudio;
  let state: VoiceSnapshot = IDLE;
  const listeners = new Set<() => void>();
  /** the bubbles on the page, by note address (a note may be drawn twice: it counts while any of them is) */
  const attached = new Map<string, number>();
  /** what the bubbles' observers said; a bubble that has not been observed yet counts as on screen */
  const seen = new Map<string, boolean>();
  const heard = new Set<string>();
  /** where a note was left when another one took the audio object (seconds) */
  const places = new Map<string, number>();
  let queue: { conversationId: string | null; notes: readonly VoiceNote[] } = { conversationId: null, notes: [] };
  let audio: AudioLike | null = null;
  let seek = 0;
  let touched = false;
  let persist: ((speed: VoiceSpeed) => void) | null = null;

  const visibleNow = (src: string | null): boolean => (src === null ? true : (attached.get(src) ?? 0) > 0 && (seen.get(src) ?? true));

  function commit(patch: Partial<VoiceSnapshot>): void {
    const next: VoiceSnapshot = { ...state, ...patch };
    next.activeVisible = visibleNow(next.activeSrc);
    const same = (Object.keys(next) as (keyof VoiceSnapshot)[]).every((k) => next[k] === state[k]);
    if (same) return;
    state = next;
    for (const fn of [...listeners]) fn();
  }

  const lengthOf = (el: AudioLike): number => {
    if (Number.isFinite(el.duration) && el.duration > 0) return Math.round(el.duration * 1000);
    return state.note?.durationMs ?? 0;
  };
  const progressOf = (el: AudioLike): number => (Number.isFinite(el.duration) && el.duration > 0 ? Math.min(1, el.currentTime / el.duration) : 0);

  const idle = (): void => commit({ activeSrc: null, note: null, playing: false, at: 0, durationMs: 0 });

  function ended(): void {
    const src = state.activeSrc;
    if (src === null) return;
    places.delete(src);
    const next = nextUnheard(queue.notes, src, heard);
    if (next) start(next.src);
    else idle();
  }

  /** the audio object, made when first needed, with its listeners bound once */
  function element(): AudioLike | null {
    if (audio) return audio;
    const el = makeAudio();
    if (!el) return null;
    el.addEventListener("play", () => commit({ playing: true }));
    el.addEventListener("pause", () => {
      if (state.activeSrc !== null) commit({ playing: false });
    });
    el.addEventListener("timeupdate", () => {
      if (state.activeSrc !== null) commit({ at: progressOf(el), durationMs: lengthOf(el) });
    });
    el.addEventListener("loadedmetadata", () => {
      if (state.activeSrc === null) return;
      if (seek > 0 && Number.isFinite(el.duration) && seek < el.duration) el.currentTime = seek;
      seek = 0;
      commit({ durationMs: lengthOf(el), at: progressOf(el) });
    });
    el.addEventListener("durationchange", () => {
      if (state.activeSrc !== null) commit({ durationMs: lengthOf(el) });
    });
    el.addEventListener("ended", ended);
    el.addEventListener("error", () => {
      if (state.activeSrc !== null) stop();
    });
    audio = el;
    return el;
  }

  const play = (el: AudioLike): void => {
    const started = el.play();
    if (started && typeof started.catch === "function") started.catch(() => commit({ playing: false }));
  };

  function start(src: string): void {
    const el = element();
    if (!el) return;
    if (state.activeSrc !== null && state.activeSrc !== src) places.set(state.activeSrc, el.currentTime);
    heard.add(src);
    const note = queue.notes.find((n) => n.src === src) ?? null;
    seek = places.get(src) ?? 0;
    el.pause();
    el.src = src;
    el.currentTime = 0;
    el.playbackRate = state.speed;
    commit({ activeSrc: src, note, playing: false, at: 0, durationMs: note?.durationMs ?? 0 });
    play(el);
  }

  function stop(): void {
    audio?.pause();
    seek = 0;
    idle();
  }

  return {
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    getSnapshot: (): VoiceSnapshot => state,
    getServerSnapshot: (): VoiceSnapshot => IDLE,

    /** a voice bubble joined the page; the returned function says it left */
    attach(src: string): () => void {
      attached.set(src, (attached.get(src) ?? 0) + 1);
      commit({});
      return () => {
        const left = (attached.get(src) ?? 1) - 1;
        if (left > 0) attached.set(src, left);
        else {
          attached.delete(src);
          seen.delete(src);
        }
        commit({});
      };
    },
    setVisible(src: string, visible: boolean): void {
      if (seen.get(src) === visible) return;
      seen.set(src, visible);
      commit({});
    },

    /** the open conversation's notes (the pane gives them again whenever its messages change) */
    setQueue(conversationId: string, notes: readonly VoiceNote[]): void {
      queue = { conversationId, notes };
    },
    /** the pane of this conversation closed: its queue goes and so does the sound */
    leave(conversationId: string): void {
      if (queue.conversationId !== conversationId) return;
      queue = { conversationId: null, notes: [] };
      stop();
    },

    /** a tap on a note's button: start it, or pause / resume it when it is the active one */
    toggle(src: string): void {
      if (state.activeSrc === src && audio) {
        if (state.playing) audio.pause();
        else play(audio);
        return;
      }
      start(src);
    },
    stop,

    setSpeed(speed: VoiceSpeed): void {
      if (!VOICE_SPEEDS.includes(speed)) return;
      touched = true;
      if (audio) audio.playbackRate = speed;
      commit({ speed });
      persist?.(speed);
    },
    /** what the person's prefs hold: taken only while the person has not picked a speed on this device in this session; it is never saved back */
    hydrateSpeed(speed: VoiceSpeed): void {
      if (touched || !VOICE_SPEEDS.includes(speed)) return;
      if (audio) audio.playbackRate = speed;
      commit({ speed });
    },
    /** who saves a picked speed (the pane does, through the prefs door); returns the way to unregister */
    onPersist(fn: (speed: VoiceSpeed) => void): () => void {
      persist = fn;
      return () => {
        if (persist === fn) persist = null;
      };
    },
  };
}

export type VoiceEngine = ReturnType<typeof createVoiceEngine>;

/** The one engine of the page: every voice bubble and the mini bar share it. */
export const voiceEngine: VoiceEngine = createVoiceEngine();
