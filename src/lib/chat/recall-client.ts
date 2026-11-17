/**
 * «/» في صندوق الكتابة (Q1.3), the part of it that is pure: what the box says when its text is a slash command.
 *
 *   «/»            alone: the menu opens (the person chooses)
 *   «/منتج حراك»   the product menu with «حراك» already searched   (the space after the word is what says it is finished)
 *   «/رد توصيل»    the answers menu with «توصيل» searched
 *
 * A word still being typed («/منت») is not a command: nothing opens while somebody writes a message that happens to start with a slash.
 */
export type RecallKind = "product" | "reply";

export const RECALL_WORDS: Record<string, RecallKind> = { "منتج": "product", "رد": "reply" };

export interface SlashCommand {
  /** null: the bare «/» — the menu opens and the person picks. */
  kind: RecallKind | null;
  q: string;
}

export function slashCommand(text: string): SlashCommand | null {
  if (text === "/") return { kind: null, q: "" };
  const m = /^\/(\S+)\s(.*)$/su.exec(text);
  if (!m) return null;
  const kind = RECALL_WORDS[m[1] ?? ""];
  return kind ? { kind, q: (m[2] ?? "").trim() } : null;
}
