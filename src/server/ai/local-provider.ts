import {
  AiProviderError,
  type AiCompletion,
  type AiProvider,
  type AiRequest,
  type AiToolCall,
} from "./provider";
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

/**
 * «نموذج محلي» — THE OLLAMA ADAPTER: the same one-method provider as Anthropic's (`provider.ts`), pointed at an Ollama service the
 * owner runs on his own server (`POST /api/chat`, `GET /api/tags`). It is made by `registry.ts` when the owner chose «محلي» for an
 * assistant; the rest of the assistant does not know the difference.
 *
 * What it adds to the rules of `provider.ts` (the address is checked by `local-host.ts` and the plumbing is `local-transport.ts`):
 *  - ONE request at a time through `localQueue` (a full line is «السيرفر مشغول», at once, with nothing stored);
 *  - `stream: false`: the answer is read whole, inside one timeout (3 minutes: a 3B model on a CPU needs it);
 *  - the prompt is fitted to a 4096-token window and the answer is capped at 512 tokens;
 *  - `keep_alive`: the model stays loaded for ten minutes, so the second question does not pay the loading again;
 *  - tools are offered; a model that answers 400 «does not support tools» is asked again without them, once;
 *  - no key: Ollama has none. Nothing here logs, and an error carries a dictionary key only.
 */

export const OLLAMA_KEEP_ALIVE = "10m";

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  /** Tests: a fake transport, a queue of their own, other limits. */
  transport?: LocalTransport;
  queue?: LocalQueue;
  timeoutMs?: number;
  numCtx?: number;
}

/** The body of `/api/chat`: exactly what is sent, so a test can read it. */
export function buildOllamaBody(model: string, request: AiRequest, numCtx: number, withTools: boolean): Record<string, unknown> {
  const maxOutput = clampOutput(request.maxTokens);
  const messages = fitToContext(request.system, request.messages, promptBudget(numCtx, maxOutput));
  return {
    model,
    stream: false,
    keep_alive: OLLAMA_KEEP_ALIVE,
    messages: [{ role: "system", content: request.system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
    options: { num_ctx: numCtx, num_predict: maxOutput, temperature: 0.3 },
    ...(withTools && request.tools && request.tools.length
      ? { tools: request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
      : {}),
  };
}

/** The text, the tool calls and the token counts of an answer; anything else in it is ignored. */
export function parseOllamaAnswer(json: unknown): AiCompletion {
  if (!json || typeof json !== "object") throw new AiProviderError("assistant.err_bad_answer");
  const body = json as { message?: { content?: unknown; tool_calls?: unknown }; error?: unknown; prompt_eval_count?: unknown; eval_count?: unknown };
  if (typeof body.error === "string") throw new AiProviderError("assistant.err_server");
  const message = body.message;
  if (!message || typeof message !== "object") throw new AiProviderError("assistant.err_bad_answer");
  const text = typeof message.content === "string" ? stripThinking(message.content) : "";
  const toolCalls: AiToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      const fn = call && typeof call === "object" ? (call as { function?: { name?: unknown; arguments?: unknown } }).function : undefined;
      if (fn && typeof fn.name === "string") toolCalls.push({ name: fn.name, input: argumentsOf(fn.arguments) });
    }
  }
  return { text, toolCalls, usage: { inputTokens: readCount(body.prompt_eval_count), outputTokens: readCount(body.eval_count) } };
}

export function createOllamaProvider(options: OllamaOptions): AiProvider {
  const timeoutMs = options.timeoutMs ?? LOCAL_TIMEOUT_MS;
  const numCtx = options.numCtx ?? LOCAL_NUM_CTX;
  const queue = options.queue ?? localQueue;
  return {
    async complete(request) {
      const target = targetOf(options.baseUrl);
      return queue.run(async () => {
        const send = (withTools: boolean) =>
          callLocal({ target, method: "POST", path: "/api/chat", body: buildOllamaBody(options.model, request, numCtx, withTools), timeoutMs, ...(request.signal ? { signal: request.signal } : {}), ...(options.transport ? { transport: options.transport } : {}) });
        let res = await send(true);
        if (request.tools?.length && refusesTools(res)) res = await send(false);
        return parseOllamaAnswer(jsonOf(res));
      }, request.signal);
    },
  };
}

// ───────────────────────────────────────── «اختبر الاتصال» ─────────────────────────────────────────

export interface ProbeResult {
  /** The service answered the list of models. */
  reachable: true;
  /** The names of the installed models (at most 50, each a valid short token). */
  models: string[];
  /** The model the owner named is among them (null: none named). */
  installed: boolean | null;
  listMs: number;
  /** The 5-token ping: milliseconds, or the refusal's key; null when it was not tried (no model named, or not installed). */
  ping: { ok: true; ms: number } | { ok: false; key: string } | null;
}

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;

export function namesOf(json: unknown, field: "models" | "data", key: "name" | "id"): string[] {
  const list = json && typeof json === "object" ? (json as Record<string, unknown>)[field] : undefined;
  if (!Array.isArray(list)) throw new AiProviderError("assistant.err_bad_answer");
  const out: string[] = [];
  for (const row of list) {
    const name = row && typeof row === "object" ? (row as Record<string, unknown>)[key] : undefined;
    if (typeof name === "string" && MODEL_NAME.test(name) && out.length < 50) out.push(name);
  }
  return out;
}

export const modelIsInstalled = (models: readonly string[], wanted: string): boolean => models.includes(wanted) || models.includes(`${wanted}:latest`);

/** Lists the installed models, then (when the named one is installed) asks it for 5 tokens and times it. Never throws for «the model is not there». */
export async function probeOllama(options: { baseUrl: string; model: string | null; transport?: LocalTransport; queue?: LocalQueue; timeoutMs?: number }): Promise<ProbeResult> {
  const target = targetOf(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? LOCAL_PROBE_TIMEOUT_MS;
  const t0 = Date.now();
  const listed = jsonOf(await callLocal({ target, method: "GET", path: "/api/tags", timeoutMs, ...(options.transport ? { transport: options.transport } : {}) }));
  const listMs = Date.now() - t0;
  const models = namesOf(listed, "models", "name");
  if (!options.model) return { reachable: true, models, installed: null, listMs, ping: null };
  const installed = modelIsInstalled(models, options.model);
  if (!installed) return { reachable: true, models, installed, listMs, ping: null };
  const t1 = Date.now();
  try {
    await (options.queue ?? localQueue).run(async () => {
      const body = { model: options.model, stream: false, keep_alive: OLLAMA_KEEP_ALIVE, messages: [{ role: "user", content: "hi" }], options: { num_ctx: 512, num_predict: 5, temperature: 0 } };
      parseOllamaAnswer(jsonOf(await callLocal({ target, method: "POST", path: "/api/chat", body, timeoutMs, ...(options.transport ? { transport: options.transport } : {}) })));
    });
    return { reachable: true, models, installed, listMs, ping: { ok: true, ms: Date.now() - t1 } };
  } catch (err) {
    return { reachable: true, models, installed, listMs, ping: { ok: false, key: err instanceof AiProviderError ? err.key : "assistant.err_bad_answer" } };
  }
}
