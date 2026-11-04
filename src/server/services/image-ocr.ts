import { db } from "@/server/db";
import { audit, ForbiddenError, NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { loadConversationFacts } from "@/server/policy/conversation";
import { LocalQueue } from "@/server/ai/local-queue";
import { parseLocalBaseUrl } from "@/server/ai/local-host";
import { callLocal, jsonOf, stripThinking, targetOf, type LocalTransport } from "@/server/ai/local-transport";
import { AiProviderError } from "@/server/ai/provider";
import { FixedWindowLimiter, RateLimitedError } from "@/server/rate-limit";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { assertMayReadFile, openStored } from "@/server/services/files";
import { conversationHasGuest } from "@/server/services/chat-assistant";
import type { ApiErrorCode } from "@/server/api";

/**
 * «قراءة نص الصور» — the words inside a picture (a chat image, a library image), read by a vision model the owner runs himself, kept, and
 * found by search.
 *
 *   WHERE   `OCR_URL` in the server's environment: an https address with a public name OR an address inside the owner's own network, judged by
 *           the SAME guard as the gateway and the speech-to-text service (src/server/ai/local-host.ts, `external: true` — the owner typed it
 *           into the server's environment himself, which is the consent the gateway's switch stands for) and again on every call; a name is
 *           resolved on every connection and the socket connects only to an address that passed (a public name must resolve to PUBLIC
 *           addresses, an inside one to PRIVATE ones); a redirect is never followed. `OCR_MODEL` (required: there is no good default for a
 *           vision model) and an optional `OCR_API_KEY`, read from the environment at the moment of the call, put in ONE header and never
 *           stored, returned, logged, audited or put in an error. The service speaks the OpenAI shape: POST `/v1/chat/completions`, the
 *           picture as a data URL in an `image_url` part, the answer `choices[0].message.content`.
 *   WHO     whoever may READ the file: a library file by the library rule (`assertMayReadFile`: the «يشوف» box and the person's spaces), a
 *           chat image by the conversation rule (the same gate as `/api/chat/attachments/[id]` and `/api/files/[id]/raw`; the owner's silent
 *           oversight included, a deleted message's picture for the owner only). NEVER for an external partner (a guest), and never for a
 *           picture of a conversation a guest can reach (`conversationHasGuest`: a doubt is a refusal) — nothing of such a place goes to a model.
 *   LIMITS  png / jpeg / webp only (judged by the bytes, not by the name or the stored type), at most 6 MB, one reading at a time per
 *           machine (a queue), 10 readings a minute per person and 100 an hour per company; the text is cut at 20 000 characters.
 *   KEPT    `FileText` (one row per file): asking again returns the kept text and sends nothing; «اقرا من جديد» (`again`) sends the picture again
 *           and replaces the text. The search reads it under the same visibility rule as the file or the message.
 *   TRACE   one audit row per reading that reached the service: who, which file, how many bytes and characters, the outcome. Never the text,
 *           the picture, the address or the key.
 *   SWITCH  `imageOcr`, off by default (the picture leaves the app for that service). Off: the route answers «not found», nothing is sent and
 *           search ignores the kept texts.
 *
 * ⚠️ The picture is sent to the service the owner set up, which may be an outside one, and the text can be wrong (blurred, handwriting).
 * 🔧 The switch is off until he turns it on in «الميزات»; the screen shows the text under the picture as «النص المقروء», never in its place.
 */

export const OCR_PATH = "/v1/chat/completions";
export const MAX_OCR_BYTES = 6 * 1024 * 1024;
export const MAX_FILE_TEXT_CHARS = 20_000;
export const OCR_TIMEOUT_MS = 120_000;
export const OCR_MAX_OUTPUT_TOKENS = 4_096;
const OCR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type OcrMime = (typeof OCR_TYPES)[number];

export const OCR_PROMPT =
  "Extract all the text that is visible in this image, exactly as written, in the original language and script (Arabic, Latin or both), keeping the line breaks. " +
  "Answer with the extracted text only: no commentary, no translation, no description of the picture, no quotation marks. If the image has no text, answer with nothing.";

export interface OcrServer {
  /** `https://vision.example.com`: already judged. */
  origin: string;
  model: string;
  /** The Bearer key, or null. Lives only in this object, only for the duration of a call. */
  apiKey: string | null;
  /** An outside https address with a public name (its socket accepts public addresses only). */
  external: boolean;
}

/** The vision service of this installation, or null while it has none (the feature then hides its button). */
export function ocrServer(source: Readonly<Record<string, string | undefined>> = process.env): OcrServer | null {
  // the app adds `/v1/chat/completions` itself: a trailing `/v1` (or slashes) typed by habit is dropped
  const url = (source["OCR_URL"] ?? "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "").replace(/\/+$/, "");
  if (!url) return null;
  const parsed = parseLocalBaseUrl(url, { external: true });
  if (!parsed.ok) return null;
  const model = (source["OCR_MODEL"] ?? "").trim();
  if (!/^[\w./:@+-]{1,120}$/.test(model)) return null;
  const rawKey = (source["OCR_API_KEY"] ?? "").trim();
  // a key with a space or a control character would split the header: no service rather than a broken one
  if (rawKey !== "" && !/^[\x21-\x7e]{1,500}$/.test(rawKey)) return null;
  return { origin: parsed.target.origin, model, apiKey: rawKey === "" ? null : rawKey, external: parsed.target.external === true };
}

/** Is the button to be drawn for this company: the switch is on AND a service is set up. */
export async function ocrAvailable(orgId: string, source: Readonly<Record<string, string | undefined>> = process.env): Promise<boolean> {
  return ocrServer(source) !== null && (await isFeatureOn(orgId, "imageOcr"));
}

export class ImageOcrError extends Error {
  constructor(
    readonly key: string,
    readonly code: ApiErrorCode = "conflict",
  ) {
    super(key);
    this.name = "ImageOcrError";
  }
}

/** The picture's type from its first bytes (the stored type is only a first filter): png, jpeg or webp, or null. */
export function sniffImage(bytes: Uint8Array): OcrMime | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "image/png";
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "image/webp";
  return null;
}

/** The body of the request: exactly what is sent, so a test can read it back. */
export function buildOcrBody(model: string, image: { bytes: Uint8Array; mime: OcrMime }): Record<string, unknown> {
  const dataUrl = `data:${image.mime};base64,${Buffer.from(image.bytes).toString("base64")}`;
  return {
    model,
    stream: false,
    temperature: 0,
    max_tokens: OCR_MAX_OUTPUT_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: OCR_PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };
}

/** The text of the first choice (a plain string, or the list of parts some gateways answer), without a «thinking» block. */
export function textOfAnswer(json: unknown): string {
  const choices = (json as { choices?: unknown } | null)?.choices;
  const first = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } } | undefined) : undefined;
  const content = first?.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) text = content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
  return stripThinking(text).trim().slice(0, MAX_FILE_TEXT_CHARS);
}

const failureKey = (err: unknown): string => {
  if (!(err instanceof AiProviderError)) return "imageOcr.err_failed";
  if (err.key === "assistant.err_local_timeout") return "imageOcr.err_timeout";
  if (err.key === "assistant.err_local_busy") return "imageOcr.err_busy";
  if (err.key === "assistant.err_local_down" || err.key === "assistant.err_local_host") return "imageOcr.err_down";
  return "imageOcr.err_failed";
};

async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ImageOcrError("imageOcr.err_big");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Readings wait for each other (a small machine does one at a time); a fourth in line is told «busy». */
const ocrQueue = new LocalQueue(3, 120_000);
/** 10 readings a minute for a person, 100 an hour for a company (only readings that reach the service count). */
export const ocrUserLimiter = new FixedWindowLimiter({ limit: 10, windowMs: 60_000 });
export const ocrOrgLimiter = new FixedWindowLimiter({ limit: 100, windowMs: 3_600_000 });

/** One picture to the service, one text back. Everything bounded: a timeout, the size of the picture, the length of the text. */
export async function ocrBytes(
  server: OcrServer,
  image: { bytes: Uint8Array; mime: OcrMime },
  options: { transport?: LocalTransport; queue?: LocalQueue } = {},
): Promise<string> {
  try {
    const target = targetOf(server.origin, server.external);
    const body = buildOcrBody(server.model, image);
    const run = () =>
      callLocal({
        target,
        method: "POST",
        path: OCR_PATH,
        body,
        headers: server.apiKey ? { authorization: `Bearer ${server.apiKey}` } : {},
        timeoutMs: OCR_TIMEOUT_MS,
        ...(options.transport ? { transport: options.transport } : {}),
      });
    return textOfAnswer(jsonOf(await (options.queue ?? ocrQueue).run(run)));
  } catch (err) {
    if (err instanceof ImageOcrError) throw err;
    throw new ImageOcrError(failureKey(err));
  }
}

export interface FileTextResult {
  text: string;
  /** The kept text was returned: the picture was not sent. */
  cached: boolean;
  /** When the kept text was written (ISO). */
  at: string;
}

export interface OcrOptions {
  /** «اقرا من جديد»: send the picture again and replace the kept text. */
  again?: boolean;
  source?: Readonly<Record<string, string | undefined>>;
  transport?: LocalTransport;
  queue?: LocalQueue;
}

/**
 * The gate: may THIS person read the text of THIS picture? A «not found» (never 403) for a picture they cannot open, 403 for a guest and for a
 * conversation a guest can reach. Returns what the reading needs.
 */
export async function assertMayReadPicture(actor: Actor, fileId: string): Promise<{ id: string; orgId: string; mimeType: string; size: number }> {
  if (actor.isExternal) throw new ForbiddenError("guest.no_access");
  // the same gate as the bytes: library rule for a library file, conversation rule for a chat file, the owner's oversight included
  await assertMayReadFile({ orgId: actor.orgId, userId: actor.userId, orgRole: actor.role }, fileId);
  const f = await db.storedFile.findFirst({
    where: { id: fileId, orgId: actor.orgId, deletedAt: null },
    select: {
      id: true,
      orgId: true,
      mimeType: true,
      size: true,
      purpose: true,
      chatLinks: { select: { message: { select: { conversationId: true, deletedAt: true } } } },
    },
  });
  if (!f || (f.purpose !== "LIBRARY" && f.purpose !== "CHAT")) throw new NotFoundError("imageOcr.not_found");
  if (f.purpose === "CHAT") {
    const messages = f.chatLinks.flatMap((l) => (l.message ? [l.message] : []));
    // a picture no message has claimed yet is nobody's to read: there is nothing to put its text under
    if (messages.length === 0) throw new NotFoundError("imageOcr.not_found");
    const seen = new Set<string>();
    for (const m of messages) {
      if (seen.has(m.conversationId)) continue;
      seen.add(m.conversationId);
      const facts = await loadConversationFacts(actor.userId, m.conversationId);
      if (facts && (await conversationHasGuest(facts, m.conversationId, actor.orgId))) throw new ForbiddenError("imageOcr.err_guest");
    }
  }
  return { id: f.id, orgId: f.orgId, mimeType: f.mimeType, size: f.size };
}

/** «اقرا النص»: the words of one picture the actor may read. */
export async function readImageText(actor: Actor, fileId: string, options: OcrOptions = {}): Promise<FileTextResult> {
  await assertFeatureOn(actor.orgId, "imageOcr");
  const file = await assertMayReadPicture(actor, fileId);
  const kept = await db.fileText.findUnique({ where: { fileId: file.id }, select: { text: true, createdAt: true, orgId: true } });
  if (kept && kept.orgId === actor.orgId && !options.again) return { text: kept.text, cached: true, at: kept.createdAt.toISOString() };
  const server = ocrServer(options.source);
  if (!server) throw new ImageOcrError("imageOcr.err_not_configured");
  if (!(OCR_TYPES as readonly string[]).includes(file.mimeType)) throw new ImageOcrError("imageOcr.err_type");
  if (file.size > MAX_OCR_BYTES) throw new ImageOcrError("imageOcr.err_big");

  const userKey = `ocr.user.${actor.userId}`;
  const orgKey = `ocr.org.${actor.orgId}`;
  const byUser = ocrUserLimiter.check(userKey);
  if (!byUser.ok) throw new RateLimitedError(byUser.retryAfterSec, "imageOcr.err_rate");
  const byOrg = ocrOrgLimiter.check(orgKey);
  if (!byOrg.ok) throw new RateLimitedError(byOrg.retryAfterSec, "imageOcr.err_rate");
  ocrUserLimiter.hit(userKey);
  ocrOrgLimiter.hit(orgKey);

  const counters: { bytes: number; chars: number; again: boolean } = { bytes: 0, chars: 0, again: options.again === true };
  let outcome = "failed";
  let failure: string | undefined;
  try {
    const opened = await openStored(actor.orgId, file.id);
    if (opened.size > MAX_OCR_BYTES) throw new ImageOcrError("imageOcr.err_big");
    const bytes = await readAll(await opened.stream(null), MAX_OCR_BYTES);
    counters.bytes = bytes.byteLength;
    const mime = sniffImage(bytes);
    if (!mime) throw new ImageOcrError("imageOcr.err_type");
    const text = await ocrBytes(server, { bytes, mime }, { ...(options.transport ? { transport: options.transport } : {}), ...(options.queue ? { queue: options.queue } : {}) });
    if (text === "") {
      outcome = "empty";
      throw new ImageOcrError("imageOcr.err_empty");
    }
    counters.chars = text.length;
    const now = new Date();
    // one row per file: a reading that raced this one is replaced, never doubled
    await db.fileText.upsert({
      where: { fileId: file.id },
      create: { fileId: file.id, orgId: actor.orgId, text, createdAt: now },
      update: { text, orgId: actor.orgId, createdAt: now },
    });
    outcome = "read";
    return { text, cached: false, at: now.toISOString() };
  } catch (err) {
    if (err instanceof ImageOcrError) failure = err.key;
    throw err;
  } finally {
    // counters only: never the picture, the text, the address or the key
    await audit("file.text_read", { actorId: actor.userId, orgId: actor.orgId, target: file.id, meta: { outcome, ...(failure ? { key: failure } : {}), ...counters } }).catch(() => undefined);
  }
}
