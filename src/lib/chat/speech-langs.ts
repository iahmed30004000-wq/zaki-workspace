/**
 * «تحويل الكلام لنص» — the languages and the person's choices (`User.chatPrefs.speech`). Pure.
 *
 * Two things listen, and they take a language differently:
 *  - the company's transcription service (the words of a recording before it is sent) takes a short code («ar»), or guesses it («تلقائي»);
 *  - the browser's own live recognition (the words WHILE recording, switch `voiceLiveText`) takes a full code («ar-JO») and cannot guess, so «تلقائي»
 *    means Arabic there.
 *
 * Arabic is first and the default. Each language is a code and a key of the dictionary (never a word in the code).
 */
export const SPEECH_LANGS = [
  { code: "ar-JO", labelKey: "chatlive.lang_ar_jo" },
  { code: "ar-SA", labelKey: "chatlive.lang_ar_sa" },
  { code: "ar-EG", labelKey: "chatlive.lang_ar_eg" },
  { code: "en-US", labelKey: "chatlive.lang_en_us" },
  { code: "ru-RU", labelKey: "tgvoice.lang_ru" },
  { code: "uk-UA", labelKey: "tgvoice.lang_uk" },
  { code: "es-ES", labelKey: "tgvoice.lang_es" },
  { code: "it-IT", labelKey: "tgvoice.lang_it" },
  { code: "pt-PT", labelKey: "tgvoice.lang_pt" },
  { code: "id-ID", labelKey: "tgvoice.lang_id" },
  { code: "uz-UZ", labelKey: "tgvoice.lang_uz" },
  { code: "fa-IR", labelKey: "tgvoice.lang_fa" },
  { code: "km-KH", labelKey: "tgvoice.lang_km" },
  { code: "fr-FR", labelKey: "tgvoice.lang_fr" },
  { code: "tr-TR", labelKey: "tgvoice.lang_tr" },
  { code: "de-DE", labelKey: "tgvoice.lang_de" },
] as const;

export const SPEECH_AUTO = "auto";
export const DEFAULT_SPEECH_LANG = "ar-JO";
export const SPEECH_CHOICES: [string, ...string[]] = [SPEECH_AUTO, ...SPEECH_LANGS.map((l) => l.code)];

const listed = (code: unknown): code is string => typeof code === "string" && SPEECH_LANGS.some((l) => l.code === code);

/** The person's stored choice, or Arabic. */
export function speechChoiceOf(value: unknown): string {
  return value === SPEECH_AUTO || listed(value) ? (value as string) : DEFAULT_SPEECH_LANG;
}

/** The language of the live words: the choice when it is a language, else Arabic. */
export function liveLangOf(value: unknown): string {
  return listed(value) ? value : DEFAULT_SPEECH_LANG;
}

/** What the transcription service is told: the short code, or «auto» (it guesses). */
export function serviceLangOf(value: unknown): string {
  const choice = speechChoiceOf(value);
  return choice === SPEECH_AUTO ? SPEECH_AUTO : choice.slice(0, choice.indexOf("-"));
}

export interface SpeechPrefs {
  /** the language of speech-to-text (a code of the list, or «auto») */
  language: string;
  /** the live words while recording, on the phone (the company's switch `voiceLiveText` must be on too) */
  live: boolean;
  /** the recording's words are written by themselves in the preview, before sending */
  preview: boolean;
}

export function resolveSpeech(section: { language?: unknown; live?: unknown; preview?: unknown } | null | undefined): SpeechPrefs {
  return { language: speechChoiceOf(section?.language), live: section?.live !== false, preview: section?.preview !== false };
}
