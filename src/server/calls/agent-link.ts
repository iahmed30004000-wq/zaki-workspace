import { createHash } from "node:crypto";
import { hmacHex, safeEqual } from "@/server/crypto";

/**
 * HOW THE SITE AND THE VOICE AGENT (voice-agent/) TRUST EACH OTHER — one scheme, one place. Nothing here reads the database, so both the meeting
 * assistant (assistant-agent.ts) and «اكتب النص» (services/voice-transcript.ts) use it.
 *
 *   every signed request carries `x-agent-timestamp` (unix seconds) and `x-agent-signature` = HMAC-SHA256(secret, "<timestamp>.<signed text>"),
 *   checked in constant time and valid for one minute. The signed text is the JSON body (join, leave, turn, transcript), or:
 *     a voice note     `transcribe:<sha256 of the audio>:<language or empty>`   (the body is the audio itself, its hash also in a header)
 *     a look at health `health`
 *   Neither of those two is JSON, so a signature of one door opens no other. The agent's side: voice-agent/logic.py and notes.py.
 */

export interface AgentSettings {
  url: string;
  secret: string;
}

/** Where the voice agent listens and its shared secret, or null while Coolify has none (the button says so). */
export function agentSettings(source: Readonly<Record<string, string | undefined>> = process.env): AgentSettings | null {
  const url = (source["VOICE_AGENT_URL"] ?? "").trim().replace(/\/+$/, "");
  const secret = (source["VOICE_AGENT_SECRET"] ?? "").trim();
  if (!url || secret.length < 16 || !/^https?:\/\//.test(url)) return null;
  return { url, secret };
}

/** A request's signature: HMAC-SHA256 over `<unix seconds>.<body>`. */
export function signBody(secret: string, timestamp: number, body: string): string {
  return hmacHex(secret, `${timestamp}.${body}`);
}

export const SIGNATURE_MAX_AGE_SECONDS = 60;

/** Does this request come from the voice agent? Constant-time, and refuses an old or future timestamp. */
export function verifySignature(secret: string, timestampHeader: string | null, signatureHeader: string | null, body: string, nowMs: number = Date.now()): boolean {
  if (!timestampHeader || !signatureHeader || !/^\d{9,12}$/.test(timestampHeader)) return false;
  const ts = Number(timestampHeader);
  if (Math.abs(nowMs / 1000 - ts) > SIGNATURE_MAX_AGE_SECONDS) return false;
  return safeEqual(signBody(secret, ts, body), signatureHeader);
}

export const HEALTH_SIGNED_TEXT = "health";

export const noteSignedText = (sha256Hex: string, language: string | null): string => `transcribe:${sha256Hex}:${language ?? ""}`;

function signedHeaders(secret: string, text: string, nowMs: number): Record<string, string> {
  const ts = Math.floor(nowMs / 1000);
  return { "x-agent-timestamp": String(ts), "x-agent-signature": signBody(secret, ts, text) };
}

/** The headers of a signed look at `/health` (the answer then says whether the two secrets match). */
export const healthHeaders = (secret: string, nowMs: number = Date.now()): Record<string, string> => signedHeaders(secret, HEALTH_SIGNED_TEXT, nowMs);

/** The headers of one voice note sent to `/transcribe-note`. Made when it is SENT: a signature lives one minute. */
export function noteHeaders(secret: string, audio: Uint8Array, language: string | null, nowMs: number = Date.now()): Record<string, string> {
  const sha = createHash("sha256").update(audio).digest("hex");
  return { ...signedHeaders(secret, noteSignedText(sha, language), nowMs), "x-agent-audio-sha256": sha, "x-agent-language": language ?? "" };
}
