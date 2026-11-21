/**
 * «المرشد» / «اتصل بالمساعد» — the PURE half of the browser voice (no window, no speech engine, so it is testable alone):
 * what is said (markers, links, paths and ids are not read out), in which pieces (sentences, never cut at a fixed length), with which voice
 * (Arabic ones ranked, never «the first one»), and at which speed and volume (the person's own, kept on the device).
 * src/components/site-guide/voice.ts is the other half: it talks to `speechSynthesis`.
 */

// ───────────────────────────────────────── the voice ─────────────────────────────────────────

/** The few fields of a `SpeechSynthesisVoice` the ranking reads (so a test can pass plain objects). */
export interface VoiceLike {
  lang: string;
  name: string;
  localService?: boolean;
  default?: boolean;
}

/** `ar`, `ar-SA`, `ar_JO`, `ara-XWW`, `ar-001`: every spelling of an Arabic language tag a browser or an operating system uses. */
export function isArabicLang(lang: string): boolean {
  return /^ara?(?:[-_]|$)/i.test(lang.trim());
}

/** The countries whose Arabic is the one a Levantine owner understands best, in the order of preference: ar-SA, ar-JO, ar-EG, then the Levant, then the rest. */
const REGION_SCORE: Record<string, number> = { SA: 40, JO: 38, EG: 36, SY: 30, LB: 30, PS: 30, IQ: 24, AE: 20 };
const BASE_SCORE = 20;
const NATURAL = /natural|neural|online|google|enhanced|premium/i;
const COMPACT = /compact/i;

function scoreVoice(v: VoiceLike): number {
  const region = /^ara?[-_]([A-Za-z]{2})\b/i.exec(v.lang.trim())?.[1]?.toUpperCase();
  let score = region && region in REGION_SCORE ? (REGION_SCORE[region] as number) : BASE_SCORE;
  if (NATURAL.test(v.name)) score += 10;
  if (v.localService) score += 3; // works with no network and starts at once
  if (v.default) score += 1;
  if (COMPACT.test(v.name)) score -= 5;
  return score;
}

/** The Arabic voices of a device, best first (equal ones keep the order the browser gave). Every other language is left out. */
export function rankArabicVoices<T extends VoiceLike>(voices: readonly T[]): T[] {
  return voices
    .map((voice, index) => ({ voice, index, score: isArabicLang(voice.lang) ? scoreVoice(voice) : -1 }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.voice);
}

// ───────────────────────────────────────── speed and volume ─────────────────────────────────────────

export interface VoicePrefs {
  /** 1 is the voice's normal speed */
  rate: number;
  /** 0 to 1 */
  volume: number;
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = { rate: 1, volume: 1 };
export const RATE_RANGE = { min: 0.6, max: 1.6, step: 0.05 } as const;
export const VOLUME_RANGE = { min: 0.2, max: 1, step: 0.05 } as const;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
}

/** Whatever was stored (or typed), as a speed and a volume that stay understandable. */
export function clampPrefs(raw: unknown): VoicePrefs {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    rate: clampNumber(o["rate"], RATE_RANGE.min, RATE_RANGE.max, DEFAULT_VOICE_PREFS.rate),
    volume: clampNumber(o["volume"], VOLUME_RANGE.min, VOLUME_RANGE.max, DEFAULT_VOICE_PREFS.volume),
  };
}

// ───────────────────────────────────────── what is said ─────────────────────────────────────────

const ARABIC_LETTER = /[؀-ۿݐ-ݿ]/;
const LATIN_LETTER = /[A-Za-z]/;
const SYMBOLS = /[\p{Extended_Pictographic}\uFE0F\u200D\u20E3\u2190-\u21FF\u2022\u25CF\u25AA\u25E6\u2713\u2714\u2717\u2718]/gu;
const MARKS = /[*_~`|#{}[\]]/g;
const TRAILING_PUNCT = /[.!?؟،,;؛:]+$/;
const EDGE_PUNCT = /^[("'«»]+|[)"'«»]+$/g;

/** A token that is a path, an address, an id or a long number: noise when read out. */
function isNoiseToken(token: string): boolean {
  const core = token.replace(EDGE_PUNCT, "").replace(TRAILING_PUNCT, "");
  if (core === "") return false;
  if (/^(?:https?:\/\/|www\.)/i.test(core)) return true;
  if (/^e\d{1,3}$/.test(core)) return true; // the guide's own element references (always lower case: «E5» is a name)
  if (ARABIC_LETTER.test(core)) return false; // «و/أو» is a word
  // a path: it starts with a separator, or has two or more of them, or a backslash («TCP/IP» and «and/or» are words)
  if (/^[~.]?[/\\][\w.-]/.test(core) || (LATIN_LETTER.test(core) && (/\\/.test(core) || (core.match(/\//g) ?? []).length >= 2))) return true;
  if (/^[A-Za-z]:[/\\]/.test(core)) return true;
  if (/^[+\d][\d\s\-+().]*$/.test(core) && core.replace(/\D/g, "").length >= 10) return true; // a phone number or a long id of digits
  if (core.length >= 12 && /^[A-Za-z0-9_-]+$/.test(core) && /\d/.test(core)) return true; // an id, a hash
  if (/^[-=_~*#>|•·–—.]{2,}$/.test(core)) return true; // a rule of dashes
  return false;
}

/**
 * The words of an answer as they should be spoken: markdown marks, links, paths, ids, long digit runs, emoji and the guide's element references are
 * dropped, the words and their punctuation stay. Lines are kept (a new line is a pause). An answer that is only marks becomes "".
 */
export function cleanForSpeech(raw: string): string {
  let text = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/<\/?[A-Za-z][^>\n]{0,200}>/g, " ")
    .replace(SYMBOLS, " ")
    .replace(MARKS, " ");
  const lines = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .split(/\s+/)
        .filter((token) => token !== "" && !isNoiseToken(token))
        .join(" ")
        .replace(/\(\s*\)/g, " ")
        .replace(/\s+([.!?؟،,;؛:])/g, "$1")
        .replace(/\s+/g, " ")
        .replace(/^(?:[-•]\s+|>+\s*)/, "")
        .trim(),
    )
    .filter((line) => line !== "" && /[\p{L}\p{N}]/u.test(line));
  text = lines.join("\n");
  return text.trim();
}

// ───────────────────────────────────────── the pieces ─────────────────────────────────────────

/** The longest piece handed to the engine at once: a few seconds of speech (long pieces are cut off by Chrome after about fifteen). */
export const MAX_PIECE_CHARS = 160;
const TERMINATORS = new Set([".", "!", "?", "؟", "…", "؛", ";"]);

/** The text as sentences. A terminator ends a sentence only when a space, a new line or the end follows (so `3.5` stays whole). */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    let current = "";
    const chars = [...line];
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i] as string;
      current += ch;
      if (TERMINATORS.has(ch)) {
        let next = chars[i + 1];
        // a run of terminators (`؟!`, `...`) stays together
        while (next !== undefined && TERMINATORS.has(next)) {
          current += next;
          i += 1;
          next = chars[i + 1];
        }
        if (next === undefined || /\s/.test(next)) {
          if (current.trim() !== "") out.push(current.trim());
          current = "";
        }
      }
    }
    if (current.trim() !== "") out.push(current.trim());
  }
  return out;
}

/** One sentence that is longer than a piece: broken at the last comma before the limit, else at the last space, else (a word with no end) at the limit. */
function breakLong(sentence: string, max: number): string[] {
  const parts: string[] = [];
  let rest = sentence.trim();
  while (rest.length > max) {
    const commaCut = Math.max(rest.slice(0, max).lastIndexOf("،"), rest.slice(0, max).lastIndexOf(","), rest.slice(0, max).lastIndexOf(":"));
    const spaceCut = rest.slice(0, max + 1).lastIndexOf(" ");
    const at = commaCut >= max / 3 ? commaCut + 1 : spaceCut > 0 ? spaceCut : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== "") parts.push(rest);
  return parts.filter((p) => p !== "");
}

/** The text in pieces for the engine: whole sentences packed up to `max` characters, a long sentence broken at a comma or a space. Nothing is dropped. */
export function splitForSpeech(text: string, max: number = MAX_PIECE_CHARS): string[] {
  const pieces: string[] = [];
  let current = "";
  const flush = () => {
    if (current !== "") pieces.push(current);
    current = "";
  };
  for (const sentence of sentencesOf(text)) {
    for (const part of sentence.length > max ? breakLong(sentence, max) : [sentence]) {
      if (current !== "" && current.length + 1 + part.length > max) flush();
      current = current === "" ? part : `${current} ${part}`;
    }
  }
  flush();
  return pieces;
}
