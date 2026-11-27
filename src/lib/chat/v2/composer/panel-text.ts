/**
 * «تيليجرام على التلفون» — what the emoji panel does to the words in the box while the phone's keyboard is closed: put a piece at the caret, or «⌫» one
 * whole thing (a joined emoji or a sticker's code is one thing, never half of it).
 */
export interface TextEdit {
  text: string;
  caret: number;
}

const bounds = (text: string, start: number, end: number): [number, number] => {
  const from = Math.min(Math.max(Math.min(start, end), 0), text.length);
  return [from, Math.min(Math.max(Math.max(start, end), from), text.length)];
};

export function insertPiece(text: string, start: number, end: number, piece: string): TextEdit {
  const [from, to] = bounds(text, start, end);
  return { text: text.slice(0, from) + piece + text.slice(to), caret: from + piece.length };
}

const STICKER_AT_END = /:zaki_[a-z_]{2,24}:$/;

/** The length of the last whole character of `text`: a grapheme where the browser can cut them, else a code point. */
function lastUnitLength(text: string): number {
  const Segmenter = (Intl as unknown as { Segmenter?: new () => { segment: (value: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) {
    let last = "";
    for (const part of new Segmenter().segment(text)) last = part.segment;
    return last.length;
  }
  return Array.from(text).at(-1)?.length ?? 0;
}

export function deleteBack(text: string, start: number, end: number): TextEdit {
  const [from, to] = bounds(text, start, end);
  if (to > from) return { text: text.slice(0, from) + text.slice(to), caret: from };
  const head = text.slice(0, from);
  if (!head) return { text, caret: 0 };
  const length = STICKER_AT_END.exec(head)?.[0].length ?? lastUnitLength(head);
  return { text: head.slice(0, head.length - length) + text.slice(from), caret: from - length };
}
