import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { canPostInConversation, canReadConversation } from "@/server/policy/conversation";
import { FixedWindowLimiter, RateLimitedError, type LimiterOptions } from "@/server/rate-limit";
import { CHAT_LIMITS } from "@/server/files/sniff";
import { LocalQueue } from "@/server/ai/local-queue";
import { parseLocalBaseUrl } from "@/server/ai/local-host";
import { callLocal, jsonOf, targetOf, type LocalTransport } from "@/server/ai/local-transport";
import { AiProviderError } from "@/server/ai/provider";
import { redactText } from "@/server/ai/redact";
import { judgeGatewayAddress } from "@/server/services/gateway-address";
import { getSettings, readGatewayKey } from "@/server/services/owner-assistant-settings";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { noteHeaders } from "@/server/calls/agent-link";
import { readVoiceAgent, voiceAgentTarget } from "@/server/services/voice-server";
import type { VoiceServerStatus } from "@/lib/voice-server";
import { openStored } from "@/server/services/files";
import type { ApiErrorCode } from "@/server/api";

/**
 * «كتابة نص الرسالة الصوتية» — the text of a voice note, written by a speech-to-text service the owner runs on his OWN machine.
 *
 *   WHERE   chosen on the owner's AI settings screen («تفريغ الصوت»): the voice program on his server (`agent`: the address and secret the site already has
 *           for the meeting assistant, the signed door POST `/transcribe-note` of voice-agent/notes.py; the owner types nothing), a service inside the
 *           server (`transcribeBaseUrl`) or the OpenAI-compatible gateway of the assistant (its address and key); when nothing is chosen there,
 *           `TRANSCRIBE_URL` (an origin such as `http://whisper:8000`) in the server's environment as before, judged by the same allow-list as the
 *           local model (src/server/ai/local-host.ts: his machine or private network only, a public address is refused) and again on
 *           every call; `TRANSCRIBE_MODEL` (default `whisper-1`) and `TRANSCRIBE_LANGUAGE` (default `ar`, empty: let the service guess).
 *           The service speaks the OpenAI shape: POST `/v1/audio/transcriptions`, a multipart form, the answer `{ "text": "…" }`
 *           (faster-whisper-server, whisper.cpp's server and LocalAI all do).
 *   WHO     whoever may read the conversation of the note (the same rule as the bytes of the attachment); the OWNER's silent oversight too.
 *   KEPT    the text is written once into `StoredFile.meta.transcript` of the recording (no new table): asking again is free and never
 *           sends the audio twice. A deleted message's note is gone for everybody but the owner.
 *   BEFORE SENDING (`tgPhone`, the preview of a recording)  `transcribeTake`: the take that is still on the person's device goes to the same service,
 *           with the same filter, through the conversation it is recorded in (whoever may read it AND post in it), rate limited per person; neither the
 *           audio nor the words are kept.
 *   SWITCH  `voiceTranscript`, off by default (the audio leaves the app for that service). Off: the route answers «not found».
 *
 * ⚠️ A transcript can be wrong, above all with a noisy recording or a dialect. 🔧 The screen shows it under the note as «نص تقريبي», never in
 * place of the voice. A failure is a dictionary KEY (voiceTranscript.err_*), never the service's answer, its address or the audio.
 */

export const TRANSCRIPT_PATH = "/v1/audio/transcriptions";
/** The voice program's own door (not the OpenAI shape: the body is the recording itself, signed). */
export const AGENT_NOTE_PATH = "/transcribe-note";
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
  /** The gateway's Bearer key, sent in one header to the judged origin only. */
  bearer?: string;
  /** An outside https gateway the owner allowed: the socket accepts public addresses only. */
  external?: boolean;
  /** The text goes through the assistant's privacy filter before it is kept (a gateway that is not confirmed local). */
  filter?: boolean;
  /** The service is the voice program on this server: its signed door, with the shared secret (it chooses its own model). */
  agent?: { secret: string };
}

/** The speech-to-text service of this installation, or null while it has none (the feature then hides its button). */
export function transcribeServer(source: Readonly<Record<string, string | undefined>> = process.env): TranscribeServer | null {
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

/**
 * The service of THIS company: the one chosen on the AI settings screen («خدمة محلية» or the assistant's gateway), else the server's variable (`transcribeServer`), else
 * none. A gateway that is not confirmed local, or that sits at an outside address, is an EXTERNAL service: its text is filtered (`filter`) like the assistant's.
 */
export async function resolveTranscribeServer(orgId: string, source: Readonly<Record<string, string | undefined>> = process.env): Promise<TranscribeServer | null> {
  const settings = await getSettings(orgId);
  const language = (() => {
    const raw = source["TRANSCRIBE_LANGUAGE"];
    const value = raw === undefined ? "ar" : raw.trim().toLowerCase();
    return value === "" ? null : /^[a-z]{2,3}$/.test(value) ? value : "ar";
  })();
  const model = (settings.transcribeModel ?? "").trim() || "whisper-1";
  if (settings.transcribeSource === "agent") {
    const target = voiceAgentTarget(source);
    return target.ok ? { origin: target.origin, model: "", language, agent: { secret: target.secret } } : null;
  }
  if (settings.transcribeSource === "local") {
    const parsed = parseLocalBaseUrl(settings.transcribeBaseUrl);
    return parsed.ok ? { origin: parsed.target.origin, model, language } : null;
  }
  if (settings.transcribeSource === "gateway") {
    const address = await judgeGatewayAddress(orgId, settings.gatewayBaseUrl);
    if (!address.ok) return null;
    const bearer = settings.hasGatewayKey ? await readGatewayKey(orgId) : null;
    const local = settings.gatewayConfirmedLocal && !address.external;
    return { origin: address.target.origin, model, language, ...(bearer ? { bearer } : {}), ...(address.external ? { external: true } : {}), filter: !local };
  }
  return transcribeServer(source);
}

/** Is the button to be drawn for this company: the switch is on AND a service is set up. */
export async function transcriptAvailable(orgId: string, source: Readonly<Record<string, string | undefined>> = process.env): Promise<boolean> {
  return (await isFeatureOn(orgId, "voiceTranscript")) && (await resolveTranscribeServer(orgId, source)) !== null;
}

/** What the owner's card shows: the program's state right now, the choice, and what the chat does with them. */
export async function voiceServerStatus(orgId: string, source: Readonly<Record<string, string | undefined>> = process.env): Promise<VoiceServerStatus> {
  const [agent, settings, transcriptOn, server] = await Promise.all([readVoiceAgent(source), getSettings(orgId), isFeatureOn(orgId, "voiceTranscript"), resolveTranscribeServer(orgId, source)]);
  return { agent, source: settings.transcribeSource, transcriptOn, serviceReady: server !== null };
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
  // what is sent is built when its turn comes: the program's signature lives one minute, and the wait in line may be longer
  const request = (): { path: string; raw: { bytes: Uint8Array; contentType: string }; headers?: Record<string, string> } => {
    if (server.agent) return { path: AGENT_NOTE_PATH, raw: { bytes: audio.bytes, contentType: "application/octet-stream" }, headers: noteHeaders(server.agent.secret, audio.bytes, server.language) };
    const raw = multipartBody(
      { model: server.model, response_format: "json", ...(server.language ? { language: server.language } : {}) },
      audio,
      options.boundary ?? `zk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    );
    return { path: TRANSCRIPT_PATH, raw, ...(server.bearer ? { headers: { authorization: `Bearer ${server.bearer}` } } : {}) };
  };
  try {
    const target = targetOf(server.origin, server.external === true);
    const run = () => callLocal({ target, method: "POST", ...request(), timeoutMs: TRANSCRIBE_TIMEOUT_MS, ...(options.transport ? { transport: options.transport } : {}) });
    const res = await (options.queue ?? transcribeQueue).run(run);
    // the program's «too large» and «too long»
    if (server.agent && (res.status === 413 || res.status === 422)) throw new VoiceTranscriptError("voiceTranscript.err_big");
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
  options: { source?: Readonly<Record<string, string | undefined>>; transport?: LocalTransport; queue?: LocalQueue } = {},
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
  const server = await resolveTranscribeServer(actor.orgId, options.source);
  if (!server) throw new VoiceTranscriptError("voiceTranscript.err_not_configured");
  const opened = await openStored(actor.orgId, att.file.id);
  if (opened.size > MAX_TRANSCRIBE_BYTES) throw new VoiceTranscriptError("voiceTranscript.err_big");
  const bytes = await readAll(await opened.stream(null), MAX_TRANSCRIBE_BYTES);
  const heard = await transcribeBytes(server, { bytes, mime: att.file.mimeType }, { ...(options.transport ? { transport: options.transport } : {}), ...(options.queue ? { queue: options.queue } : {}) });
  // a service that may be outside the owner's machine: the same filter as the assistant (numbers, e-mails, links, handles) before the words are kept
  const text = server.filter && heard !== "" ? redactText(heard).text : heard;
  if (text === "") throw new VoiceTranscriptError("voiceTranscript.err_empty");
  // written once: a second request that raced this one keeps the first text
  const fresh = await db.storedFile.findUnique({ where: { id: att.file.id }, select: { meta: true } });
  const already = transcriptOf(fresh?.meta);
  if (already) return { text: already.text, cached: true };
  const base = fresh?.meta && typeof fresh.meta === "object" && !Array.isArray(fresh.meta) ? (fresh.meta as Record<string, unknown>) : {};
  await db.storedFile.update({ where: { id: att.file.id }, data: { meta: { ...base, transcript: { text, at: new Date().toISOString() } } } });
  return { text, cached: false };
}

// ───────────────────────────── a recording that was not sent yet (the preview) ─────────────────────────────

/** A take weighs at most what a voice note may weigh when it is sent. */
export const MAX_TAKE_BYTES = CHAT_LIMITS.VOICE;
/** One person: this many previews in this long (a pause, listen, go on, pause again costs one each time). */
export const TAKE_LIMIT: LimiterOptions = { limit: 20, windowMs: 10 * 60_000 };
/** …and this many in the air at once (one left behind by «متابعة التسجيل», and the new one). */
export const TAKES_AT_ONCE = 2;

/** The gate in front of the previews, per person. `enter` answers the way out, or refuses. */
export function createTakeGuard(limit: LimiterOptions = TAKE_LIMIT, atOnce: number = TAKES_AT_ONCE) {
  const limiter = new FixedWindowLimiter(limit);
  const running = new Map<string, number>();
  return {
    enter(userId: string): () => void {
      const state = limiter.check(userId);
      if (!state.ok) throw new RateLimitedError(state.retryAfterSec, "tgvoice.err_rate");
      const now = running.get(userId) ?? 0;
      if (now >= atOnce) throw new VoiceTranscriptError("voiceTranscript.err_busy");
      limiter.hit(userId);
      running.set(userId, now + 1);
      let left = false;
      return () => {
        if (left) return;
        left = true;
        const held = (running.get(userId) ?? 1) - 1;
        if (held > 0) running.set(userId, held);
        else running.delete(userId);
      };
    },
  };
}

export const takeGuard = createTakeGuard();

/**
 * May this person have the words of a recording made in this conversation? The two switches (the transcript's and the voice notes'), a conversation of THIS
 * company, the right to read it (as for a sent note), and the right to post in it (a recording exists only where one may send it).
 */
export async function authorizeTakeTranscript(actor: Actor, conversationId: string): Promise<void> {
  await assertFeatureOn(actor.orgId, "voiceTranscript");
  await assertFeatureOn(actor.orgId, "voiceNotes");
  const here = await db.conversation.findFirst({ where: { id: conversationId, orgId: actor.orgId }, select: { id: true } });
  if (!here || !(await canReadConversation(actor.userId, conversationId))) throw new NotFoundError("voiceTranscript.not_found");
  if (!(await canPostInConversation(actor.userId, conversationId))) throw new ForbiddenError("chat.e.post_denied");
}

/** The person's language for this take: a short code, «auto» (the service guesses), and anything else leaves the service's own. */
export function takeLanguageOf(raw: unknown, own: string | null): string | null {
  if (raw === "auto") return null;
  return typeof raw === "string" && /^[a-z]{2,3}$/.test(raw) ? raw : own;
}

/** The words of a take (already authorized by `authorizeTakeTranscript`). Nothing is stored. */
export async function transcribeTake(
  actor: Actor,
  audio: { bytes: Uint8Array; mime: string },
  language: unknown,
  options: { source?: Readonly<Record<string, string | undefined>>; transport?: LocalTransport; queue?: LocalQueue } = {},
): Promise<{ text: string }> {
  const server = await resolveTranscribeServer(actor.orgId, options.source);
  if (!server) throw new VoiceTranscriptError("voiceTranscript.err_not_configured");
  if (audio.bytes.byteLength > MAX_TAKE_BYTES) throw new VoiceTranscriptError("voiceTranscript.err_big");
  const heard = await transcribeBytes({ ...server, language: takeLanguageOf(language, server.language) }, audio, { ...(options.transport ? { transport: options.transport } : {}), ...(options.queue ? { queue: options.queue } : {}) });
  // the same filter as a sent note's words
  const text = server.filter && heard !== "" ? redactText(heard).text : heard;
  if (text === "") throw new VoiceTranscriptError("voiceTranscript.err_empty");
  return { text };
}
