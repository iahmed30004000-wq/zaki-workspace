import { AiProviderError, type AiCompletion, type AiProvider, type AiRequest, type AiToolCall } from "./provider";
import { localQueue, type LocalQueue } from "./local-queue";
import {
  LOCAL_NUM_CTX,
  LOCAL_PROBE_TIMEOUT_MS,
  LOCAL_TIMEOUT_MS,
  argumentsOf,
  callLocal,
  clampOutput,
  fitToContext,
  jsonOf,
  promptBudget,
  readCount,
  refusesTools,
  stripThinking,
  targetOf,
  type LocalTransport,
} from "./local-transport";
import { modelIsInstalled, namesOf, type ProbeResult } from "./local-provider";

/**
 * «بوابة متوافقة» — THE OPENAI-COMPATIBLE ADAPTER: `POST {base}/v1/chat/completions` and `GET {base}/v1/models`, the shape that a
 * gateway in front of a model speaks (Hermes Agent, LiteLLM, vLLM, LM Studio, llama.cpp's server ...). It shares everything else with the
 * Ollama adapter: the address allow-list (an internal host only), ONE request at a time, the timeouts, the window, the keys-only errors.
 *
 * The one thing that differs is the question this adapter cannot answer: IS THE MODEL BEHIND THE GATEWAY ON THE OWNER'S MACHINE?
 * A gateway can forward to an outside API, and then it is an EXTERNAL model whatever its address says. So:
 *  - redaction is ON, exactly as for the external model, and the relaxed filter is available only when the owner ticked the explicit
 *    confirmation «أؤكد إن النموذج الخلفي محلي على سيرفري» (`gatewayConfirmedLocal`; see `assistant-provider.ts`);
 *  - the optional Bearer key is the owner's, encrypted at rest and write-only like the Anthropic key; it is sent in ONE header, only to
 *    the validated internal host, and never appears in an error, a log line or a response.
 */

export interface OpenAiCompatOptions {
  baseUrl: string;
  model: string;
  /** The Bearer key, if the gateway wants one. Empty: no `authorization` header at all. */
  apiKey?: string;
  transport?: LocalTransport;
  queue?: LocalQueue;
  timeoutMs?: number;
  numCtx?: number;
}

export const OPENAI_CHAT_PATH = "/v1/chat/completions";
export const OPENAI_MODELS_PATH = "/v1/models";

const authHeaders = (apiKey: string | undefined): Record<string, string> => (apiKey ? { authorization: `Bearer ${apiKey}` } : {});

/** The body of the chat call: exactly what is sent, so a test can read it. */
export function buildOpenAiBody(model: string, request: AiRequest, numCtx: number, withTools: boolean): Record<string, unknown> {
  const maxOutput = clampOutput(request.maxTokens);
  const messages = fitToContext(request.system, request.messages, promptBudget(numCtx, maxOutput));
  return {
    model,
    stream: false,
    max_tokens: maxOutput,
    temperature: 0.3,
    messages: [{ role: "system", content: request.system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
    ...(withTools && request.tools && request.tools.length
      ? { tools: request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
      : {}),
  };
}

export function parseOpenAiAnswer(json: unknown): AiCompletion {
  if (!json || typeof json !== "object") throw new AiProviderError("assistant.err_bad_answer");
  const body = json as { choices?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  const first = Array.isArray(body.choices) ? (body.choices[0] as { message?: { content?: unknown; tool_calls?: unknown } } | undefined) : undefined;
  const message = first?.message;
  if (!message || typeof message !== "object") throw new AiProviderError("assistant.err_bad_answer");
  const text = typeof message.content === "string" ? stripThinking(message.content) : "";
  const toolCalls: AiToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      const fn = call && typeof call === "object" ? (call as { function?: { name?: unknown; arguments?: unknown } }).function : undefined;
      if (fn && typeof fn.name === "string") toolCalls.push({ name: fn.name, input: argumentsOf(fn.arguments) });
    }
  }
  const usage = body.usage ?? {};
  return { text, toolCalls, usage: { inputTokens: readCount(usage.prompt_tokens), outputTokens: readCount(usage.completion_tokens) } };
}

export function createOpenAiCompatProvider(options: OpenAiCompatOptions): AiProvider {
  const timeoutMs = options.timeoutMs ?? LOCAL_TIMEOUT_MS;
  const numCtx = options.numCtx ?? LOCAL_NUM_CTX;
  const queue = options.queue ?? localQueue;
  return {
    async complete(request) {
      const target = targetOf(options.baseUrl);
      return queue.run(async () => {
        const send = (withTools: boolean) =>
          callLocal({
            target,
            method: "POST",
            path: OPENAI_CHAT_PATH,
            headers: authHeaders(options.apiKey),
            body: buildOpenAiBody(options.model, request, numCtx, withTools),
            timeoutMs,
            ...(request.signal ? { signal: request.signal } : {}),
            ...(options.transport ? { transport: options.transport } : {}),
          });
        let res = await send(true);
        if (request.tools?.length && refusesTools(res)) res = await send(false);
        return parseOpenAiAnswer(jsonOf(res));
      }, request.signal);
    },
  };
}

/** Lists the models the gateway offers, then (when the named one is among them) asks it for 5 tokens and times it. */
export async function probeOpenAiCompat(options: { baseUrl: string; model: string | null; apiKey?: string; transport?: LocalTransport; queue?: LocalQueue; timeoutMs?: number }): Promise<ProbeResult> {
  const target = targetOf(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? LOCAL_PROBE_TIMEOUT_MS;
  const headers = authHeaders(options.apiKey);
  const t0 = Date.now();
  const listed = jsonOf(await callLocal({ target, method: "GET", path: OPENAI_MODELS_PATH, headers, timeoutMs, ...(options.transport ? { transport: options.transport } : {}) }));
  const listMs = Date.now() - t0;
  const models = namesOf(listed, "data", "id");
  if (!options.model) return { reachable: true, models, installed: null, listMs, ping: null };
  const installed = modelIsInstalled(models, options.model);
  // a gateway may serve a model it does not list: only a list that has entries can say «not installed»
  if (!installed && models.length > 0) return { reachable: true, models, installed, listMs, ping: null };
  const t1 = Date.now();
  try {
    await (options.queue ?? localQueue).run(async () => {
      const body = { model: options.model, stream: false, max_tokens: 5, temperature: 0, messages: [{ role: "user", content: "hi" }] };
      parseOpenAiAnswer(jsonOf(await callLocal({ target, method: "POST", path: OPENAI_CHAT_PATH, headers, body, timeoutMs, ...(options.transport ? { transport: options.transport } : {}) })));
    });
    return { reachable: true, models, installed: models.length > 0 ? installed : null, listMs, ping: { ok: true, ms: Date.now() - t1 } };
  } catch (err) {
    return { reachable: true, models, installed: models.length > 0 ? installed : null, listMs, ping: { ok: false, key: err instanceof AiProviderError ? err.key : "assistant.err_bad_answer" } };
  }
}
