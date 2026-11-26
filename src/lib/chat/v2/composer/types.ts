import type { FileKind } from "@/lib/chat/file-kinds";
import type { SpeechPrefs } from "@/lib/chat/speech-langs";
import type { DragStore } from "@/lib/chat/v2/composer/hold-gesture";
import type { VoiceTake } from "@/lib/chat/voice-recorder";

/** A file waiting in the tray under the box. `asFile`: «ابعتها كملف» / «ابعت كملفات» — the bytes as they are, no compression, declared a plain file. */
export interface PendingFile {
  file: File;
  kind: FileKind;
  preview: string | null;
  asFile: boolean;
  /** «جودة عالية» (S6.2): this picture keeps the high limit of the longest side instead of the device's choice */
  hd?: boolean;
}

/**
 * idle: the text row · recording: the microphone is open (`hold`: a finger holds it, `locked`: it slid up and the bar has its own cancel and send) ·
 * review: a take that stopped by itself (5 minutes, a hidden page) waits for send or cancel.
 *
 * Only on the phone with `tgPhone` (the two states after them are never entered otherwise):
 * paused: the person paused it; `take` is what was recorded so far, to listen to (the recorder is open and can go on) ·
 * cancelling: it was thrown away and the microphone is closed; only the dust is still on screen, then idle.
 */
export type VoiceState =
  | { mode: "idle" }
  | { mode: "recording"; elapsedMs: number; peaks: number[]; hold: boolean; locked: boolean }
  | { mode: "review"; take: VoiceTake }
  | { mode: "paused"; take: VoiceTake; elapsedMs: number; peaks: number[] }
  | { mode: "cancelling"; from: "slide" | "trash"; elapsedMs: number; peaks: number[] };

/** What the engine adds for the phone's recording bar (`tgPhone`); absent everywhere else, and the old bar is drawn. */
export interface TgVoiceView {
  conversationId: string;
  /** where the holding finger is (the bar reads it without a render of the composer) */
  drag: DragStore;
  /** the tooltip under a short tap of the microphone */
  tip: boolean;
  /** the company's transcription service is there for this person (the header's `voiceTranscript`) */
  transcribe: boolean;
  /** the company's switch `voiceLiveText` */
  liveAllowed: boolean;
  /** the person's «تحويل الكلام لنص» choices, and whether they were read (until then nothing is sent for its words by itself) */
  speech: SpeechPrefs;
  speechReady: boolean;
  setLanguage: (code: string) => void;
  pause: () => void;
  resume: () => void;
  discard: (from: "slide" | "trash") => void;
}

/** One line of the «@» list. */
export interface MentionChoice {
  id: string;
  name: string;
  online?: boolean;
  avatarUrl?: string | null;
  all?: boolean;
  /** «إشارة التوثيق» (S5.5): the person carries the check badge (`MemberDto.verified`; absent otherwise) */
  verified?: boolean;
}
