import { stripFormatting } from "@/lib/chat/format/parse";
import { isBlankText } from "@/lib/chat/checklist";

/**
 * «المقالات» — a long formatted post. PURE (no database, no React).
 *
 * An article is an ordinary `ChatMessage` of kind ARTICLE whose body is TEXT: the first line is the title, the rest is the content. So everything a message already has
 * works for it with no new table: deleting and the owner's original, the edit history, forwarding, search, the archive; a screen that does not know the kind draws the words.
 * Its pictures are the message's own attachments (images only).
 *
 * The content is the chat's own formatting (`src/lib/chat/format/parse.ts`: bold, italic, strike, code, a code block, a spoiler, «> » quote, links) plus three line shapes
 * read here: «## » / «### » a heading, «- » or «1. » a list, and a line that is only `![2]` the second picture. Nothing is ever HTML: every piece of words is drawn by
 * the formatter, as React text.
 */
export const ARTICLE_KIND = "ARTICLE";
export const MAX_ARTICLE_TITLE = 120;
/** the whole stored body (the title, the line break and the content) */
export const MAX_ARTICLE_BODY = 20_000;
export const MAX_ARTICLE_IMAGES = 10;

export type ArticleBlock =
  | { t: "heading"; level: 2 | 3; text: string }
  | { t: "list"; ordered: boolean; items: string[] }
  | { t: "image"; index: number }
  /** a run of ordinary lines: drawn by the chat's formatter as it is */
  | { t: "text"; text: string };

const HEADING = /^(#{1,3})\s+(\S.*)$/;
const BULLET = /^\s*[-•]\s+(\S.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(\S.*)$/;
const PICTURE = /^\s*!\[(\d{1,2})\]\s*$/;

export function splitArticle(body: string): { title: string; content: string } {
  const at = body.indexOf("\n");
  if (at === -1) return { title: body.trim(), content: "" };
  return { title: body.slice(0, at).trim(), content: body.slice(at + 1).replace(/^\n+/, "") };
}

export function joinArticle(title: string, content: string): string {
  return `${title.replace(/\s+/g, " ").trim()}\n${content.replace(/\r\n?/g, "\n").trim()}`;
}

export function articleTitleOf(body: string): string {
  return splitArticle(body).title;
}

/** Why a title and a content cannot be an article (null: they can). The server and the editor ask the same function. */
export function articleProblem(title: string, content: string): "title" | "content" | "long" | null {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t || [...t].length > MAX_ARTICLE_TITLE || isBlankText(stripFormatting(t))) return "title";
  if (isBlankText(stripFormatting(content))) return "content";
  if (joinArticle(title, content).length > MAX_ARTICLE_BODY) return "long";
  return null;
}

/** The same question about a stored (or arriving) body. */
export function articleBodyProblem(body: string): "title" | "content" | "long" | null {
  if (body.length > MAX_ARTICLE_BODY) return "long";
  const { title, content } = splitArticle(body);
  return articleProblem(title, content);
}

/** The lines of the content, each marked as inside a fenced code block or not (a «#» in a code block is code). A fence that never closes is not a fence. */
function fencedLines(content: string): { line: string; fenced: boolean }[] {
  const lines = content.split("\n");
  const ticks = lines.map((line) => line.split("```").length - 1);
  let open = false;
  return lines.map((line, i) => {
    const count = ticks[i]!;
    const was = open;
    if (count % 2 === 1) {
      if (open) open = false;
      else if (ticks.slice(i + 1).some((n) => n > 0)) open = true;
    }
    return { line, fenced: was || open || count > 0 };
  });
}

/** The content as blocks. `images` is how many pictures the message holds: a marker of a picture that is not there stays words. */
export function parseArticle(content: string, images: number): ArticleBlock[] {
  const out: ArticleBlock[] = [];
  let text: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushText = () => {
    const joined = text.join("\n").replace(/^\n+|\n+$/g, "");
    if (joined.trim()) out.push({ t: "text", text: joined });
    text = [];
  };
  const flushList = () => {
    if (list) out.push({ t: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  for (const { line, fenced } of fencedLines(content)) {
    if (!fenced) {
      const picture = PICTURE.exec(line);
      const index = picture ? Number(picture[1]) - 1 : -1;
      if (index >= 0 && index < images) {
        flushText();
        flushList();
        out.push({ t: "image", index });
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        flushText();
        flushList();
        out.push({ t: "heading", level: heading[1]!.length >= 3 ? 3 : 2, text: heading[2]!.trim() });
        continue;
      }
      const bullet = BULLET.exec(line);
      const numbered = bullet ? null : NUMBERED.exec(line);
      const item = bullet ?? numbered;
      if (item) {
        flushText();
        const ordered = numbered !== null;
        if (list && list.ordered !== ordered) flushList();
        list ??= { ordered, items: [] };
        list.items.push(item[1]!.trim());
        continue;
      }
    }
    flushList();
    text.push(line);
  }
  flushText();
  flushList();
  return out;
}

/** The pictures no line of the content places: they are drawn after the words, so none is ever lost. */
export function unplacedImages(blocks: readonly ArticleBlock[], images: number): number[] {
  const placed = new Set(blocks.flatMap((b) => (b.t === "image" ? [b.index] : [])));
  return Array.from({ length: images }, (_, i) => i).filter((i) => !placed.has(i));
}

export const ARTICLE_EXCERPT_MAX = 180;

/** The first words of the content for the card: no markers, no picture lines, a spoiler hidden. */
export function articleExcerpt(content: string, max = ARTICLE_EXCERPT_MAX): string {
  // the whole content is stripped FIRST (a spoiler that runs over several lines stays hidden), then the line marks go
  const words = stripFormatting(content, { math: true })
    .split("\n")
    .filter((line) => !PICTURE.test(line))
    .map((line) => line.replace(HEADING, "$2").replace(BULLET, "$1").replace(NUMBERED, "$1"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...words];
  return chars.length <= max ? words : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * The editor's pictures at send time: the picture lines are renumbered 1..n in the order they appear, a second line of one picture is kept pointing at it, and only the
 * pictures the content places are sent. `used` are the editor's own indexes (0-based) in the order the attachments must be sent.
 */
export function compactArticleImages(content: string, count: number): { content: string; used: number[] } {
  const used: number[] = [];
  const lines = fencedLines(content).map(({ line, fenced }) => {
    if (fenced) return line;
    const m = PICTURE.exec(line);
    if (!m) return line;
    const index = Number(m[1]) - 1;
    if (index < 0 || index >= count) return "";
    if (!used.includes(index)) used.push(index);
    return `![${used.indexOf(index) + 1}]`;
  });
  return { content: lines.join("\n"), used };
}

/** The editor's line buttons («عنوان», «قائمة», «اقتباس»): the prefix is put on every line the selection touches, or taken off when they all have it already. */
export function prefixLines(value: string, start: number, end: number, prefix: string): { value: string; start: number; end: number } {
  const from = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const stop = value.indexOf("\n", Math.max(start, end > start && value[end - 1] === "\n" ? end - 1 : end));
  const to = stop === -1 ? value.length : stop;
  const lines = value.slice(from, to).split("\n");
  const all = lines.every((line) => line.startsWith(prefix));
  const next = lines.map((line) => (all ? line.slice(prefix.length) : line.startsWith(prefix) ? line : prefix + line)).join("\n");
  const changed = value.slice(0, from) + next + value.slice(to);
  if (end > start) return { value: changed, start: from, end: from + next.length };
  const caret = Math.max(from, start + (all ? -prefix.length : lines[0]!.startsWith(prefix) ? 0 : prefix.length));
  return { value: changed, start: caret, end: caret };
}

/** A picture's own line put where the caret is, with the line breaks it needs. */
export function insertPictureLine(value: string, at: number, number: number): { value: string; caret: number } {
  const before = value.slice(0, at);
  const after = value.slice(at);
  const lead = before === "" || before.endsWith("\n") ? "" : "\n";
  const piece = lead + "![" + number + "]\n";
  return { value: before + piece + after.replace(/^\n/, ""), caret: before.length + piece.length };
}
