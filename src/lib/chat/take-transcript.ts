import { AR } from "@/lib/i18n/dict";
import type { VoiceTake } from "@/lib/chat/voice-recorder";

/**
 * The words of a recording that was NOT sent yet (the preview of `tgPhone`): the take goes to the company's own transcription service through this
 * conversation's door (`POST /api/chat/conversations/[id]/transcribe`, the same switch, rules and filter as «اكتب النص»), and the words come back. Nothing
 * of it is stored. A failure is a key of the dictionary, never the server's or the service's words. Client side.
 */
export type TakeTranscript = { ok: true; text: string } | { ok: false; key: string };

export const takeTranscribeUrl = (conversationId: string): string => `/api/chat/conversations/${encodeURIComponent(conversationId)}/transcribe`;

const fileNameOf = (mime: string): string => `voice.${mime === "audio/mp4" ? "m4a" : mime === "audio/ogg" ? "ogg" : "webm"}`;

function keyOf(status: number, message: unknown): string {
  if (status === 404 || message === "voiceTranscript.err_not_configured") return "tgvoice.transcript_off";
  if (message === "voiceTranscript.err_empty") return "tgvoice.transcript_none";
  if (typeof message === "string" && (message.startsWith("voiceTranscript.") || message.startsWith("tgvoice.")) && AR[message]) return message;
  return "voiceTranscript.err_failed";
}

export async function requestTakeTranscript(conversationId: string, take: VoiceTake, language: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<TakeTranscript> {
  const form = new FormData();
  form.append("language", language);
  form.append("file", new File([take.blob], fileNameOf(take.mime), { type: take.mime }));
  try {
    const res = await fetchImpl(takeTranscribeUrl(conversationId), { method: "POST", body: form, ...(signal ? { signal } : {}) });
    const body = (await res.json().catch(() => null)) as { text?: unknown; message?: unknown } | null;
    if (res.ok && body && typeof body.text === "string") return body.text.trim() ? { ok: true, text: body.text } : { ok: false, key: "tgvoice.transcript_none" };
    return { ok: false, key: keyOf(res.status, body?.message) };
  } catch {
    return { ok: false, key: "voiceTranscript.err_failed" };
  }
}
