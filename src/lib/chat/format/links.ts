/**
 * C3b.1 — THE link tokenizer of the chat. Pure: a string in, the places of its links out. The formatter (`parse.ts`) uses it for `[text](address)` and for bare
 * addresses, and C3b.2 (link previews) reuses `findLinks` / `safeHref` so the two never disagree about what a link is.
 *
 * What may be a link (the traps of the plan):
 *   - `https:`, `http:` and `mailto:` only. `javascript:`, `data:`, `vbscript:`, `file:`, `ftp:` and a protocol-less `//host` are NOT links: they stay the text that was typed.
 *   - an address with a user name or a password (`https://google.com@evil.com`) is not a link (the part before the at-sign is not the host the reader thinks it is).
 *   - an in-app path: exactly `/chat/...` or `/tasks/...` (no `//`, no `..`, no backslash). Any other path of this site (`/api/...`) is not offered as a link.
 */

export interface SafeHref {
  href: string;
  /** an in-app path: it opens inside the app, not in a new tab */
  internal: boolean;
}

/** The longest address taken as a link (a longer one is text). */
export const MAX_LINK_CHARS = 2_048;

/** Invisible direction marks and embeddings: an address that carries one is not drawn as a link (they reorder what the reader sees). Written as numbers so no invisible character sits in this file. */
const BIDI_CODES: ReadonlySet<number> = new Set([0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

/** A control character, a space or an invisible direction mark anywhere: never part of an address drawn as a link. */
function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || BIDI_CODES.has(code)) return true;
  }
  return false;
}

const INTERNAL_PATH = /^\/(?:chat|tasks)(?:\/[A-Za-z0-9_\-./?=&#%:+~@!$'*,;()]*)?$/;

/** The address a link may point to, or null. Everything the browser would run or hand to another program is refused. */
export function safeHref(raw: string): SafeHref | null {
  const value = raw.trim();
  if (value === "" || value.length > MAX_LINK_CHARS) return null;
  if (hasUnsafeChar(value)) return null;
  if (value.startsWith("/")) {
    if (value.includes("//") || value.includes("..") || value.includes("\\")) return null;
    return INTERNAL_PATH.test(value) ? { href: value, internal: true } : null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "https:" || url.protocol === "http:") {
    if (url.hostname === "" || url.username !== "" || url.password !== "") return null;
    return { href: url.href, internal: false };
  }
  if (url.protocol === "mailto:") {
    return url.pathname !== "" && !url.pathname.startsWith("/") ? { href: url.href, internal: false } : null;
  }
  return null;
}

export interface FoundLink {
  /** where the link stands in the text: `text.slice(start, end)` is `text` */
  start: number;
  end: number;
  /** the words as typed (what is drawn when the link has no label) */
  text: string;
  href: string;
  internal: boolean;
}

const SCHEMES = ["https://", "http://", "mailto:", "www."];
/** What follows an address in a sentence and is not part of it: marks, a closing bracket, the markers of the formatter itself, and the Arabic comma, semicolon and question mark. */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "'", '"', ")", "]", "}", "*", "_", "~", "|", String.fromCharCode(0x060c), String.fromCharCode(0x061b), String.fromCharCode(0x061f), String.fromCharCode(0x2026)]);

/** A character that ends a bare address: a space, markup, a quote, a back tick, an invisible direction mark. */
function endsAddress(char: string): boolean {
  return /[\s<>"`]/.test(char) || BIDI_CODES.has(char.charCodeAt(0));
}

/** True when `index` may begin a bare address: the character before it does not belong to a word or to another address. */
function startsBare(text: string, index: number): boolean {
  const code = text.charCodeAt(index) | 32; // lower-case an ASCII letter
  if (code !== 104 && code !== 109 && code !== 119) return false; // h, m, w
  if (index === 0) return true;
  return !/[\p{L}\p{N}_@./:-]/u.test(text[index - 1] ?? "");
}

function count(text: string, char: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) if (text[i] === char) n += 1;
  return n;
}

/** The end (exclusive) of the bare address that starts at `start`, with the sentence's own punctuation left out; -1 when there is none. */
function bareEnd(text: string, start: number): number {
  const head = text.slice(start, start + 8).toLowerCase();
  const scheme = SCHEMES.find((s) => head.startsWith(s));
  if (!scheme) return -1;
  let end = start + scheme.length;
  const limit = Math.min(text.length, start + MAX_LINK_CHARS + 1);
  while (end < limit && !endsAddress(text[end] as string)) end += 1;
  // trim what belongs to the sentence; a closing bracket stays when its opening one is inside the address (Wikipedia: .../Foo_(bar))
  while (end > start + scheme.length) {
    const last = text[end - 1] as string;
    if (!TRAILING.has(last)) break;
    if (last === ")") {
      const inside = text.slice(start, end);
      if (count(inside, "(") >= count(inside, ")")) break;
    }
    end -= 1;
  }
  return end - start > scheme.length ? end : -1;
}

/** The link that starts exactly at `start` (a bare address), or null. */
export function bareLinkAt(text: string, start: number): FoundLink | null {
  if (!startsBare(text, start)) return null;
  const end = bareEnd(text, start);
  if (end < 0) return null;
  const typed = text.slice(start, end);
  const safe = safeHref(/^www\./i.test(typed) ? `https://${typed}` : typed);
  if (!safe || safe.internal) return null;
  return { start, end, text: typed, href: safe.href, internal: false };
}

/** Every bare address of a text, in order (`[text](address)` is the formatter's business; the address inside it is found here too, which is what a preview wants). */
export function findLinks(text: string): FoundLink[] {
  const out: FoundLink[] = [];
  if (!/https?:\/\/|mailto:|www\./i.test(text)) return out;
  for (let i = 0; i < text.length; ) {
    const link = bareLinkAt(text, i);
    if (link) {
      out.push(link);
      i = link.end;
    } else {
      i += 1;
    }
  }
  return out;
}

/** The first link of a text (the one a preview is made of), or null. */
export function firstLink(text: string): FoundLink | null {
  return findLinks(text)[0] ?? null;
}

/** The host of an address as the reader sees it (`www.` dropped), or null when it is not one. Used to catch a label that shows one address and opens another. */
export function hostOf(address: string): string | null {
  const typed = address.trim();
  const safe = safeHref(/^www\./i.test(typed) ? `https://${typed}` : typed);
  if (!safe || safe.internal) return null;
  try {
    const url = new URL(safe.href);
    return url.protocol === "mailto:" ? url.pathname.toLowerCase() : url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
