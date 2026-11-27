/**
 * «تحويل الصوت لنص على السيرفر» — what the owner's card knows about the voice program on his server, and the rules it draws by. Pure: the server
 * fills these (src/server/services/voice-server.ts reads the program's /health), the card draws them.
 */

export const VOICE_REASONS = ["forced_cpu", "no_gpu", "gpu_driver", "gpu_libs", "gpu_memory", "gpu_compute", "gpu_failed", "gpu_runtime"] as const;
/** Why it is not on the card (or not with the model asked for); "": nothing to explain. */
export type VoiceReason = (typeof VOICE_REASONS)[number] | "";

/** The states in which there is nothing to talk to: each has its own ⚠️ and 🔧 sentence. */
export type VoiceTrouble = "not_configured" | "public_address" | "unreachable" | "old" | "wrong_secret";

export interface VoiceRunning {
  state: "cpu" | "gpu";
  /** The model in use, and the one the card was asked for. "": the program said something unreadable. */
  model: string;
  compute: string;
  requested: string;
  gpuFound: boolean;
  gpu: { name: string; memoryMb: number | null } | null;
  reason: VoiceReason;
  /** The card runs a smaller model than asked. */
  fallback: boolean;
  /** The program is set to send MEETING sentences to an outside recogniser (voice notes never go there). */
  hostedMeetings: boolean;
}

export type VoiceAgentState = { state: VoiceTrouble } | { state: "loading"; hostedMeetings: boolean } | VoiceRunning;

export interface VoiceServerStatus {
  agent: VoiceAgentState;
  /** The transcription source chosen on the settings screen ("agent": this program). */
  source: "local" | "gateway" | "agent" | null;
  /** The company's switch «كتابة نص الرسالة الصوتية». */
  transcriptOn: boolean;
  /** A transcription service resolves (whichever source): with the switch on, the chat draws «اكتب النص». */
  serviceReady: boolean;
}

/** The program answers, has the door for voice notes and knows our secret: it may be chosen, on the processor too. */
export const canChooseVoiceServer = (agent: VoiceAgentState): boolean => agent.state === "cpu" || agent.state === "gpu" || agent.state === "loading";

export type TranscriptButtonReason = "shown" | "switch_off" | "no_source" | "source_broken";

/** Why «اكتب النص» is or is not in the chat. */
export function transcriptButtonReason(status: Pick<VoiceServerStatus, "transcriptOn" | "serviceReady" | "source">): TranscriptButtonReason {
  if (!status.transcriptOn) return "switch_off";
  if (status.serviceReady) return "shown";
  return status.source === null ? "no_source" : "source_broken";
}

export const cpuHelpKey = (reason: VoiceReason): string => `gpuVoice.reason.${reason || "unknown"}`;

/** The reasons the three server steps (driver, card compose file, redeploy) can fix. */
export const needsCardSteps = (reason: VoiceReason): boolean => reason === "" || reason === "no_gpu" || reason === "gpu_driver" || reason === "gpu_libs";

const KNOWN_MODEL_NAMES = ["large-v3", "large-v2", "medium", "small", "base", "tiny"];

export const modelNameKey = (model: string): string => `gpuVoice.model.${KNOWN_MODEL_NAMES.includes(model) ? model : "other"}`;

/** Names the person has to find outside this app: shown as they are written there, never translated. */
export const GPU_COMPOSE_FILE = "docker-compose.gpu.yml";
export const DEVICE_SETTING_AUTO = "STT_DEVICE=auto";
export const HOSTED_SETTING_LOCAL = "STT_ENGINE=local";
