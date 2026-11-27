import type { AttachmentDto, MessageDto } from "@/server/chat/dto";
import { AR } from "@/lib/i18n/dict";

/**
 * «صور متحركة» — the pure words of the GIF library: its limits, the shapes of its answers, what counts as a GIF, and the calls the screens make. No React, no server import.
 * The rules of WHO may see or send a kept GIF are the server's alone (`src/server/chat/gifs.ts`); nothing here asks anybody outside the app.
 */

/** The only kind the library holds. */
export const GIF_MIME = "image/gif";
/** One uploaded GIF: at most 10 MB. */
export const GIF_MAX_BYTES = 10 * 1024 * 1024;
/** The most GIFs one person keeps in one company. */
export const GIF_MAX_SAVED = 200;
/** How many recently sent ones are offered. */
export const GIF_RECENT = 24;

export interface GifDto {
  /** a kept one: the library row's id */
  savedId?: string;
  /** a recently sent one: the attachment of the message that carries it */
  attachmentId?: string;
  name: string;
  /** an address of this app that judges the reader again on every request */
  url: string;
  width?: number;
  height?: number;
  /** a recently sent one that is already kept */
  kept?: boolean;
}

export interface GifListDto {
  saved: GifDto[];
  recent: GifDto[];
}

/** A GIF the chat can keep: a picture attachment whose SNIFFED type (the server's) is a GIF. */
export function isGifAttachment(file: Pick<AttachmentDto, "kind" | "mime">): boolean {
  return file.kind === "IMAGE" && file.mime === GIF_MIME;
}

/** The query the picker reads, and what a save or a removal puts out of date. */
export const GIFS_KEY = ["chat-gifs"] as const;

/** A refusal with the server's dictionary key (or the screen's fallback). */
export class GifError extends Error {
  constructor(readonly key: string) {
    super(key);
    this.name = "GifError";
  }
}

type Fetch = typeof fetch;

/** The server's own sentence where the dictionary has one (a validation answer carries it in its details), else the screen's: a raw key is never shown. */
async function refusalOf(res: Response, fallback: string): Promise<GifError> {
  const body = (await res.json().catch(() => null)) as { message?: unknown; details?: unknown } | null;
  const details = Array.isArray(body?.details) ? (body.details as Array<{ message?: unknown } | null>).map((d) => d?.message) : [];
  const key = [...details, body?.message].find((v): v is string => typeof v === "string" && v !== "validation.failed" && AR[v] !== undefined);
  return new GifError(key ?? fallback);
}

export async function fetchGifs(signal?: AbortSignal, fetchImpl: Fetch = fetch): Promise<GifListDto> {
  const res = await fetchImpl("/api/chat/gifs", { cache: "no-store", credentials: "same-origin", signal });
  if (!res.ok) throw await refusalOf(res, "gifs.load_failed");
  return (await res.json()) as GifListDto;
}

/** «احفظ بالصور المتحركة»: keep the GIF a message carries. */
export async function keepGif(attachmentId: string, fetchImpl: Fetch = fetch): Promise<void> {
  const res = await fetchImpl("/api/chat/gifs", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ attachmentId }) });
  if (!res.ok) throw await refusalOf(res, "gifs.save_failed");
}

export async function uploadGif(file: File, fetchImpl: Fetch = fetch): Promise<void> {
  if (file.size > GIF_MAX_BYTES) throw new GifError("gifs.e.too_large");
  const form = new FormData();
  form.append("file", file);
  const res = await fetchImpl("/api/chat/gifs/upload", { method: "POST", body: form, credentials: "same-origin" });
  if (!res.ok) throw await refusalOf(res, "gifs.upload_failed");
}

export async function dropGif(savedId: string, fetchImpl: Fetch = fetch): Promise<void> {
  const res = await fetchImpl(`/api/chat/gifs/${encodeURIComponent(savedId)}`, { method: "DELETE", credentials: "same-origin" });
  if (!res.ok) throw await refusalOf(res, "gifs.remove_failed");
}

export interface GifSendInput {
  conversationId: string;
  gif: Pick<GifDto, "savedId" | "attachmentId">;
  clientId: string;
  replyToId?: string;
  /** «رد بالاقتباس»: the piece of the answered message the person picked (the server keeps it only when that message holds it) */
  replyQuote?: string;
}

export function gifSendBody(input: GifSendInput): Record<string, string> {
  return {
    conversationId: input.conversationId,
    clientId: input.clientId,
    ...(input.gif.savedId ? { savedId: input.gif.savedId } : { attachmentId: input.gif.attachmentId ?? "" }),
    ...(input.replyToId ? { replyToId: input.replyToId, ...(input.replyQuote ? { replyQuote: input.replyQuote } : {}) } : {}),
  };
}

/** One tap sends it: the server finds the file itself (the page never names a file) and answers with the new message. */
export async function sendGif(input: GifSendInput, fetchImpl: Fetch = fetch): Promise<MessageDto> {
  const res = await fetchImpl("/api/chat/gifs/send", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(gifSendBody(input)) });
  if (!res.ok) throw await refusalOf(res, "gifs.send_failed");
  return (await res.json()) as MessageDto;
}
