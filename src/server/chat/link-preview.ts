import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { OrgAccessContext } from "@/server/auth";
import { assertPublicHttpsUrl, UnsafeUrlError, type HostResolver } from "@/server/net-guard";
import { firstLink, MAX_LINK_CHARS } from "@/lib/chat/format/links";
import { sniffMimeType } from "@/server/files/sniff";
import { discardStoredBytes, ingest } from "@/server/services/files";
import { emitRealtime } from "@/server/realtime/emit";
import { log } from "@/server/log";

/**
 * C3b.2 — LINK PREVIEWS: the server reads a public page AFTER a message has been sent and keeps its title, description, site name and picture, so the
 * bubble can draw a card under the words.
 *
 * ⚠️ THE SERVER VISITS THE LINK. The site sees the address of THIS server, never the person's; no cookie, no authorization header and no company
 * data is sent (the request carries a plain «accept», a language and a generic agent name). 🔧 It is written in the guide, the sender can switch the card off
 * before sending (`noPreview`) and remove it afterwards («شيل المعاينة»), and the whole feature is the switch `linkPreviews`.
 *
 * What makes it safe:
 *   - ONLY through `net-guard` (`assertPublicHttpsUrl`): https, no credentials, a public address (a name that resolves to a private one is refused too), checked again
 *     at EVERY redirect hop (a public page that redirects to 10.0.0.5 or to the cloud's metadata address is refused before a byte is asked for). Redirects are
 *     followed by hand (`redirect: "manual"`), at most three.
 *   - 3 seconds for everything (every hop and the body), 512 KB of HTML at most (what is past it is not read: the tags a card needs are at the top), HTML only; the
 *     picture is at most 1 MB and is judged by its BYTES (png, jpeg, gif, webp: never an svg, never what the site claims it is).
 *   - the picture is stored with `ingest` like any chat file (Google Drive first, the server only as the fallback) and is served ONLY through the app, after the
 *     reading rule of the message (`GET /api/chat/messages/[id]/preview/image`): never the site's own address, never a Drive link.
 *   - it happens after the send committed (`linkPreviewAfterSend`, an after-send step of C1.8): a failure is logged with its reason (never the address) and never
 *     fails or delays the send. A message already stored is NEVER fetched on read: the card is made once, right after the send.
 *
 * Why not one of the existing tables: see the comment on `LinkPreview` in prisma/schema.prisma.
 */

export const PAGE_MAX_BYTES = 512 * 1024;
export const IMAGE_MAX_BYTES = 1024 * 1024;
export const PREVIEW_TIMEOUT_MS = 3_000;
export const MAX_REDIRECTS = 3;
/** A page read this recently is not read again for another message of the same company. */
export const OK_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** A page that failed is not asked again for this long (a site that is down is not hammered by every message). */
export const FAILED_RETRY_MS = 10 * 60 * 1000;
/** Pages read at the same moment by this process; more are skipped (and logged), never queued. */
const MAX_IN_FLIGHT = 6;

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 300;
const SITE_MAX = 80;

/** The picture types a card may show, by their bytes. */
const IMAGE_MIMES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

// ---------- the address ----------

/**
 * The address a message's preview is made of, or null: the FIRST link of the text (the formatter's own tokenizer, `src/lib/chat/format/links.ts`: no second
 * address pattern), and only when it is https (the guard refuses the rest) and not this app's own address. The part after `#` is dropped.
 */
export function previewUrlOf(body: string): string | null {
  const link = firstLink(body);
  if (!link) return null;
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (isOwnHost(url.hostname)) return null;
  url.hash = "";
  const href = url.href;
  return href.length <= MAX_LINK_CHARS ? href : null;
}

/** This app's own address (`APP_URL`): a link to it would be a request from the server to itself, and a card made of its login page. */
function isOwnHost(hostname: string): boolean {
  const own = process.env["APP_URL"];
  if (!own) return false;
  try {
    return new URL(own).hostname.toLowerCase() === hostname.toLowerCase();
  } catch {
    return false;
  }
}

/** The key of a page for ONE company: the company is part of it, so one company's cards and pictures never serve another's. */
export function urlHashOf(orgId: string, url: string): string {
  return createHash("sha256").update(`${orgId}\n${url}`).digest("hex");
}

// ---------- reading the tags ----------

export interface OpenGraph {
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** an absolute http(s) address, or null; the guard decides whether it may be fetched */
  imageUrl: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", ndash: "-", mdash: "-", hellip: "…" };

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return ENTITIES[name] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex as string, 16);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
    return String.fromCodePoint(code);
  });
}

/** Invisible direction marks, zero-width characters and control characters: never part of a card's words (written as numbers: no invisible character sits in this file). */
function isInvisible(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2060 && code <= 0x2069) || code === 0xfeff;
}

/** A tag's text as one plain line: tags and entities gone, invisible characters gone, white space folded, at most `max` letters. */
function cleanText(raw: string | undefined, max: number): string | null {
  if (!raw) return null;
  let out = "";
  for (const ch of decodeEntities(raw.replace(/<[^>]*>/g, " "))) {
    const code = ch.codePointAt(0) as number;
    if (code === 0x09 || code === 0x0a || code === 0x0d) out += " ";
    else if (!isInvisible(code)) out += ch;
  }
  const text = out.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const letters = [...text];
  return letters.length > max ? `${letters.slice(0, max - 1).join("")}…` : text;
}

/** The attribute text of every `<meta ...>` tag, scanned by hand so a `>` inside a quoted value ("Tips > tricks") does not end the tag. Linear; a tag longer than 4000 letters is skipped. */
function metaTagsOf(head: string): string[] {
  const out: string[] = [];
  const lower = head.toLowerCase();
  let from = 0;
  for (;;) {
    const open = lower.indexOf("<meta", from);
    if (open < 0) return out;
    const after = head.charAt(open + 5);
    if (after !== "" && !/[\s/]/.test(after)) {
      from = open + 5;
      continue;
    }
    let quote = "";
    let at = open + 5;
    const stop = Math.min(head.length, open + 4000);
    for (; at < stop; at += 1) {
      const ch = head.charAt(at);
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
    }
    if (at < stop && head.charAt(at) === ">") {
      out.push(head.slice(open + 5, at));
      from = at + 1;
    } else {
      from = open + 5;
    }
  }
}

function attrsOf(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    const name = (m[1] as string).toLowerCase();
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/**
 * `og:title`, `og:description`, `og:site_name`, `og:image` of a page (with the twitter and plain `<title>` / `description` fallbacks a site without Open Graph has).
 * Pure. The first tag of a name wins; what sits inside a comment, a script or a style is not read; only the part above `</head>` is.
 */
export function parseOpenGraph(html: string, baseUrl: string): OpenGraph {
  const end = html.search(/<\/head\s*>/i);
  const head = (end >= 0 ? html.slice(0, end) : html).replace(/<!--[\s\S]*?-->/g, " ").replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ").replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ");
  const metas = new Map<string, string>();
  for (const tag of metaTagsOf(head)) {
    const attrs = attrsOf(tag);
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").trim().toLowerCase();
    const content = attrs.get("content");
    if (key && content !== undefined && !metas.has(key)) metas.set(key, content);
  }
  const pick = (...keys: string[]): string | undefined => keys.map((k) => metas.get(k)).find((v) => v !== undefined && v.trim() !== "");
  const titleTag = /<title\b[^>]*>([\s\S]{0,2000}?)<\/title\s*>/i.exec(head)?.[1];

  let imageUrl: string | null = null;
  const rawImage = pick("og:image", "og:image:secure_url", "og:image:url", "twitter:image", "twitter:image:src");
  if (rawImage) {
    try {
      const resolved = new URL(decodeEntities(rawImage).trim(), baseUrl);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") imageUrl = resolved.href;
    } catch {
      imageUrl = null;
    }
  }
  return {
    title: cleanText(pick("og:title", "twitter:title") ?? titleTag, TITLE_MAX),
    description: cleanText(pick("og:description", "twitter:description", "description"), DESCRIPTION_MAX),
    siteName: cleanText(pick("og:site_name"), SITE_MAX),
    imageUrl,
  };
}

// ---------- the guarded request ----------

/** Why a page or a picture was not taken. Logged as it is: it never carries an address. */
export type PreviewFailure = "unsafe" | "timeout" | "network" | "status" | "redirects" | "not_html" | "not_image" | "too_large" | "empty";

export class PreviewFetchError extends Error {
  readonly code: PreviewFailure;
  constructor(code: PreviewFailure) {
    super(`link preview: ${code}`);
    this.name = "PreviewFetchError";
    this.code = code;
  }
}

export interface PreviewDeps {
  fetch: typeof fetch;
  /** names → addresses (the guard's resolver); absent: the system's */
  resolve?: HostResolver;
  /** the whole request's budget (every hop and the body); absent: 3 seconds */
  timeoutMs?: number;
}

interface GuardedGet {
  url: URL;
  contentType: string;
  bytes: Uint8Array;
  /** the body was longer than the cap and the rest was not read */
  truncated: boolean;
}

/**
 * ONE guarded GET. Every address — the first and each redirect target — goes through `assertPublicHttpsUrl` before a request is made to it. No cookie, no
 * authorization header, no referrer. The body is read only up to `maxBytes`: with `truncate` the rest is dropped and what was read is returned, without it
 * a longer body is refused.
 */
export async function guardedGet(
  rawUrl: string,
  opts: { accept: string; maxBytes: number; truncate: boolean; allowType: (contentType: string) => boolean; wrongType: PreviewFailure },
  deps: PreviewDeps,
): Promise<GuardedGet> {
  const budget = deps.timeoutMs ?? PREVIEW_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let url: URL;
      try {
        url = await assertPublicHttpsUrl(current, { resolve: deps.resolve, allowLoopbackHttp: false, timeoutMs: budget });
      } catch (err) {
        if (err instanceof UnsafeUrlError) throw new PreviewFetchError("unsafe");
        throw err;
      }
      const res = await deps.fetch(url.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { accept: opts.accept, "accept-language": "ar,en;q=0.8", "user-agent": "ZakiWorkspace-LinkPreview/1.0" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!location) throw new PreviewFetchError("status");
        current = new URL(location, url).href;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new PreviewFetchError("status");
      }
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!opts.allowType(contentType.split(";")[0]!.trim())) {
        await res.body?.cancel().catch(() => undefined);
        throw new PreviewFetchError(opts.wrongType);
      }
      const declared = Number(res.headers.get("content-length"));
      if (!opts.truncate && Number.isFinite(declared) && declared > opts.maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        throw new PreviewFetchError("too_large");
      }
      const body = await readCapped(res, opts.maxBytes, opts.truncate);
      return { url, contentType, ...body };
    }
    throw new PreviewFetchError("redirects");
  } catch (err) {
    if (err instanceof PreviewFetchError) throw err;
    throw new PreviewFetchError(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, max: number, truncate: boolean): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > max) {
      if (!truncate) {
        await reader.cancel().catch(() => undefined);
        throw new PreviewFetchError("too_large");
      }
      chunks.push(value.subarray(0, max - total));
      total = max;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { bytes, truncated };
}

/** The page's text from its bytes: the charset of the header, else of the first `<meta>`, else utf-8. */
function decodeHtml(bytes: Uint8Array, contentType: string): string {
  let label = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!label) label = /<meta[^>]{0,200}charset\s*=\s*["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(bytes.subarray(0, 2048)))?.[1];
  try {
    return new TextDecoder(label ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export interface FetchedPreview {
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: { bytes: Uint8Array; mime: string } | null;
  /** why the picture was left out (the card is made without it) */
  imageIssue?: PreviewFailure;
}

/**
 * The page, then its picture, both through the guard. A page with neither a title nor a description makes no card (`empty`). A picture that cannot be taken
 * (too big, not a real png / jpeg / gif / webp, unreachable) only leaves the picture out.
 */
export async function fetchLinkPreview(url: string, deps: PreviewDeps): Promise<FetchedPreview> {
  const page = await guardedGet(url, { accept: "text/html,application/xhtml+xml;q=0.9", maxBytes: PAGE_MAX_BYTES, truncate: true, allowType: (t) => t === "text/html" || t === "application/xhtml+xml", wrongType: "not_html" }, deps);
  const og = parseOpenGraph(decodeHtml(page.bytes, page.contentType), page.url.href);
  if (!og.title && !og.description) throw new PreviewFetchError("empty");
  const out: FetchedPreview = { title: og.title, description: og.description, siteName: og.siteName, image: null };
  if (!og.imageUrl) return out;
  try {
    const picture = await guardedGet(og.imageUrl, { accept: "image/png,image/jpeg,image/gif,image/webp", maxBytes: IMAGE_MAX_BYTES, truncate: false, allowType: (t) => t.startsWith("image/") || t === "application/octet-stream", wrongType: "not_image" }, deps);
    const mime = sniffMimeType(picture.bytes);
    if (!mime || !IMAGE_MIMES.has(mime)) out.imageIssue = "not_image";
    else out.image = { bytes: picture.bytes, mime };
  } catch (err) {
    out.imageIssue = err instanceof PreviewFetchError ? err.code : "network";
  }
  return out;
}

// ---------- after the send ----------

let depsOverride: PreviewDeps | null | undefined;

/** Tests only: the stub the fetch goes through (`null`: no fetch at all; `undefined`: the default). */
export function setLinkPreviewDepsForTests(deps: PreviewDeps | null | undefined): void {
  depsOverride = deps;
}

/**
 * Where the page is read from. Production: this process's own `fetch`. Under test: NOTHING unless a test installed a stub, so no suite that sends a message with
 * a link in it ever reaches for the network.
 */
function depsInUse(): PreviewDeps | null {
  if (depsOverride !== undefined) return depsOverride;
  return process.env["NODE_ENV"] === "test" ? null : { fetch: globalThis.fetch.bind(globalThis) };
}

let inFlight = 0;

export interface PreviewJob {
  messageId: string;
  conversationId: string;
  spaceId: string | null;
  body: string;
}

/** The card of a page already read for this company, still fresh; null: it must be read (or, for a recent failure, left alone: `failedRecently`). */
async function cachedOf(orgId: string, hash: string): Promise<{ row: Prisma.LinkPreviewGetPayload<object> | null; fresh: boolean; failedRecently: boolean }> {
  const row = await db.linkPreview.findUnique({ where: { urlHash: hash } });
  if (!row || row.orgId !== orgId) return { row: null, fresh: false, failedRecently: false };
  const age = Date.now() - row.fetchedAt.getTime();
  return { row, fresh: row.status === "OK" && age < OK_FRESH_MS, failedRecently: row.status === "FAILED" && age < FAILED_RETRY_MS };
}

/**
 * The after-send step: make (or reuse) the card of the message's first link and attach it. It is made for a TEXT message right after the send, never for an old
 * message on read. Expected refusals (a private address, a page that is not HTML, a timeout) are recorded as a FAILED row and logged by reason; anything
 * unexpected is thrown for `runAfterSend` to log with the step's name. It never touches the send.
 */
export async function linkPreviewAfterSend(ctx: OrgAccessContext, job: PreviewJob): Promise<void> {
  const deps = depsInUse();
  if (!deps) return;
  const url = previewUrlOf(job.body);
  if (!url) return;
  const hash = urlHashOf(ctx.orgId, url);

  const known = await cachedOf(ctx.orgId, hash);
  let row = known.fresh ? known.row : null;
  if (!row && known.failedRecently) {
    log.info("chat.link_preview_skipped", { reason: "failed_recently", message: job.messageId });
    return;
  }
  if (!row) {
    if (inFlight >= MAX_IN_FLIGHT) {
      log.warn("chat.link_preview_skipped", { reason: "busy", message: job.messageId });
      return;
    }
    inFlight += 1;
    try {
      row = await readAndStore(ctx, url, hash, known.row, deps, job.messageId);
    } finally {
      inFlight -= 1;
    }
  }
  if (!row) return;
  await attachPreview(ctx.orgId, job, url, row.id);
}

/** The page is read, its picture stored, the row written. A refusal returns null (and leaves an older good row of the same page as it was). */
async function readAndStore(ctx: OrgAccessContext, url: string, hash: string, old: Prisma.LinkPreviewGetPayload<object> | null, deps: PreviewDeps, messageId: string): Promise<Prisma.LinkPreviewGetPayload<object> | null> {
  let page: FetchedPreview;
  try {
    page = await fetchLinkPreview(url, deps);
  } catch (err) {
    if (!(err instanceof PreviewFetchError)) throw err;
    log.warn("chat.link_preview_failed", { reason: err.code, message: messageId });
    if (old?.status === "OK") return old; // the page is down today: the card already made stays
    await db.linkPreview.upsert({
      where: { urlHash: hash },
      create: { orgId: ctx.orgId, urlHash: hash, url, status: "FAILED" },
      update: { status: "FAILED", fetchedAt: new Date(), title: null, description: null, siteName: null },
    });
    return null;
  }
  if (page.imageIssue) log.info("chat.link_preview_image_skipped", { reason: page.imageIssue, message: messageId });

  let imageFileId: string | null = null;
  if (page.image) {
    const made = await ingest(ctx, { name: `preview.${IMAGE_EXT[page.image.mime]}`, bytes: page.image.bytes }, undefined, "CHAT", undefined, { sniffedMime: page.image.mime, maxBytes: IMAGE_MAX_BYTES });
    imageFileId = made.id;
    // ⚠️ a CHAT file nobody's message claims is an orphan upload: `purgeOrphanUploads` removes it after 24 hours. 🔧 This file belongs to its card, so it is
    // tagged for that and the purge never sees it (it is still served only through the preview route, after the message's reading rule).
    await db.storedFile.update({ where: { id: made.id }, data: { purpose: "LINKPREVIEW" } });
  }
  const data = { url, title: page.title, description: page.description, siteName: page.siteName, imageFileId, status: "OK", fetchedAt: new Date() };
  let row: Prisma.LinkPreviewGetPayload<object>;
  try {
    row = await db.linkPreview.upsert({ where: { urlHash: hash }, create: { orgId: ctx.orgId, urlHash: hash, ...data }, update: data });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
    // two messages with the same link read it at the same moment: the other one's row is the card
    row = await db.linkPreview.update({ where: { urlHash: hash }, data });
  }
  // the older picture of this page (a read that is a week old) goes: nothing points at it any more
  if (old?.imageFileId && old.imageFileId !== imageFileId) {
    const stale = await db.storedFile.findUnique({ where: { id: old.imageFileId }, select: { id: true, orgId: true, path: true, meta: true } });
    if (stale) {
      await discardStoredBytes(stale.orgId, stale);
      await db.storedFile.deleteMany({ where: { id: stale.id } });
    }
  }
  return row;
}

/** The card goes onto the message, and the screens are told (ids only). The message may have changed meanwhile: it is judged again here. */
async function attachPreview(orgId: string, job: PreviewJob, url: string, previewId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const msg = await tx.chatMessage.findFirst({ where: { id: job.messageId, orgId, deletedAt: null, previewId: null }, select: { body: true } });
    // gone, deleted, already has a card, or its first link is not the one that was read (it was edited)
    if (!msg || previewUrlOf(msg.body) !== url) return;
    await tx.chatMessage.update({ where: { id: job.messageId }, data: { previewId } });
    await emitRealtime(tx, orgId, "message.enriched", { conversationId: job.conversationId, messageId: job.messageId, spaceId: job.spaceId ?? undefined });
  });
}

/** The sender takes the card off their own message: the screens are told. Returns whether there was one. The row stays (other messages of the company may use it). */
export async function detachPreview(orgId: string, message: { id: string; conversationId: string; spaceId: string | null }): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const res = await tx.chatMessage.updateMany({ where: { id: message.id, orgId, previewId: { not: null } }, data: { previewId: null } });
    if (res.count === 0) return false;
    await emitRealtime(tx, orgId, "message.enriched", { conversationId: message.conversationId, messageId: message.id, spaceId: message.spaceId ?? undefined });
    return true;
  });
}
