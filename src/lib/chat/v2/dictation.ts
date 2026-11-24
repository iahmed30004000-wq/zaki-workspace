/**
 * «نص مباشر أثناء التسجيل» (the switch `voiceLiveText`, off by default): while a voice note is recorded, the browser's own speech recognition writes what is said above the
 * composer, in the language the person picks, and «ابعت كنص» sends those words as a message instead of the voice.
 *
 * ⚠️ The recognition is the browser's: Chrome on Android sends the sound to Google to recognise it, so the words leave the company (the switch says so). The engine here
 * is pure: it takes a factory for the recognition object (`window.SpeechRecognition` or the webkit one), so it runs in a test without a browser. Chrome ends a
 * recognition by itself after a pause: while the person still wants it, it is started again; a refusal (no microphone to share, no permission) is a key, never a crash, and the
 * recording itself goes on.
 */

/** Each language is a code for the browser and a key of the dictionary for the picker (never a word in the code). */
export const DICTATION_LANGS = [
  { code: "ar-JO", labelKey: "chatlive.lang_ar_jo" },
  { code: "ar-SA", labelKey: "chatlive.lang_ar_sa" },
  { code: "ar-EG", labelKey: "chatlive.lang_ar_eg" },
  { code: "en-US", labelKey: "chatlive.lang_en_us" },
] as const;
export const DEFAULT_DICTATION_LANG = "ar-JO";
export const DICTATION_MAX_CHARS = 4000;

export type DictationError = "unsupported" | "denied" | "busy" | "failed";

interface ResultLike {
  isFinal: boolean;
  0?: { transcript?: string };
}
export interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ResultLike>;
}
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionFactory = () => RecognitionLike | null;

export interface DictationSnapshot {
  supported: boolean;
  listening: boolean;
  /** what the recognition is sure of so far */
  final: string;
  /** what it is still working on */
  interim: string;
  lang: string;
  error: DictationError | null;
}

/** The recognition of this browser, or null (Firefox, an old WebView). */
export function browserRecognition(win: unknown = typeof window === "undefined" ? undefined : window): RecognitionFactory {
  return () => {
    const w = win as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike } | undefined;
    const Ctor = w?.SpeechRecognition ?? w?.webkitSpeechRecognition;
    return Ctor ? new Ctor() : null;
  };
}

/** A language code from the list, or the default (a stored value that is not one of them is never handed to the browser). */
export function dictationLangOf(code: unknown): string {
  return DICTATION_LANGS.some((l) => l.code === code) ? (code as string) : DEFAULT_DICTATION_LANG;
}

/** The words to show or send: what is final, then what is still interim, one space between, trimmed and capped. */
export function dictationText(final: string, interim: string): string {
  return [final.trim(), interim.trim()].filter(Boolean).join(" ").slice(0, DICTATION_MAX_CHARS);
}

const errorOf = (code: string | undefined): DictationError | null => {
  // «no-speech» and «aborted» are the normal ends of a listening turn, not a failure
  if (code === "no-speech" || code === "aborted") return null;
  if (code === "not-allowed" || code === "service-not-allowed") return "denied";
  if (code === "audio-capture") return "busy";
  return "failed";
};

export interface Dictation {
  getSnapshot(): DictationSnapshot;
  getServerSnapshot(): DictationSnapshot;
  subscribe(listener: () => void): () => void;
  /** starts listening (a second call while listening does nothing) */
  start(): void;
  /** stops, and answers every word that was heard (final and interim) */
  finish(): string;
  /** stops and forgets everything */
  cancel(): void;
  setLang(code: string): void;
}

export function createDictation(factory: RecognitionFactory, initialLang: string = DEFAULT_DICTATION_LANG): Dictation {
  const idle = (supported: boolean, lang: string): DictationSnapshot => ({ supported, listening: false, final: "", interim: "", lang, error: supported ? null : "unsupported" });
  const probe = factory();
  let snap: DictationSnapshot = idle(probe !== null, dictationLangOf(initialLang));
  const server = idle(false, snap.lang);
  const listeners = new Set<() => void>();
  let rec: RecognitionLike | null = null;
  let wanted = false;

  const set = (patch: Partial<DictationSnapshot>) => {
    snap = { ...snap, ...patch };
    for (const l of [...listeners]) l();
  };

  const open = () => {
    const next = factory();
    if (!next) {
      set({ supported: false, listening: false, error: "unsupported" });
      return;
    }
    next.lang = snap.lang;
    next.continuous = true;
    next.interimResults = true;
    next.onresult = (event) => {
      let final = snap.final;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const said = result?.[0]?.transcript ?? "";
        if (result?.isFinal) final = `${final} ${said}`.trim();
        else interim = `${interim} ${said}`.trim();
      }
      set({ final, interim, error: null });
    };
    next.onerror = (event) => {
      const error = errorOf(event.error);
      if (error) {
        wanted = false;
        set({ listening: false, error });
      }
    };
    next.onend = () => {
      // the browser ends a turn after a pause: the person still wants the words, so it listens again
      if (rec === next && wanted) {
        try {
          next.start();
        } catch {
          wanted = false;
          set({ listening: false, error: "failed" });
        }
        return;
      }
      if (rec === next) set({ listening: false });
    };
    rec = next;
    try {
      next.start();
      set({ listening: true, error: null });
    } catch {
      rec = null;
      wanted = false;
      set({ listening: false, error: "failed" });
    }
  };

  const close = () => {
    wanted = false;
    const old = rec;
    rec = null;
    if (old) {
      old.onresult = null;
      old.onend = null;
      old.onerror = null;
      try {
        old.abort();
      } catch {
        // already stopped
      }
    }
  };

  return {
    getSnapshot: () => snap,
    getServerSnapshot: () => server,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (snap.listening || wanted) return;
      wanted = true;
      set({ final: "", interim: "", error: null });
      open();
    },
    finish() {
      const text = dictationText(snap.final, snap.interim);
      close();
      set({ listening: false, final: "", interim: "" });
      return text;
    },
    cancel() {
      close();
      set({ listening: false, final: "", interim: "", error: null });
    },
    setLang(code) {
      const lang = dictationLangOf(code);
      if (lang === snap.lang) return;
      const keep = snap.listening || wanted;
      const heard = dictationText(snap.final, snap.interim);
      close();
      set({ lang, listening: false, final: heard, interim: "" });
      if (keep) {
        wanted = true;
        open();
      }
    },
  };
}
