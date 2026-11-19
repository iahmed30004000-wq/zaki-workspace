import type { FileKind } from "@/lib/chat/file-kinds";
import type { VoiceTake } from "@/lib/chat/voice-recorder";

/** A file waiting in the tray under the box. `asFile`: «ابعتها كملف» / «ابعت كملفات» — the bytes as they are, no compression, declared a plain file. */
export interface PendingFile {
  file: File;
  kind: FileKind;
  preview: string | null;
  asFile: boolean;
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
}
