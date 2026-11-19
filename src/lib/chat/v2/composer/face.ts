/**
 * C2.5 — what the round button at the end of the composer is. `composerBarOf` (kept, in `pane/composer-bar.ts`) says WHETHER there is a composer; this says
 * what its main button is while there is one:
 *
 *   empty box, no attachment          → the microphone (where voice notes are on)
 *   text or an attachment             → send
 *   an edit being typed               → save
 *
 * Pure: the view only draws the answer.
 */
export type ComposerFace = "mic" | "send" | "save";

export interface FaceInput {
  text: string;
  fileCount: number;
  editing: boolean;
  /** the company's «الرسائل الصوتية» switch (`voiceNotes` is not false) */
  voiceOn: boolean;
}

export function composerFaceOf(i: FaceInput): ComposerFace {
  if (i.editing) return "save";
  if (i.text.trim() || i.fileCount > 0) return "send";
  return i.voiceOn ? "mic" : "send";
}

/** May the main button submit now? A mic is never a submit; a save needs words; a send needs words or a file. */
export function canSubmitNow(i: FaceInput & { busy: boolean }): boolean {
  if (i.busy) return false;
  if (i.editing) return i.text.trim().length > 0;
  return i.text.trim().length > 0 || i.fileCount > 0;
}
