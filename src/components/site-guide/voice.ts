import { DEFAULT_VOICE_PREFS, clampPrefs, cleanForSpeech, rankArabicVoices, splitForSpeech, type VoicePrefs } from "@/lib/site-guide/voice-text";

/**
 * «المرشد» — the voice, with nothing to install and nothing to pay for: the BROWSER'S own speech recognition (Arabic, Jordan) and speech
 * synthesis. ⚠️ Chrome's recognition sends the audio to the browser maker's service while it listens, and only while the owner has the
 * microphone on in the guide's call mode (he starts and ends it). 🔧 The call button is hidden where the browser has no recognition, and the
 * guide works with typing alone.
 *
 * S6.1 — the speaking half no longer takes «the first Arabic voice and hopes»: the Arabic voices are ranked (ar-SA, ar-JO, ar-EG, then any
 * other), the list is awaited (`voiceschanged`, with a timeout), the audio is unlocked inside the tap (a phone stays mute otherwise), the answer is
 * spoken in sentence pieces (no cut at a fixed length), what is read out is cleaned (marks, links, paths, ids), speed and volume are the person's
 * own (kept on this device), and a device with no Arabic voice SAYS so (`onSpeechIssue`) instead of staying silent.
 */

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = (): boolean => ctor() !== null;
export const canSpeak = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

export interface Listener {
  stop(): void;
}

/** Listens until the person stops talking, then hands over what was said once. `onEnd` runs when listening ends for any reason. */
export function listenOnce(handlers: { onText: (text: string) => void; onEnd: (reason: string) => void; onInterim?: (text: string) => void }): Listener | null {
  const Rec = ctor();
  if (!Rec) return null;
  const rec = new Rec();
  rec.lang = "ar-JO";
  rec.continuous = false;
  rec.interimResults = true;
  let delivered = false;
  let reason = "ended";
  rec.onresult = (e) => {
    let finalText = "";
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const r = e.results[i];
      if (!r) continue;
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) handlers.onInterim?.(interim);
    if (finalText.trim() && !delivered) {
      delivered = true;
      handlers.onText(finalText.trim());
    }
  };
  rec.onerror = (e) => {
    reason = e.error ?? "error";
  };
  rec.onend = () => handlers.onEnd(reason);
  try {
    rec.start();
  } catch {
    return null;
  }
  return { stop: () => rec.stop() };
}

// ───────────────────────────────────────── speed and volume (this device only) ─────────────────────────────────────────

const PREFS_KEY = "zk-guide-voice";

/** The person's speed and volume, read from this device's storage; a missing, broken or hostile value is the default. */
export function getVoicePrefs(): VoicePrefs {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage?.getItem(PREFS_KEY) : null;
    return raw ? clampPrefs(JSON.parse(raw)) : { ...DEFAULT_VOICE_PREFS };
  } catch {
    return { ...DEFAULT_VOICE_PREFS };
  }
}

/** Keeps a change of speed or volume on this device (never on the server) and returns what was kept. */
export function setVoicePrefs(next: Partial<VoicePrefs>): VoicePrefs {
  const kept = clampPrefs({ ...getVoicePrefs(), ...next });
  try {
    window.localStorage?.setItem(PREFS_KEY, JSON.stringify(kept));
  } catch {
    // a browser that refuses storage keeps the value for this page only: the next read gives the default
  }
  return kept;
}

// ───────────────────────────────────────── problems the screen must say in words ─────────────────────────────────────────

export type SpeechIssue = "no_voice" | "failed";
const issueHandlers = new Set<(kind: SpeechIssue) => void>();
const reported = new Set<SpeechIssue>();

/** The screen asks to be told when the device cannot speak (no Arabic voice) or an utterance failed: each kind once per page, so it is never a flood. */
export function onSpeechIssue(handler: (kind: SpeechIssue) => void): () => void {
  issueHandlers.add(handler);
  return () => void issueHandlers.delete(handler);
}

function report(kind: SpeechIssue): void {
  if (reported.has(kind)) return;
  reported.add(kind);
  for (const handler of [...issueHandlers]) handler(kind);
}

// ───────────────────────────────────────── the voices ─────────────────────────────────────────

const VOICES_TIMEOUT_MS = 2000;

/** The device's voices: at once when they are there, else when the browser announces them (`voiceschanged`) or after a timeout (some never do). */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      synth.removeEventListener?.("voiceschanged", check);
      resolve(synth.getVoices());
    };
    function check() {
      if (synth.getVoices().length > 0) finish();
    }
    synth.addEventListener?.("voiceschanged", check);
    poll = setInterval(check, 150);
    timer = setTimeout(finish, VOICES_TIMEOUT_MS);
  });
}

async function bestArabicVoice(): Promise<SpeechSynthesisVoice | null> {
  if (!canSpeak()) return null;
  return rankArabicVoices(await loadVoices())[0] ?? null;
}

/** Does this device have an Arabic voice? Waits for the list; says «no voice» (once) when there is none, so the screen can tell the person in words. */
export async function hasArabicVoice(): Promise<boolean> {
  if (!canSpeak()) return false;
  const voice = await bestArabicVoice();
  if (!voice) report("no_voice");
  return voice !== null;
}

// ───────────────────────────────────────── speaking ─────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** After a `cancel()` the engine needs a moment: an utterance queued in the same breath is dropped by several browsers. */
const AFTER_CANCEL_MS = 80;

let generation = 0;
const pendingEnds = new Set<() => void>();

/**
 * Call it INSIDE the tap that starts a call (a click, never a timer): a phone lets a web page speak only after speech was started by a touch.
 * A silent utterance does it, so the answers that arrive later (after the network, long after the tap) are heard.
 */
export function unlockAudio(): void {
  if (!canSpeak()) return;
  try {
    const synth = window.speechSynthesis;
    synth.resume?.();
    const silent = new SpeechSynthesisUtterance(" ");
    silent.volume = 0;
    silent.lang = "ar";
    synth.speak(silent);
  } catch {
    // no engine, or one that refuses: the answers will say so when they are spoken
  }
}

/** One piece: resolves when it ends, fails, is stopped, or a watchdog says the engine forgot to say so (some never fire `end`). */
function sayPiece(text: string, voice: SpeechSynthesisVoice, prefs: VoicePrefs): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      pendingEnds.delete(stop);
      resolve(ok);
    };
    const stop = () => finish(true);
    pendingEnds.add(stop);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice.lang;
    u.voice = voice;
    u.rate = prefs.rate;
    u.volume = prefs.volume;
    u.onend = () => finish(true);
    u.onerror = (e) => finish(e.error === "canceled" || e.error === "interrupted");
    timer = setTimeout(() => finish(true), Math.max(4000, (text.length * 140) / prefs.rate + 3000));
    try {
      window.speechSynthesis.speak(u);
    } catch {
      finish(false);
    }
  });
}

/**
 * Says the text out loud in Arabic with the best Arabic voice of the device, in pieces, and resolves when it ends or cannot speak. A newer `speak`
 * (or `stopSpeaking`) ends this one at the next piece. Text with nothing to say after cleaning (marks only) is not spoken and cancels nothing.
 */
export async function speak(text: string): Promise<void> {
  if (!canSpeak()) return;
  const pieces = splitForSpeech(cleanForSpeech(text));
  if (pieces.length === 0) return;
  const mine = ++generation;
  const synth = window.speechSynthesis;
  const busy = synth.speaking || synth.pending;
  if (busy) {
    synth.cancel();
    for (const end of [...pendingEnds]) end();
  }
  const voice = await bestArabicVoice();
  if (mine !== generation) return;
  if (!voice) {
    report("no_voice");
    return;
  }
  // the engine needs a moment after a cancel (an utterance queued in the same breath is dropped)
  if (busy) await sleep(AFTER_CANCEL_MS);
  for (const piece of pieces) {
    if (mine !== generation) return;
    const ok = await sayPiece(piece, voice, getVoicePrefs());
    if (!ok) {
      report("failed");
      return;
    }
  }
}

/** Stops the voice at once, and the pieces that were still to come. */
export function stopSpeaking(): void {
  generation += 1;
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  for (const end of [...pendingEnds]) end();
}
