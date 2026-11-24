import type { FileKind } from "@/lib/chat/file-kinds";
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
 */
export type VoiceState =
  | { mode: "idle" }
  | { mode: "recording"; elapsedMs: number; peaks: number[]; hold: boolean; locked: boolean }
  | { mode: "review"; take: VoiceTake };

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
