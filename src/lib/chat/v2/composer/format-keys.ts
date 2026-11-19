/**
 * C3b.1 — the composer's formatting, as pure functions of the box's text and selection: which key press is a formatting action (`formatActionOf`), and what the text
 * and the selection become when the action is applied (`applyFormat`). The surface calls them; a test needs no browser.
 *
 *   Ctrl+B  bold          wraps the selection in `**`
 *   Ctrl+I  italic        `__`
 *   Ctrl+U  spoiler       `||`   (the chat has no underline: «مخفي» takes the key Telegram uses for it)
 *   Ctrl+Shift+X  strike  `~~`
 *   Ctrl+Shift+M  code    one back tick on one line, three back ticks around several lines
 *   Ctrl+K  link          `[selection](https://)` with the address selected, ready to type
 *
 * The PHYSICAL key decides (`code === "KeyB"`): on the Arabic layout the same key types another letter. The command key of a Mac counts as Ctrl.
 * Applying an action twice undoes it (the selection is already wrapped, or sits right inside the marker). Space at either end of the selection stays OUTSIDE the
 * marker (a marker next to a space is not a marker for the parser: `** word**` is plain text).
 */

export type FormatAction = "bold" | "italic" | "spoiler" | "strike" | "code" | "link";

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey?: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** an input method is composing a word: never a shortcut then */
  isComposing?: boolean;
}

/** The action a key press means, or null. */
export function formatActionOf(e: KeyLike): FormatAction | null {
  if (e.isComposing) return null;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const letter = e.code && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
  if (!e.shiftKey) {
    if (letter === "b") return "bold";
    if (letter === "i") return "italic";
    if (letter === "u") return "spoiler";
    if (letter === "k") return "link";
    return null;
  }
  if (letter === "x") return "strike";
  if (letter === "m") return "code";
  return null;
}

/** The shortcut of each action as the toolbar's tooltip says it (Ctrl and the Latin letter are the only Latin on this screen). */
export const FORMAT_SHORTCUTS: Readonly<Record<FormatAction, string>> = {
  bold: "Ctrl+B",
  italic: "Ctrl+I",
  spoiler: "Ctrl+U",
  strike: "Ctrl+Shift+X",
  code: "Ctrl+Shift+M",
  link: "Ctrl+K",
};

export const FORMAT_ACTIONS: readonly FormatAction[] = ["bold", "italic", "strike", "code", "spoiler", "link"];

const MARK: Record<Exclude<FormatAction, "code" | "link">, string> = { bold: "**", italic: "__", spoiler: "||", strike: "~~" };

export interface Edit {
  value: string;
  /** the selection after the edit */
  start: number;
  end: number;
}

const BLANK = /\s/;

function replaceRange(value: string, from: number, to: number, inserted: string): string {
  return value.slice(0, from) + inserted + value.slice(to);
}

function wrapWith(value: string, start: number, end: number, open: string, close: string): Edit {
  const inner = value.slice(start, end);
  // already wrapped, with the markers inside the selection: take them off
  if (inner.length > open.length + close.length && inner.startsWith(open) && inner.endsWith(close)) {
    const bare = inner.slice(open.length, inner.length - close.length);
    return { value: replaceRange(value, start, end, bare), start, end: start + bare.length };
  }
  // already wrapped, with the markers just outside the selection: take them off
  if (start >= open.length && value.startsWith(open, start - open.length) && value.startsWith(close, end)) {
    return { value: replaceRange(replaceRange(value, end, end + close.length, ""), start - open.length, start, ""), start: start - open.length, end: end - open.length };
  }
  return { value: replaceRange(value, start, end, open + inner + close), start: start + open.length, end: end + open.length };
}

/** The selection without the spaces at its ends (they stay outside the marker). */
function trimmed(value: string, start: number, end: number): [number, number] {
  let from = start;
  let to = end;
  while (from < to && BLANK.test(value[from] as string)) from += 1;
  while (to > from && BLANK.test(value[to - 1] as string)) to -= 1;
  return [from, to];
}

/** The text and selection after `action` is applied to the selection `[start, end)` of `value`. */
export function applyFormat(value: string, selStart: number, selEnd: number, action: FormatAction): Edit {
  const lo = Math.max(0, Math.min(selStart, selEnd, value.length));
  const hi = Math.min(value.length, Math.max(selStart, selEnd));
  const [start, end] = trimmed(value, lo, hi);
  const empty = start === end;
  // nothing (or only spaces) selected: the pair is inserted at the caret and the caret goes between
  const at = empty ? hi : start;

  if (action === "link") {
    if (empty) {
      const text = "[](https://)";
      return { value: replaceRange(value, at, at, text), start: at + 1, end: at + 1 };
    }
    const inner = value.slice(start, end);
    // a selected address becomes the target and the caret goes to the label; any other words become the label and the target is typed next
    if (/^(?:https?:\/\/|www\.|mailto:)\S+$/i.test(inner)) {
      const text = `[](${inner})`;
      return { value: replaceRange(value, start, end, text), start: start + 1, end: start + 1 };
    }
    const target = "https://";
    const text = `[${inner}](${target})`;
    const from = start + inner.length + 3;
    return { value: replaceRange(value, start, end, text), start: from, end: from + target.length };
  }

  if (action === "code") {
    const inner = value.slice(start, end);
    if (!empty && inner.includes("\n")) {
      // several lines: a block (a selection that is already a block loses its fences)
      if (inner.length > 6 && inner.startsWith("```") && inner.endsWith("```")) {
        const bare = inner.slice(3, -3).replace(/^\n/, "").replace(/\n$/, "");
        return { value: replaceRange(value, start, end, bare), start, end: start + bare.length };
      }
      const block = "```\n" + inner + "\n```";
      return { value: replaceRange(value, start, end, block), start: start + 4, end: start + 4 + inner.length };
    }
    if (empty) return { value: replaceRange(value, at, at, "``"), start: at + 1, end: at + 1 };
    return wrapWith(value, start, end, "`", "`");
  }

  const mark = MARK[action];
  if (empty) return { value: replaceRange(value, at, at, mark + mark), start: at + mark.length, end: at + mark.length };
  return wrapWith(value, start, end, mark, mark);
}
