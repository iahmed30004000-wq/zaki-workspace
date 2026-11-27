import { VOICE_REASONS, type VoiceAgentState, type VoiceReason, type VoiceRunning } from "@/lib/voice-server";
import { agentSettings, healthHeaders } from "@/server/calls/agent-link";
import { parseLocalBaseUrl } from "@/server/ai/local-host";
import { callLocal, jsonOf, targetOf, type LocalTransport } from "@/server/ai/local-transport";

/**
 * THE VOICE PROGRAM ON THE OWNER'S SERVER as a place for «اكتب النص»: where it is and what it says about itself right now.
 *
 *   WHERE   the two variables the site already has for the meeting assistant (VOICE_AGENT_URL, VOICE_AGENT_SECRET): the owner types nothing. For a
 *           recording the address must be INSIDE the server (the same allow-list as the local model, judged again when the socket connects):
 *           his people's voices never travel to an address on the internet.
 *   STATE   read from `/health` on demand with a short wait; nothing is kept. The answer is taken field by field: a name or a reason this file does
 *           not know is dropped, and no address, secret or raw answer ever reaches a screen.
 */

export const HEALTH_TIMEOUT_MS = 4_000;

export type VoiceAgentTarget = { ok: true; origin: string; secret: string } | { ok: false; state: "not_configured" | "public_address" };

export function voiceAgentTarget(source: Readonly<Record<string, string | undefined>> = process.env): VoiceAgentTarget {
  const settings = agentSettings(source);
  if (!settings) return { ok: false, state: "not_configured" };
  const parsed = parseLocalBaseUrl(settings.url);
  return parsed.ok ? { ok: true, origin: parsed.target.origin, secret: settings.secret } : { ok: false, state: "public_address" };
}

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const modelText = (value: unknown): string => (typeof value === "string" && /^[\w./-]{1,80}$/.test(value) ? value : "");

function cardOf(value: unknown): VoiceRunning["gpu"] {
  const card = record(value);
  if (!card || typeof card["name"] !== "string") return null;
  const name = card["name"].replace(/[^\x20-\x7e]/g, "").trim().slice(0, 80);
  const memory = card["memoryMb"];
  return name ? { name, memoryMb: typeof memory === "number" && Number.isFinite(memory) && memory > 0 ? Math.round(memory) : null } : null;
}

/** What `/health` answered, as one of the card's states. An agent without `stt.door` is one from before voice notes. */
export function parseHealth(value: unknown): VoiceAgentState {
  const body = record(value);
  if (!body || body["ok"] !== true) return { state: "unreachable" };
  const stt = record(body["stt"]);
  if (!stt || typeof stt["door"] !== "number" || stt["door"] < 1) return { state: "old" };
  if (body["secretOk"] === false) return { state: "wrong_secret" };
  const hostedMeetings = stt["meetings"] === "hosted";
  if (stt["ready"] !== true) return { state: "loading", hostedMeetings };
  const reason = stt["reason"];
  return {
    state: stt["device"] === "cuda" ? "gpu" : "cpu",
    model: modelText(stt["model"]),
    compute: modelText(stt["compute"]),
    requested: modelText(stt["requested"]),
    gpuFound: stt["gpuFound"] === true,
    gpu: cardOf(stt["gpu"]),
    reason: (VOICE_REASONS as readonly unknown[]).includes(reason) ? (reason as VoiceReason) : "",
    fallback: stt["fallback"] === true,
    hostedMeetings,
  };
}

/** The program's state right now. Never throws: whatever goes wrong is «unreachable». */
export async function readVoiceAgent(source: Readonly<Record<string, string | undefined>> = process.env, options: { transport?: LocalTransport } = {}): Promise<VoiceAgentState> {
  const target = voiceAgentTarget(source);
  if (!target.ok) return { state: target.state };
  try {
    const res = await callLocal({
      target: targetOf(target.origin),
      method: "GET",
      path: "/health",
      headers: healthHeaders(target.secret),
      timeoutMs: HEALTH_TIMEOUT_MS,
      ...(options.transport ? { transport: options.transport } : {}),
    });
    return parseHealth(jsonOf(res));
  } catch {
    return { state: "unreachable" };
  }
}
