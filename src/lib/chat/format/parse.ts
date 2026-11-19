import { bareLinkAt, hostOf, safeHref } from "@/lib/chat/format/links";
import { cleanMath } from "@/lib/chat/format/math";

/**
 * C3b.1 — THE parser of the chat's text formatting. Pure (a string in, tokens out), no HTML anywhere, shared by the screen (`render.tsx`) and by every path that sends
 * text out (`stripFormatting`: previews, push notifications, search snippets, and every text that goes to a model).
 *
 * The text stays text in `ChatMessage.body` (no schema): `**bold**`, `__italic__`, `~~strike~~`, `` `code` ``, a fenced block of three back ticks, `||spoiler||`,
 * lines that start with «> » (a quote), `[text](https://…)` and bare links. The rules are the forgiving kind a chat needs:
 *   - a marker that does not pair stays as typed; a pair needs a word right after the opener and right before the closer (`2 ** 3 ** 4`, `a || b` are not markers);
 *   - markers nest (`**a __b__**`), never cross, and stop nesting after `MAX_DEPTH` levels;
 *   - a code span, a fenced block and an address are opaque: nothing inside them is formatted;
 *   - a link is `https:` / `http:` / `mailto:` or an in-app path only (`links.ts`); anything else is the text that was typed;
 *   - `<script>`, entities and every other piece of markup are plain text tokens: React escapes them when they are drawn.
 *
 * Speed: one left-to-right pass finds the code spans, the links and the places where a closing marker could stand; every opener then asks a sorted list for its
 * closer (a binary search), so a body of 10 000 characters is parsed in well under 5 ms whatever its shape (the unit test pins it).
 */

export type Inline =
  | { t: "text"; text: string }
  | { t: "bold" | "italic" | "strike" | "spoiler"; children: Inline[] }
  | { t: "code"; text: string }
  | { t: "link"; href: string; internal: boolean; label: Inline[] };

export type Block =
  | { t: "text"; inline: Inline[] }
  | { t: "quote"; inline: Inline[] }
  | { t: "pre"; text: string };

export const MAX_DEPTH = 4;

export interface ParseOptions {
  /**
   * The text was CUT (a 140-character preview): a marker still open at its end is closed there, so a spoiler that lost its closing `||` does not show its words on a
   * lock screen. Never set for a body that is drawn whole.
   */
  partial?: boolean;
}

type PairKind = "bold" | "italic" | "strike" | "spoiler";
const PAIRS: ReadonlyArray<{ kind: PairKind; mark: string; code: number }> = [
  { kind: "bold", mark: "**", code: 42 },
  { kind: "italic", mark: "__", code: 95 },
  { kind: "strike", mark: "~~", code: 126 },
  { kind: "spoiler", mark: "||", code: 124 },
];
const PAIR_BY_CODE = new Map(PAIRS.map((p) => [p.code, p]));

const isSpace = (char: string | undefined): boolean => char === undefined || /\s/.test(char);

/** The first value of a sorted list that is >= `from`, or -1. */
function firstAtLeast(list: number[], from: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as number) < from) lo = mid + 1;
    else hi = mid;
  }
  return lo < list.length ? (list[lo] as number) : -1;
}

interface Span {
  end: number;
  token: Inline;
}

interface Scan {
  src: string;
  /** the opaque pieces (a code span, a link), by where they start */
  spans: Map<number, Span>;
  /** where a closing marker may stand, per kind, sorted */
  closers: Record<PairKind, number[]>;
  partial: boolean;
  /** a link's label: no spoiler there (a button inside an anchor) */
  inLabel: boolean;
}

/** Extensions that look like a domain's last part but are file names («invoice.pdf», «app.js»): a label that says one is not claiming a web address. */
const FILE_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "gif", "webp", "svg", "zip", "rar", "txt", "csv", "mp3", "mp4", "json", "js", "ts", "py", "md", "html", "css", "xml"]);
const BARE_DOMAIN = /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.([\p{L}]{2,24})(?:[/?#].*)?$/u;
const WORD_EDGES = /^[("'«[]+|[.,;:!?)"'»\]،؛؟…]+$/g;

/** The hosts a label CLAIMS: every word of it that is written as an address (with a scheme, with «www.», or as a bare domain). «?» stands for one that cannot be read. */
function claimedHosts(label: string): string[] {
  const hosts: string[] = [];
  for (const raw of label.split(/\s+/)) {
    const word = raw.replace(WORD_EDGES, "");
    if (word === "") continue;
    if (/^(?:https?:\/\/|mailto:|www\.)/i.test(word) || word.includes("://")) {
      hosts.push(hostOf(word) ?? "?");
      continue;
    }
    const domain = BARE_DOMAIN.exec(word);
    if (domain && !FILE_EXTENSIONS.has((domain[1] as string).toLowerCase())) hosts.push((word.split(/[/?#]/)[0] as string).toLowerCase().replace(/^www\./, ""));
  }
  return hosts;
}

/** `[label](address)` starting at `i`: its end and token, or null (the brackets then stay text). */
function markdownLinkAt(src: string, i: number, closeAt: { v: number }): Span | null {
  if (closeAt.v === -1) return null;
  if (closeAt.v <= i) {
    closeAt.v = src.indexOf("]", i + 1);
    if (closeAt.v === -1) return null;
  }
  const close = closeAt.v;
  if (close - i > 200 || src.charCodeAt(close + 1) !== 40) return null; // a label is short; «](» follows it
  const label = src.slice(i + 1, close);
  if (label === "" || label.includes("[") || label.includes("\n")) return null;
  // the address: up to the matching «)», no space inside, brackets balanced
  let depth = 0;
  let j = close + 2;
  const limit = Math.min(src.length, j + 2_049);
  for (; j < limit; j += 1) {
    const ch = src.charCodeAt(j);
    if (ch === 40) depth += 1;
    else if (ch === 41) {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch <= 32) return null;
  }
  if (j >= limit || src.charCodeAt(j) !== 41) return null;
  const safe = safeHref(src.slice(close + 2, j));
  if (!safe) return null;
  let words = parseInline(label, 1, false, { inLabel: true });
  // a label that shows an address of ANOTHER site shows the real address (no «paypal.com» that opens evil.example); a sub-site of the site it names is honest
  const target = hostOf(safe.href);
  const claimed = claimedHosts(label);
  if (claimed.length > 0 && (target === null || claimed.some((host) => host !== target && !target.endsWith(`.${host}`)))) words = [{ t: "text", text: safe.href }];
  return { end: j + 1, token: { t: "link", href: safe.href, internal: safe.internal, label: words } };
}

/** One pass over the text: the opaque spans and the candidate closers. */
function scan(src: string, allowLinks: boolean, partial: boolean, inLabel: boolean): Scan {
  const spans = new Map<number, Span>();
  const closers: Record<PairKind, number[]> = { bold: [], italic: [], strike: [], spoiler: [] };
  const closeAt = { v: 0 };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = src.charCodeAt(i);
    if (ch === 96) {
      // a run of three back ticks that never became a block stays as it is; one back tick pairs with the next one on the same line
      if (src.startsWith("```", i)) {
        i += 3;
        continue;
      }
      const j = src.indexOf("`", i + 1);
      if (j > i + 1 && !src.slice(i + 1, j).includes("\n")) {
        spans.set(i, { end: j + 1, token: { t: "code", text: src.slice(i + 1, j) } });
        i = j + 1;
        continue;
      }
      i += 1;
    } else if (ch === 91 && allowLinks) {
      const link = markdownLinkAt(src, i, closeAt);
      if (link) {
        spans.set(i, link);
        i = link.end;
      } else {
        i += 1;
      }
    } else if (allowLinks && (ch === 104 || ch === 72 || ch === 109 || ch === 77 || ch === 119 || ch === 87)) {
      const found = bareLinkAt(src, i);
      if (found) {
        spans.set(i, { end: found.end, token: { t: "link", href: found.href, internal: false, label: [{ t: "text", text: found.text }] } });
        i = found.end;
      } else {
        i += 1;
      }
    } else {
      const pair = PAIR_BY_CODE.get(ch);
      if (pair && src.charCodeAt(i + 1) === ch && i > 0 && !isSpace(src[i - 1])) closers[pair.kind].push(i);
      i += 1;
    }
  }
  return { src, spans, closers, partial, inLabel };
}

function parseRange(sc: Scan, lo: number, hi: number, depth: number): Inline[] {
  const { src, spans, closers } = sc;
  const out: Inline[] = [];
  let run = lo;
  const flush = (to: number) => {
    if (to > run) out.push({ t: "text", text: src.slice(run, to) });
  };
  let p = lo;
  while (p < hi) {
    const span = spans.get(p);
    if (span && span.end <= hi) {
      flush(p);
      out.push(span.token);
      p = span.end;
      run = p;
      continue;
    }
    const pair = depth < MAX_DEPTH ? PAIR_BY_CODE.get(src.charCodeAt(p)) : undefined;
    if (pair && !(sc.inLabel && pair.kind === "spoiler") && src.charCodeAt(p + 1) === pair.code && p + 2 < hi && !isSpace(src[p + 2])) {
      const close = firstAtLeast(closers[pair.kind], p + 3);
      if (close !== -1 && close + 2 <= hi) {
        flush(p);
        out.push({ t: pair.kind, children: parseRange(sc, p + 2, close, depth + 1) });
        p = close + 2;
        run = p;
        continue;
      }
      if (close === -1 && sc.partial && hi === src.length) {
        // cut text: the marker still open at the end is closed there
        flush(p);
        out.push({ t: pair.kind, children: parseRange(sc, p + 2, hi, depth + 1) });
        p = hi;
        run = hi;
        continue;
      }
    }
    p += 1;
  }
  flush(hi);
  return out;
}

interface InlineOptions {
  partial?: boolean;
  inLabel?: boolean;
}

/** The inline tokens of one piece of text (a paragraph, a quote, a link's label). */
function parseInline(src: string, depth: number, allowLinks: boolean, options: InlineOptions = {}): Inline[] {
  if (src === "") return [];
  return parseRange(scan(src, allowLinks, options.partial === true, options.inLabel === true), 0, src.length, depth);
}

/** Text that holds nothing the formatter looks for: the parser returns it as ONE token without scanning it. */
const MAYBE_FORMAT = /[*_~|`[]|(?:^|\n)> |https?:\/\/|www\.|mailto:/i;

/** The lines of a text segment as blocks: runs of ordinary lines, and runs of «> » lines (a quote). */
function lineBlocks(segment: string, startsLine: boolean, out: Block[], options: ParseOptions): void {
  if (segment === "") return;
  const lines = segment.split("\n");
  let plain: string[] = [];
  let quote: string[] = [];
  const flushPlain = () => {
    if (plain.length === 0) return;
    out.push({ t: "text", inline: parseInline(plain.join("\n"), 0, true, options) });
    plain = [];
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push({ t: "quote", inline: parseInline(quote.join("\n"), 0, true, options) });
    quote = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const quoted = (i > 0 || startsLine) && line.startsWith("> ") && line.slice(2).trim() !== "";
    if (quoted) {
      flushPlain();
      quote.push(line.slice(2));
    } else {
      flushQuote();
      plain.push(line);
    }
  }
  flushPlain();
  flushQuote();
}

/** The blocks of a message body: paragraphs, quotes and fenced blocks, each with its inline tokens. An empty body is no block. */
export function parseFormatting(body: string, options: ParseOptions = {}): Block[] {
  if (body === "") return [];
  if (!MAYBE_FORMAT.test(body)) return [{ t: "text", inline: [{ t: "text", text: body }] }];
  const out: Block[] = [];
  let textStart = 0;
  let searchFrom = 0;
  for (;;) {
    const open = body.indexOf("```", searchFrom);
    if (open === -1) break;
    const close = body.indexOf("```", open + 3);
    if (close === -1) break;
    let code = body.slice(open + 3, close);
    if (code.trim() === "") {
      searchFrom = close + 3; // «``` ```»: not a block, the back ticks stay in the text
      continue;
    }
    if (code.startsWith("\n")) code = code.slice(1);
    if (code.endsWith("\n")) code = code.slice(0, -1);
    let before = body.slice(textStart, open);
    if (before.endsWith("\n")) before = before.slice(0, -1);
    lineBlocks(before, textStart === 0 || body[textStart - 1] === "\n", out, { partial: false });
    out.push({ t: "pre", text: code });
    textStart = close + 3;
    if (body[textStart] === "\n") textStart += 1;
    searchFrom = textStart;
  }
  lineBlocks(body.slice(textStart), textStart === 0 || body[textStart - 1] === "\n", out, options);
  return out;
}

export interface StripOptions {
  /** «hide» (the default, for every screen-like path): a spoiler's words are not read out; «keep»: for a model call, whose askers can read them in the conversation */
  spoilers?: "hide" | "keep";
  /** leftover math markup is shown as plain characters (the previews ask for it; the model paths send the words as they are) */
  math?: boolean;
  /** the text was cut (a preview): a marker still open at its end is closed there, and a link cut inside its address shows its label only */
  partial?: boolean;
}

/** What a hidden spoiler is replaced by in a preview. */
export const SPOILER_MASK = "•••";

/** A link that was cut inside its address: «[label](https://exam» */
const CUT_LINK = /\[([^[\]\n]{1,200})\]\([^)\s]{0,2048}$/;

function plainOf(tokens: readonly Inline[], keep: boolean, math: boolean): string {
  let out = "";
  for (const token of tokens) {
    if (token.t === "text") out += math ? cleanMath(token.text) : token.text;
    else if (token.t === "code") out += token.text;
    else if (token.t === "spoiler") out += keep ? plainOf(token.children, keep, math) : SPOILER_MASK;
    else if (token.t === "link") out += plainOf(token.label, keep, math);
    else out += plainOf(token.children, keep, math);
  }
  return out;
}

/**
 * The words of a body without the markers: what a list row, a push notification, a search snippet and every text sent to a model shows. Built from the
 * parser's own tokens, so the screen and the text-out paths can never disagree about what a marker is. A body with nothing to strip is returned as it is.
 */
export function stripFormatting(body: string, options: StripOptions = {}): string {
  if (body === "") return body;
  const math = options.math === true;
  if (!MAYBE_FORMAT.test(body)) return math ? cleanMath(body) : body;
  const keep = options.spoilers === "keep";
  const partial = options.partial === true;
  const text = partial ? body.replace(CUT_LINK, "$1") : body;
  return parseFormatting(text, { partial })
    .map((block) => (block.t === "pre" ? block.text : plainOf(block.inline, keep, math)))
    .join("\n");
}
