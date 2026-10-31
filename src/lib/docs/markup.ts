import { splitMentions } from "@/lib/chat/conversation/mentions";

/**
 * «المستندات» — the little markup of a document. Pure (no React, no server imports): the server cleans what is saved and
 * reads the people it names, the screen draws the tree it parses.
 *
 * A document is TEXT, with five things a person can ask for:
 *
 *     # عنوان كبير        ## عنوان وسط        ### عنوان صغير
 *     - نقطة              1. بند مرقّم
 *     **غامق**            [نص الرابط](https://…)            @اسم شخص من المساحة
 *
 * It is never stored or drawn as HTML: `parseDoc` makes a tree of plain nodes and the screen turns each node into its own
 * element, so a document can contain `<script>` or `javascript:` and it is only words. A link is drawn only when its address
 * is https, http or mailto (`safeHref`).
 */

export const LIMITS = {
  title: 200,
  /** Characters of text in one document (about forty pages). */
  content: 100_000,
} as const;

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "link"; href: string; text: string }
  | { kind: "mention"; text: string };

export type Block =
  | { kind: "h1" | "h2" | "h3" | "p"; inline: Inline[] }
  | { kind: "ul" | "ol"; items: Inline[][] };

/** The text as it is stored: one kind of line break, no control characters (tab and new line stay). Never refuses: it fixes. */
export function cleanContent(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/** The address of a link as the browser will get it, or null when it is not https, http or mailto (javascript:, data:, relative…). */
export function safeHref(raw: string): string | null {
  const text = raw.trim();
  if (text !== raw || text.length === 0 || text.length > 2000 || /\s/.test(text)) return null;
  if (!/^(https?:\/\/|mailto:)/i.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol === "mailto:") return url.pathname.length > 0 ? text : null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.length > 0 ? url.href : null;
  } catch {
    return null;
  }
}

const HEADING = /^(#{1,3}) +(.*)$/;
const BULLET = /^[-*] +(.*)$/;
const NUMBERED = /^\d{1,3}[.)] +(.*)$/;
const TOKEN = /\*\*([^*]+?)\*\*|\[([^\]\n]+)\]\(([^)\n]*)\)/g;

/** The pieces of one line of text: bold, links, mentions of `names`, and the words between them. */
export function parseInline(text: string, names: readonly string[], allowBold = true): Inline[] {
  const out: Inline[] = [];
  const pushPlain = (chunk: string) => {
    if (!chunk) return;
    for (const piece of splitMentions(chunk, names)) {
      if (piece.mention) out.push({ kind: "mention", text: piece.text });
      else out.push({ kind: "text", text: piece.text });
    }
  };
  let at = 0;
  // a fresh expression per call: a bold part is parsed again inside this loop, and a shared `lastIndex` would never end
  const token = new RegExp(TOKEN.source, "g");
  for (let m = token.exec(text); m; m = token.exec(text)) {
    pushPlain(text.slice(at, m.index));
    if (m[1] !== undefined) {
      if (allowBold) out.push({ kind: "bold", children: parseInline(m[1], names, false) });
      else pushPlain(m[0]);
    } else {
      const label = m[2] ?? "";
      const href = safeHref(m[3] ?? "");
      // an unsafe address is shown as the words it was written with, never as a link
      if (href) out.push({ kind: "link", href, text: label });
      else pushPlain(m[0]);
    }
    at = m.index + m[0].length;
  }
  pushPlain(text.slice(at));
  return mergeText(out);
}

function mergeText(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.kind === "text" && last?.kind === "text") last.text += node.text;
    else out.push(node);
  }
  return out;
}

/** The blocks of a document; `names` are the people of the space (an @name outside them stays text). */
export function parseDoc(content: string, names: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "p", inline: parseInline(paragraph.join("\n"), names) });
    paragraph = [];
  };
  for (const line of cleanContent(content).split("\n")) {
    const trimmed = line.trimEnd();
    const heading = HEADING.exec(trimmed);
    const bullet = BULLET.exec(trimmed);
    const numbered = NUMBERED.exec(trimmed);
    if (trimmed.trim() === "") {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ kind: `h${heading[1]!.length}` as "h1" | "h2" | "h3", inline: parseInline(heading[2] ?? "", names) });
    } else if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const item = parseInline((bullet ?? numbered)![1] ?? "", names);
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else {
      paragraph.push(trimmed);
    }
  }
  flush();
  return blocks;
}

function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => (n.kind === "bold" ? inlineText(n.children) : n.text))
    .join("");
}

/** The words of a document without its markup (the list's excerpt, a search, a notification). */
export function plainText(content: string): string {
  return parseDoc(content, [])
    .map((b) => ("items" in b ? b.items.map(inlineText).join(" ") : inlineText(b.inline)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerptOf(content: string, max = 160): string {
  const text = plainText(content);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The ids of the people of `people` whose `@name` stands in the text as a whole word (longest name first, each once). */
export function mentionedIds(content: string, people: readonly { id: string; name: string }[]): string[] {
  const ids = new Set<string>();
  const found = new Set(
    splitMentions(
      cleanContent(content),
      people.map((p) => p.name),
    )
      .filter((piece) => piece.mention)
      .map((piece) => piece.text.slice(1)),
  );
  for (const person of people) if (found.has(person.name)) ids.add(person.id);
  return [...ids];
}
