/**
 * C2.6 — «اقرأ النص» (a picture) and «حوّل الصوت لنص» (a voice note) are items of the menu, but the work is done by the button each file already draws
 * under itself (`ImageText`, `VoiceTranscript`: the doors, the busy line, the failure line and the kept result all live there, and this package may not
 * copy them). The menu PRESSES that button, found by the mark its owner puts on it — the same pattern the header uses for «لخّصلي».
 *
 *  - nothing happens while the text is already on screen (it carries `dir="auto"`): the person sees it;
 *  - otherwise the first button is pressed: «اقرا النص» / «اكتب النص» when nothing was asked, the retry after a failure, or «اعرض» when the result was
 *    hidden; a busy button is disabled, so a second press does nothing.
 */
export type InlineKind = "image-text" | "voice-transcript";

const MARK: Record<InlineKind, string> = { "image-text": "[data-image-text]", "voice-transcript": "[data-voice-transcript]" };

export interface PressRoot {
  querySelector: (selector: string) => PressNode | null;
}
interface PressNode {
  querySelector: (selector: string) => unknown;
}

export function pressInlineButton(root: PressRoot | null | undefined, kind: InlineKind): boolean {
  const host = root?.querySelector(MARK[kind]);
  if (!host) return false;
  if (host.querySelector('[dir="auto"]')) return false;
  const button = host.querySelector("button") as { click?: () => void; disabled?: boolean } | null;
  if (!button || typeof button.click !== "function" || button.disabled) return false;
  button.click();
  return true;
}
