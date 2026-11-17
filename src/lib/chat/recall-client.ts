/**
 * «/» في صندوق الكتابة (Q1.3), the part of it that is pure: what the box says when its text is a slash command.
 *
 *   «/»            alone: the menu opens (the person chooses)
 *   «/منتج حراك»   the product menu with «حراك» already searched   (the space after the word is what says it is finished)
 *   «/رد توصيل»    the answers menu with «توصيل» searched
 *
 * A word still being typed («/منت») is not a command: nothing opens while somebody writes a message that happens to start with a slash.
 */
export type RecallKind = "product" | "reply" | "order";

export const RECALL_WORDS: Record<string, RecallKind> = { "منتج": "product", "رد": "reply", "طلب": "order" };

export interface SlashCommand {
  /** null: the bare «/» — the menu opens and the person picks. */
  kind: RecallKind | null;
  q: string;
}

/** A command is a short single line; a pasted or long text that merely starts with a command word is a message and is never swallowed. */
const MAX_COMMAND = 120;

export function slashCommand(text: string, offered?: readonly RecallKind[]): SlashCommand | null {
  if (text === "/") return { kind: null, q: "" };
  if (text.length > MAX_COMMAND || /[\r\n]/.test(text)) return null;
  const m = /^\/(\S+)\s(.*)$/su.exec(text);
  if (!m) return null;
  const word = m[1] ?? "";
  const kind = Object.hasOwn(RECALL_WORDS, word) ? RECALL_WORDS[word] : undefined;
  if (kind && offered && !offered.includes(kind)) return null;
  return kind ? { kind, q: (m[2] ?? "").trim() } : null;
}
