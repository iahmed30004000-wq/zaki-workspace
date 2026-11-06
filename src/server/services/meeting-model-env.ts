import { parseLocalBaseUrl } from "@/server/ai/local-host";
import { isValidLocalModelId } from "@/server/ai/provider";
import { validGatewayKeyText } from "@/server/services/gateway-env";

/**
 * «نموذج الاجتماعات» — a FAST model for the meeting assistant only, fixed by VARIABLES of the server (like `gateway-env.ts`).
 *
 *   MEETING_LLM_URL       the full chat endpoint, https with a public name, e.g. `https://api.groq.com/openai/v1/chat/completions`
 *                         or `https://api.cerebras.ai/v1/chat/completions` (any OpenAI-compatible service).
 *   MEETING_LLM_MODEL     the model name that service serves.
 *   MEETING_LLM_API_KEY   the owner's own key, put into the server's variable by HIM; never stored in the database, never shown, never logged.
 *
 * All three must be valid, otherwise the meeting assistant uses the model chosen in «مساعد المالك», exactly as before. When the fast model
 * fails (rate limit, outage, wrong key) the same answer is asked of that model, so the meeting never goes silent for a free tier's limit.
 *
 * ⚠️ PRIVACY: the words said to the assistant (after the usual filter: phones, e-mails, links, secrets masked) go to that service.
 * 🔧 Off = unset the variables. The relaxed filter is never given to it.
 */

export interface MeetingModel {
  /** `https://host` — judged like an outside gateway (a public name, never an inside address; re-resolved on every call). */
  origin: string;
  /** The chat path of that service. */
  path: string;
  model: string;
  key: string;
}

/** The path must be plain: segments of letters, digits, dot, dash, underscore, ending in `/chat/completions`. */
const CHAT_PATH = /^(\/[A-Za-z0-9._-]+)*\/chat\/completions$/;

export function meetingModelEnv(source: Readonly<Record<string, string | undefined>> = process.env): MeetingModel | null {
  const raw = (source["MEETING_LLM_URL"] ?? "").trim();
  const model = (source["MEETING_LLM_MODEL"] ?? "").trim();
  const key = (source["MEETING_LLM_API_KEY"] ?? "").trim();
  if (raw === "" || raw.length > 200 || /[\s\x00-\x1f\x7f\\?#]/.test(raw)) return null;
  if (!isValidLocalModelId(model) || !validGatewayKeyText(key)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (path.includes("..") || path.includes("//") || !CHAT_PATH.test(path)) return null;
  const target = parseLocalBaseUrl(`${url.protocol}//${url.host}`, { external: true });
  if (!target.ok || !target.target.external) return null;
  return { origin: target.target.origin, path, model, key };
}
