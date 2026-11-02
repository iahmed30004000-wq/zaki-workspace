import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { canReadConversation } from "@/server/policy/conversation";
import { LocalQueue } from "@/server/ai/local-queue";
import { parseLocalBaseUrl } from "@/server/ai/local-host";
import { callLocal, jsonOf, targetOf, type LocalTransport } from "@/server/ai/local-transport";
import { AiProviderError } from "@/server/ai/provider";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { openStored } from "@/server/services/files";
import type { ApiErrorCode } from "@/server/api";

/**
 * «كتابة نص الرسالة الصوتية» — the text of a voice note, written by a speech-to-text service the owner runs on his OWN machine.
 *
 *   WHERE   `TRANSCRIBE_URL` (an origin such as `http://whisper:8000`) in the server's environment, judged by the same allow-list as the
 *           local model (src/server/ai/local-host.ts: his machine or private network only, a public address is refused) and again on
 *           every call; `TRANSCRIBE_MODEL` (default `whisper-1`) and `TRANSCRIBE_LANGUAGE` (default `ar`, empty: let the service guess).
 *           The service speaks the OpenAI shape: POST `/v1/audio/transcriptions`, a multipart form, the answer `{ "text": "…" }`
 *           (faster-whisper-server, whisper.cpp's server and LocalAI all do).
 *   WHO     whoever may read the conversation of the note (the same rule as the bytes of the attachment); the OWNER's silent oversight too.
 *   KEPT    the text is written once into `StoredFile.meta.transcript` of the recording (no new table): asking again is free and never
 *           sends the audio twice. A deleted message's note is gone for everybody but the owner.
 *   SWITCH  `voiceTranscript`, off by default (the audio leaves the app for that service). Off: the route answers «not found».
 *
 * ⚠️ A transcript can be wrong, above all with a noisy recording or a dialect. 🔧 The screen shows it under the note as «نص تقريبي», never in
 * place of the voice. A failure is a dictionary KEY (voiceTranscript.err_*), never the service's answer, its address or the audio.
 */

export const TRANSCRIPT_PATH = "/v1/audio/transcriptions";
/** A voice note is at most 5 minutes (MAX_VOICE_MS); anything far larger than that is not a note. */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
export const MAX_TRANSCRIPT_CHARS = 20_000;
export const TRANSCRIBE_TIMEOUT_MS = 120_000;

export interface TranscribeServer {
  /** `http://whisper:8000`: already judged. */
  origin: string;
  model: string;
  /** null: the service decides the language. */
  language: string | null;
}

/** The speech-to-text service of this installation, or null while it has none (the feature then hides its button). */
export function transcribeServer(source: NodeJS.ProcessEnv = process.env): TranscribeServer | null {
  const url = (source["TRANSCRIBE_URL"] ?? "").trim().replace(/\/+$/, "");
  if (!url) return null;
  const parsed = parseLocalBaseUrl(url);
  if (!parsed.ok) return null;
  const model = (source["TRANSCRIBE_MODEL"] ?? "").trim() || "whisper-1";
  if (!/^[\w./:-]{1,120}$/.test(model)) return null;
  const rawLang = source["TRANSCRIBE_LANGUAGE"];
  const language = rawLang === undefined ? "ar" : rawLang.trim().toLowerCase();
  if (language !== "" && !/^[a-z]{2,3}$/.test(language)) return null;
  return { origin: parsed.target.origin, model, language: language === "" ? null : language };
}

/** Is the button to be drawn for this company: the switch is on AND a service is set up. */
export async function transcriptAvailable(orgId: string, source: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return transcribeServer(source) !== null && (await isFeatureOn(orgId, "voiceTranscript"));
}

export class VoiceTranscriptError extends Error {
  constructor(
    readonly key: string,
    readonly code: ApiErrorCode = "conflict",
  ) {
    super(key);
    this.name = "VoiceTranscriptError";
  }
}

const EXTENSION: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" };

/** The multipart form of one request: the text fields, then the recording. Pure, so a test can read it back. */
export function multipartBody(fields: Record<string, string>, file: { bytes: Uint8Array; mime: string }, boundary: string): { bytes: Uint8Array; contentType: string } {
  const enc = new TextEncoder();
  const mime = file.mime.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
  const ext = EXTENSION[mime] ?? "bin";
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(enc.encode(`--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(enc.encode(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="voice.${ext}"\r\ncontent-type: ${mime}\r\n\r\n`));
  parts.push(file.bytes);
  parts.push(enc.encode(`\r\n--${boundary}--\r\n`));
  const size = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return { bytes: out, contentType: `multipart/form-data; boundary=${boundary}` };
}

const failureKey = (err: unknown): string => {
  if (!(err instanceof AiProviderError)) return "voiceTranscript.err_failed";
  if (err.key === "assistant.err_local_timeout") return "voiceTranscript.err_timeout";
  if (err.key === "assistant.err_local_busy") return "voiceTranscript.err_busy";
  if (err.key === "assistant.err_local_down" || err.key === "assistant.err_local_host") return "voiceTranscript.err_down";
  return "voiceTranscript.err_failed";
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
      throw new VoiceTranscriptError("voiceTranscript.err_big");
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

/** Transcriptions wait for each other (a small machine does one at a time); a fourth in line is told «busy». */
const transcribeQueue = new LocalQueue(3, 120_000);

/** One recording to the service, one text back. Everything bounded: a timeout, the size of the audio, the length of the text. */
export async function transcribeBytes(
  server: TranscribeServer,
  audio: { bytes: Uint8Array; mime: string },
  options: { transport?: LocalTransport; queue?: LocalQueue; boundary?: string } = {},
): Promise<string> {
  const form = multipartBody(
    { model: server.model, response_format: "json", ...(server.language ? { language: server.language } : {}) },
    audio,
    options.boundary ?? `zk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
  );
  try {
    const target = targetOf(server.origin);
    const run = () => callLocal({ target, method: "POST", path: TRANSCRIPT_PATH, raw: form, timeoutMs: TRANSCRIBE_TIMEOUT_MS, ...(options.transport ? { transport: options.transport } : {}) });
    const res = await (options.queue ?? transcribeQueue).run(run);
    const json = jsonOf(res) as { text?: unknown } | null;
    return json && typeof json.text === "string" ? json.text.trim().slice(0, MAX_TRANSCRIPT_CHARS) : "";
  } catch (err) {
    if (err instanceof VoiceTranscriptError) throw err;
    throw new VoiceTranscriptError(failureKey(err));
  }
}

type StoredTranscript = { text: string; at: string };

function transcriptOf(meta: unknown): StoredTranscript | null {
  if (!meta || typeof meta !== "object") return null;
  const t = (meta as { transcript?: unknown }).transcript;
  if (!t || typeof t !== "object") return null;
  const { text, at } = t as { text?: unknown; at?: unknown };
  return typeof text === "string" && text !== "" ? { text, at: typeof at === "string" ? at : "" } : null;
}

export interface TranscriptResult {
  text: string;
  /** The text was already written (the audio was not sent again). */
  cached: boolean;
}

/** «اكتب النص»: the text of one voice note of a message the actor may read. */
export async function transcribeAttachment(
  actor: Actor,
  attachmentId: string,
  options: { source?: NodeJS.ProcessEnv; transport?: LocalTransport; queue?: LocalQueue } = {},
): Promise<TranscriptResult> {
  await assertFeatureOn(actor.orgId, "voiceTranscript");
  const att = await db.messageAttachment.findFirst({
    where: { id: attachmentId, messageId: { not: null }, file: { orgId: actor.orgId, deletedAt: null, purpose: "VOICE" } },
    select: { file: { select: { id: true, mimeType: true, meta: true } }, message: { select: { conversationId: true, deletedAt: true } } },
  });
  if (!att || !att.message) throw new NotFoundError("voiceTranscript.not_found");
  if (!(await canReadConversation(actor.userId, att.message.conversationId))) throw new NotFoundError("voiceTranscript.not_found");
  if (att.message.deletedAt && !actor.isOwner) throw new NotFoundError("voiceTranscript.not_found");
  const kept = transcriptOf(att.file.meta);
  if (kept) return { text: kept.text, cached: true };
  const server = transcribeServer(options.source);
  if (!server) throw new VoiceTranscriptError("voiceTranscript.err_not_configured");
  const opened = await openStored(actor.orgId, att.file.id);
  if (opened.size > MAX_TRANSCRIBE_BYTES) throw new VoiceTranscriptError("voiceTranscript.err_big");
  const bytes = await readAll(await opened.stream(null), MAX_TRANSCRIBE_BYTES);
  const text = await transcribeBytes(server, { bytes, mime: att.file.mimeType }, { ...(options.transport ? { transport: options.transport } : {}), ...(options.queue ? { queue: options.queue } : {}) });
  if (text === "") throw new VoiceTranscriptError("voiceTranscript.err_empty");
  // written once: a second request that raced this one keeps the first text
  const fresh = await db.storedFile.findUnique({ where: { id: att.file.id }, select: { meta: true } });
  const already = transcriptOf(fresh?.meta);
  if (already) return { text: already.text, cached: true };
  const base = fresh?.meta && typeof fresh.meta === "object" && !Array.isArray(fresh.meta) ? (fresh.meta as Record<string, unknown>) : {};
  await db.storedFile.update({ where: { id: att.file.id }, data: { meta: { ...base, transcript: { text, at: new Date().toISOString() } } } });
  return { text, cached: false };
}
