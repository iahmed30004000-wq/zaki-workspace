/**
 * «المرشد» — the voice, with nothing to install and nothing to pay for: the BROWSER'S own speech recognition (Arabic, Jordan) and speech
 * synthesis. ⚠️ Chrome's recognition sends the audio to the browser maker's service while it listens, and only while the owner has the
 * microphone on in the guide's call mode (he starts and ends it). 🔧 The call button is hidden where the browser has no recognition, and the
 * guide works with typing alone.
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

let chosen: SpeechSynthesisVoice | null | undefined;
function arabicVoice(): SpeechSynthesisVoice | null {
  if (chosen !== undefined && chosen !== null) return chosen;
  const voices = window.speechSynthesis.getVoices();
  chosen = voices.find((v) => v.lang.toLowerCase().startsWith("ar")) ?? null;
  return chosen;
}

/** Says the text out loud in Arabic (the first Arabic voice the device has); resolves when it ends or cannot speak. */
export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!canSpeak() || !text.trim()) return resolve();
    const u = new SpeechSynthesisUtterance(text.slice(0, 600));
    u.lang = "ar-JO";
    const v = arabicVoice();
    if (v) u.voice = v;
    u.rate = 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
