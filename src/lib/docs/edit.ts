import { findMentionQuery } from "@/lib/chat/conversation/mentions";

/**
 * «المستندات» — what the editor's buttons do to the text. Pure: the textarea hands over its text and selection, gets the new
 * text and selection back. The buttons write the same little markup a person could type (src/lib/docs/markup.ts).
 */

export interface Selection {
  start: number;
  end: number;
}
export type EditAction = "bold" | "h1" | "h2" | "ul" | "ol" | "link";

const PREFIX: Record<"h1" | "h2" | "ul" | "ol", string> = { h1: "# ", h2: "## ", ul: "- ", ol: "1. " };
const ANY_PREFIX = /^(#{1,3} +|[-*] +|\d{1,3}[.)] +)/;

export function applyEdit(value: string, selection: Selection, action: EditAction): { value: string; selection: Selection } {
  const start = Math.max(0, Math.min(selection.start, selection.end, value.length));
  const end = Math.max(0, Math.min(Math.max(selection.start, selection.end), value.length));

  if (action === "bold") {
    const inside = value.slice(start, end);
    // already wrapped, with the stars INSIDE the selection: take them off
    if (inside.length >= 4 && inside.startsWith("**") && inside.endsWith("**")) {
      const bare = inside.slice(2, -2);
      return { value: value.slice(0, start) + bare + value.slice(end), selection: { start, end: start + bare.length } };
    }
    // wrapped, with the stars just OUTSIDE the selection: take them off too
    if (value.slice(start - 2, start) === "**" && value.slice(end, end + 2) === "**") {
      return { value: value.slice(0, start - 2) + inside + value.slice(end + 2), selection: { start: start - 2, end: start - 2 + inside.length } };
    }
    // nothing selected: an empty pair with the cursor in the middle; a selection stays selected inside the stars
    const next = value.slice(0, start) + "**" + inside + "**" + value.slice(end);
    return { value: next, selection: { start: start + 2, end: start + 2 + inside.length } };
  }

  if (action === "link") {
    const label = value.slice(start, end) || "رابط";
    const lead = `[${label}](`;
    const next = value.slice(0, start) + lead + "https://" + ")" + value.slice(end);
    const from = start + lead.length;
    return { value: next, selection: { start: from, end: from + "https://".length } };
  }

  // a line action: the whole line the cursor is in
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const found = value.indexOf("\n", start);
  const lineEnd = found === -1 ? value.length : found;
  const line = value.slice(lineStart, lineEnd);
  const prefix = PREFIX[action];
  const existing = ANY_PREFIX.exec(line)?.[0] ?? "";
  // the same prefix again takes it off; another one is replaced
  const body = line.slice(existing.length);
  const nextLine = existing.trim() === prefix.trim() ? body : prefix + body;
  const delta = nextLine.length - line.length;
  const caret = Math.max(lineStart, start + delta);
  return { value: value.slice(0, lineStart) + nextLine + value.slice(lineEnd), selection: { start: caret, end: caret } };
}

/**
 * The `@word` the cursor stands in (the chat's own finder, applied to the text BEFORE the cursor, so it works in the middle of
 * a document and not only at its end).
 */
export function mentionContext(value: string, cursor: number): { query: string; start: number } | null {
  return findMentionQuery(value.slice(0, Math.max(0, Math.min(cursor, value.length))));
}

/** Put `name` where the `@word` is, and give back the text and the place of the cursor (after the name and one space). */
export function pickMention(value: string, cursor: number, name: string): { value: string; cursor: number } {
  const at = mentionContext(value, cursor);
  if (!at) return { value, cursor };
  const before = value.slice(0, at.start);
  const after = value.slice(cursor);
  const token = `@${name} `;
  // one space is enough: do not double it when the text goes on with a space
  const rest = after.startsWith(" ") ? after.slice(1) : after;
  return { value: before + token + rest, cursor: before.length + token.length };
}
