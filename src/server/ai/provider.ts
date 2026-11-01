/**
 * «مساعد المالك» — THE MODEL PROVIDER: one small interface and ONE implementation (Anthropic's Messages API over `fetch`, no SDK).
 *
 * Rules this file keeps:
 *  - The address is a CONSTANT. Nothing the owner or anybody else types ever becomes part of the URL (no SSRF), and a redirect is
 *    refused (`redirect: "error"`), so the key is only ever sent to that one host.
 *  - The owner's key travels in ONE header (`x-api-key`) and nowhere else. It is never put in a thrown error, a log line or a
 *    message: an error carries a dictionary KEY (`assistant.err_*`) and nothing from the network answer, not even its body.
 *  - A call is bounded: 60 seconds (AbortController), and a 429 / 529 is retried ONCE after a short wait; nothing else is retried.
 *  - Nothing here reads the database or the environment: the caller hands over the key and the model id. Tests inject a fake
 *    provider (`registry.ts`) or a fake `fetch`; no test ever touches the network.
 */

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const REQUEST_TIMEOUT_MS = 60_000;
/** The longest wait before the one retry (a `retry-after` above it is cut to it). */
export const MAX_RETRY_WAIT_MS = 3_000;

/** The ids the settings screen offers (a free-text id is also accepted: see `isValidModelId`). */
export const KNOWN_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] as const;
export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** A model id is a short token of letters, digits, dots, dashes, underscores and colons: it goes into the JSON body, never the URL. */
export function isValidModelId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/.test(id);
}

/**
 * A LOCAL model's name (Ollama): the same token, plus «/» for a registry path (`hf.co/user/model:Q4_K_M`). It goes into the JSON body of
 * a POST and never into a URL; «..», a leading dot or slash and an empty segment are refused anyway.
 */
export function isValidLocalModelId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$/.test(id) && !id.includes("..") && !id.includes("//") && !id.endsWith("/");
}

export type AiRole = "user" | "assistant";

export interface AiChatMessage {
  role: AiRole;
  content: string;
}

export interface AiTool {
  name: string;
  description: string;
  /** A JSON schema of the tool's input. */
  inputSchema: Record<string, unknown>;
}

export interface AiToolCall {
  name: string;
  input: unknown;
}

export interface AiCompletion {
  text: string;
  toolCalls: AiToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface AiRequest {
  system: string;
  messages: AiChatMessage[];
  tools?: AiTool[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface AiProvider {
  complete(request: AiRequest): Promise<AiCompletion>;
}

/** The refusals of the provider, as dictionary keys (every one has its Arabic sentence in `ar.owner-assistant.json`). */
export type AiErrorKey =
  | "assistant.err_key_rejected"
  | "assistant.err_request"
  | "assistant.err_rate_limited"
  | "assistant.err_overloaded"
  | "assistant.err_server"
  | "assistant.err_timeout"
  | "assistant.err_network"
  | "assistant.err_aborted"
  | "assistant.err_bad_answer"
  // the local model (src/server/ai/local-provider.ts)
  | "assistant.err_local_busy"
  | "assistant.err_local_down"
  | "assistant.err_local_missing"
  | "assistant.err_local_timeout"
  | "assistant.err_local_host";

export class AiProviderError extends Error {
  constructor(readonly key: AiErrorKey) {
    super(key);
    this.name = "AiProviderError";
  }
}

/** The HTTP status of the provider's answer as a refusal key; the body is never read. */
export function errorKeyForStatus(status: number): AiErrorKey {
  if (status === 401 || status === 403) return "assistant.err_key_rejected";
  if (status === 429) return "assistant.err_rate_limited";
  if (status === 529 || status === 503) return "assistant.err_overloaded";
  if (status === 408 || status === 504) return "assistant.err_timeout";
  if (status >= 500) return "assistant.err_server";
  return "assistant.err_request";
}

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  /** Tests: a fake `fetch`. Default: the global one, looked up at call time. */
  fetch?: typeof fetch;
  /** Tests: no real waiting between the two attempts. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryWaitMs(retryAfter: string | null): number {
  const header = Number(retryAfter);
  const wanted = Number.isFinite(header) && header > 0 ? header * 1000 : 1000;
  return Math.min(wanted, MAX_RETRY_WAIT_MS);
}

/** The request body for the Messages API: exactly what is sent, so a test can read it. */
export function buildAnthropicBody(model: string, request: AiRequest): Record<string, unknown> {
  return {
    model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(request.tools && request.tools.length
      ? { tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) }
      : {}),
  };
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** The text, the tool calls and the token counts of an answer; anything else in it is ignored. */
export function parseAnthropicAnswer(json: unknown): AiCompletion {
  if (!json || typeof json !== "object") throw new AiProviderError("assistant.err_bad_answer");
  const content = (json as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new AiProviderError("assistant.err_bad_answer");
  let text = "";
  const toolCalls: AiToolCall[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown; name?: unknown; input?: unknown };
    if (b.type === "text" && typeof b.text === "string") text += (text ? "\n" : "") + b.text;
    if (b.type === "tool_use" && typeof b.name === "string") toolCalls.push({ name: b.name, input: b.input });
  }
  const usage = (json as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage ?? {};
  return { text: text.trim(), toolCalls, usage: { inputTokens: readNumber(usage.input_tokens), outputTokens: readNumber(usage.output_tokens) } };
}

interface Attempt {
  status: number;
  retryAfter: string | null;
  json?: unknown;
}

export function createAnthropicProvider(options: AnthropicOptions): AiProvider {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const sleep = options.sleep ?? realSleep;

  /** One call, the reading of its body included, inside ONE timeout. */
  async function attempt(request: AiRequest): Promise<Attempt> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    if (request.signal) {
      if (request.signal.aborted) controller.abort();
      else request.signal.addEventListener("abort", onAbort, { once: true });
    }
    let stage: "send" | "read" = "send";
    try {
      const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
      const res = await doFetch(ANTHROPIC_URL, {
        method: "POST",
        headers: { "x-api-key": options.apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
        body: JSON.stringify(buildAnthropicBody(options.model, request)),
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
      const out: Attempt = { status: res.status, retryAfter: res.headers.get("retry-after") };
      if (res.ok) {
        stage = "read";
        out.json = await res.json();
      }
      return out;
    } catch {
      // the original error is dropped on purpose: it must not travel anywhere
      if (timedOut) throw new AiProviderError("assistant.err_timeout");
      if (request.signal?.aborted) throw new AiProviderError("assistant.err_aborted");
      throw new AiProviderError(stage === "read" ? "assistant.err_bad_answer" : "assistant.err_network");
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }

  return {
    async complete(request) {
      let result = await attempt(request);
      if ((result.status === 429 || result.status === 529) && !request.signal?.aborted) {
        await sleep(retryWaitMs(result.retryAfter));
        result = await attempt(request);
      }
      if (result.status < 200 || result.status >= 300) throw new AiProviderError(errorKeyForStatus(result.status));
      return parseAnthropicAnswer(result.json);
    },
  };
}
