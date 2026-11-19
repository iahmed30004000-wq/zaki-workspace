/**
 * C2.6 — «اقرأ النص» (a picture) and «حوّل الصوت لنص» (a voice note) are items of the menu, but the work is done by the button each file already draws
 * under itself (`ImageText`, `VoiceTranscript`: the doors, the busy line, the failure line and the kept result all live there, and this package may not
 * copy them). The menu PRESSES that button, found by the mark its owner puts on it — the same pattern the header uses for «لخّصلي».
 *
 *  - a message with several pictures: the first block that has NO text on screen yet is the one pressed (a read one, whose text carries `dir="auto"`, is
 *    skipped, so a second picture is read when the first already was);
 *  - when every block already shows its text nothing happens: the person sees it;
 *  - the button of a block is «اقرا النص» / «اكتب النص» when nothing was asked, the retry after a failure, or «اعرض» when the result was hidden; a busy
 *    button is disabled, so a second press does nothing.
 */
export type InlineKind = "image-text" | "voice-transcript";

const MARK: Record<InlineKind, string> = { "image-text": "[data-image-text]", "voice-transcript": "[data-voice-transcript]" };

interface PressNode {
  querySelector: (selector: string) => unknown;
}
export interface PressRoot {
  querySelector: (selector: string) => PressNode | null;
  querySelectorAll?: (selector: string) => ArrayLike<PressNode>;
}

export function pressInlineButton(root: PressRoot | null | undefined, kind: InlineKind): boolean {
  if (!root) return false;
  const hosts: ArrayLike<PressNode> = root.querySelectorAll ? root.querySelectorAll(MARK[kind]) : [root.querySelector(MARK[kind])].filter((h): h is PressNode => h !== null);
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i]!;
    if (host.querySelector('[dir="auto"]')) continue;
    const button = host.querySelector("button") as { click?: () => void; disabled?: boolean } | null;
    if (!button || typeof button.click !== "function" || button.disabled) continue;
    button.click();
    return true;
  }
  return false;
}
