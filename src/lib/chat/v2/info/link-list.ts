import { findLinks, hostOf } from "@/lib/chat/format/links";
import type { LinkItemDto } from "@/server/chat/media";

/**
 * S5.4 — THE ADDRESSES OF «روابط», as pure functions shared by the server (which reads them out of the messages' own words) and the screen (which merges the pages).
 *
 * What is an address is decided by the chat's ONE tokenizer (`lib/chat/format/links.ts`): a bare `https://…`, `http://…` or `www.…`, and the address inside
 * `[text](address)`. Only web pages are listed (`mailto:` is a link in a message, but it is not a page to open from a list). Two spellings of one page are ONE row:
 * the host's case, a trailing slash and a `#fragment` do not make a new address; a different query or a different scheme does.
 */
export interface ListedLink {
  /** the address as it stands in the text (a bare `www.` one gets its `https://`) */
  url: string;
  /** the host as the reader sees it (`www.` dropped) */
  host: string;
  /** what two spellings of the same page share */
  key: string;
}

/** The key of an address: the scheme, the lower-cased host, the path without its trailing slash, the query — never the fragment. `""` when it is not a web address. */
export function linkKeyOf(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : "";
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return "";
  }
}

/** Every web address of a text, in the order they stand, each page once. */
export function linksOfBody(body: string): ListedLink[] {
  const out: ListedLink[] = [];
  const seen = new Set<string>();
  for (const found of findLinks(body)) {
    if (found.internal || !/^https?:\/\//i.test(found.href)) continue;
    const key = linkKeyOf(found.href);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ url: found.href, host: hostOf(found.href) ?? "", key });
  }
  return out;
}

/** The pages of the list (newest first), flattened; a page the server cut at its own boundary never repeats an address that an earlier (newer) page already had. */
export function mergeLinkPages(pages: readonly (readonly LinkItemDto[])[]): LinkItemDto[] {
  const seen = new Set<string>();
  const out: LinkItemDto[] = [];
  for (const page of pages) {
    for (const link of page) {
      const key = linkKeyOf(link.url) || link.url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(link);
    }
  }
  return out;
}
