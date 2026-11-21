/**
 * M1a — what another app hands to «زاكي» through the phone's share sheet (the manifest's `share_target`, a GET to `/share` with `title`, `text` and
 * `url`), turned into the words that wait in a conversation's composer. Pure: the page, the picker and the tests read the same functions.
 *
 * ⚠️ Everything in the address is typed by somebody else (a page the person shared from, or a link someone crafted): it is text and nothing more. It is
 * cleaned of control characters, cut at the composer's own draft length, a `url` is kept only when it is an http(s) address, and nothing here ever sends.
 * 🔧 The chosen conversation receives it as an unsent DRAFT (`composer-draft.ts`); the person reads it, edits it and presses send.
 */

/** The composer's draft is cut at this many characters (`saveComposerDraft`): a share is never longer than what a draft keeps. */
export const SHARE_TEXT_MAX = 4000;

export interface SharedParams {
  title?: string | null | undefined;
  text?: string | null | undefined;
  url?: string | null | undefined;
}

/** A search parameter as Next hands it over (a repeated parameter counts by its first value). */
export function firstParam(value: string | string[] | undefined): string | null {
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === "string" ? one : null;
}

/** Control characters out (a tab and a newline stay), the ends trimmed. */
function clean(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

/** An http(s) address as the browser reads it, or "" (`javascript:`, `data:`, a bare word, junk). */
export function safeShareUrl(raw: string | null | undefined): string {
  const value = clean(raw);
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

/**
 * The words of a share: the title, the text and the address, in that order, each only when it adds something (Android's share sheet very often puts the
 * address inside `text` as well as in `url`, and a page's title is often the text's own first line).
 */
export function sharedTextFrom(params: SharedParams): string {
  const parts: string[] = [];
  const add = (part: string) => {
    if (part && !parts.some((kept) => kept.includes(part))) parts.push(part);
  };
  add(clean(params.title));
  add(clean(params.text));
  add(safeShareUrl(params.url));
  // a later part that CONTAINS an earlier one (the text that already holds the title) replaces it
  const joined = parts.filter((part, index) => !parts.some((other, j) => j > index && other !== part && other.includes(part)));
  return joined.join("\n").slice(0, SHARE_TEXT_MAX);
}

/** The shared words added after whatever the person had already typed in that conversation (never replacing it). */
export function appendSharedText(existing: string | null | undefined, shared: string): string {
  const before = (existing ?? "").replace(/\s+$/, "");
  const words = clean(shared);
  if (!words) return before;
  if (!before) return words.slice(0, SHARE_TEXT_MAX);
  if (before.endsWith(words)) return before;
  return `${before}\n${words}`.slice(0, SHARE_TEXT_MAX);
}
