/**
 * A text cut into the parts that match the words being looked for and the parts that do not. Arabic is compared the way people type it: the forms of the
 * alef, «ة» and «ه», «ى» and «ي» are one letter, and marks above the letters do not count. The pieces are the ORIGINAL letters.
 */
export interface MatchPiece {
  text: string;
  match: boolean;
}

const MARKS = /[\u064B-\u065F\u0670\u0640]/;
const fold = (letter: string): string => (/[\u0623\u0625\u0622\u0671]/.test(letter) ? "\u0627" : letter === "\u0629" ? "\u0647" : letter === "\u0649" ? "\u064A" : letter.toLowerCase());

/** The folded text, and for each of its letters where it stands in the original. */
function folded(text: string): { out: string; at: number[] } {
  let out = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const letter = text[i] as string;
    if (MARKS.test(letter)) continue;
    const next = fold(letter);
    out += next.length === 1 ? next : letter;
    at.push(i);
  }
  return { out, at };
}

export function matchPieces(text: string, words: string): MatchPiece[] {
  const needle = folded(words.trim()).out;
  if (!needle || !text) return [{ text, match: false }];
  const hay = folded(text);
  const pieces: MatchPiece[] = [];
  let done = 0;
  let from = 0;
  for (;;) {
    const found = hay.out.indexOf(needle, from);
    if (found < 0) break;
    const start = hay.at[found] as number;
    const after = hay.at[found + needle.length];
    const end = after === undefined ? text.length : after;
    if (start > done) pieces.push({ text: text.slice(done, start), match: false });
    pieces.push({ text: text.slice(start, end), match: true });
    done = end;
    from = found + needle.length;
  }
  if (pieces.length === 0) return [{ text, match: false }];
  if (done < text.length) pieces.push({ text: text.slice(done), match: false });
  return pieces;
}
