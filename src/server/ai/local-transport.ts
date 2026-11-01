import http from "node:http";
import https from "node:https";
import { AiProviderError, type AiChatMessage, type AiErrorKey } from "./provider";
import { makeGuardedLookup, parseLocalBaseUrl, type LocalTarget } from "./local-host";

/**
 * «نموذج محلي» — THE SHARED PART of the two local adapters (Ollama, and the OpenAI-compatible gateway): the limits of one call, the HTTP
 * transport, the fit of a request to a small context window and the way a failure becomes a dictionary KEY.
 *
 * Rules this file keeps:
 *  - The address is the owner's, so it is judged by `local-host.ts` before anything is sent and the socket connects only to an address that
 *    passed (`makeGuardedLookup`). A redirect is never followed: any 3xx is a refusal.
 *  - A failure carries a dictionary KEY and nothing else: not the body of the answer, not the text that was sent, not the address, not the
 *    key. This file never logs.
 *  - A call is bounded: a timeout, a cap on the size of the answer, a cap on the length of the prompt (`fitToContext`).
 *  - Nothing here reads the database or the environment. Tests inject the transport (`setLocalTransportForTests`).
 */

/** A small model on a CPU: the window it is asked to use, the longest answer, the longest wait. */
export const LOCAL_NUM_CTX = 4096;
export const LOCAL_MAX_OUTPUT_TOKENS = 512;
export const LOCAL_TIMEOUT_MS = 180_000;
/** «اختبر الاتصال»: the list of models and the 5-token ping each get this long. */
export const LOCAL_PROBE_TIMEOUT_MS = 30_000;
export const LOCAL_MAX_RESPONSE_BYTES = 4_000_000;
/** What a local call is shown of the context (smaller than the external model's, so the prompt fits the window). */
export const LOCAL_CONTEXT_LIMITS = { maxChars: 4_000, maxTasks: 15, maxTitles: 15 } as const;
export const LOCAL_HISTORY = { turns: 2, chars: 1_500 } as const;
export const LOCAL_WINDOW = { messages: 12, chars: 3_000 } as const;

export interface LocalHttpRequest {
  method: "GET" | "POST";
  /** A full URL built from the validated origin and a fixed path. */
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

export interface LocalHttpResponse {
  status: number;
  text: string;
}

export type LocalTransport = (request: LocalHttpRequest) => Promise<LocalHttpResponse>;

/** Marks an error that already is a refusal key (the guarded lookup throws them through the socket layer). */
class TransportFailure extends Error {
  constructor(readonly key: AiErrorKey) {
    super(key);
  }
}

/** The real transport: `node:http(s)` with the guarded lookup, no redirects, a capped answer. */
export const nodeTransport: LocalTransport = (request) =>
  new Promise<LocalHttpResponse>((resolve, reject) => {
    const url = new URL(request.url);
    const lib = url.protocol === "https:" ? https : http;
    const lookup = makeGuardedLookup();
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      fn();
    };
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: request.method,
        headers: { ...request.headers, ...(request.body !== undefined ? { "content-length": String(Buffer.byteLength(request.body)) } : {}) },
        lookup: lookup as unknown as http.RequestOptions["lookup"],
        signal: request.signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > LOCAL_MAX_RESPONSE_BYTES) {
            res.destroy();
            finish(() => reject(new TransportFailure("assistant.err_bad_answer")));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => finish(() => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") })));
        res.on("error", () => finish(() => reject(new TransportFailure("assistant.err_bad_answer"))));
      },
    );
    req.on("error", (err: NodeJS.ErrnoException) => {
      // the guarded lookup's refusals are keys; everything else is dropped on purpose (it may name the address)
      const key = (err as { key?: unknown }).key;
      if (key === "assistant.err_local_host" || key === "assistant.err_local_down") finish(() => reject(new TransportFailure(key)));
      else finish(() => reject(err));
    });
    if (request.body !== undefined) req.write(request.body);
    req.end();
  });

let transport: LocalTransport = nodeTransport;

export function currentTransport(): LocalTransport {
  return transport;
}

/** Tests only: a fake transport, `null` to restore the real one. */
export function setLocalTransportForTests(next: LocalTransport | null): void {
  transport = next ?? nodeTransport;
}

// ───────────────────────────────────────── one bounded call ─────────────────────────────────────────

export interface CallOptions {
  target: LocalTarget;
  method: "GET" | "POST";
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Tests: a transport of their own. */
  transport?: LocalTransport;
}

/**
 * One request, inside ONE timeout, to the validated origin plus a fixed path. Returns the status and the text. Throws an
 * `AiProviderError` for a timeout, an abort, a refused address and a socket that could not connect.
 */
export async function callLocal(options: CallOptions): Promise<LocalHttpResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const onAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const send = options.transport ?? currentTransport();
    return await send({
      method: options.method,
      url: `${options.target.origin}${options.path}`,
      headers: { accept: "application/json", ...(options.body !== undefined ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) throw new AiProviderError("assistant.err_local_timeout");
    if (options.signal?.aborted) throw new AiProviderError("assistant.err_aborted");
    if (err instanceof AiProviderError) throw err;
    if (err instanceof TransportFailure) throw new AiProviderError(err.key);
    // ECONNREFUSED, a reset socket, an unknown host: the service is not there. The original error is dropped on purpose.
    throw new AiProviderError("assistant.err_local_down");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** The target of a stored address, or a refusal. The stored address was judged at save time; it is judged again here. */
export function targetOf(baseUrl: string): LocalTarget {
  const parsed = parseLocalBaseUrl(baseUrl);
  if (!parsed.ok) throw new AiProviderError("assistant.err_local_host");
  return parsed.target;
}

/** The HTTP status of a local server's answer as a refusal key (the body is never read for this). */
export function localErrorKeyForStatus(status: number): AiErrorKey {
  if (status === 401 || status === 403) return "assistant.err_key_rejected";
  if (status === 404) return "assistant.err_local_missing";
  if (status === 408 || status === 504) return "assistant.err_local_timeout";
  if (status === 429 || status === 503) return "assistant.err_local_busy";
  if (status >= 500) return "assistant.err_server";
  return "assistant.err_request";
}

/** A 2xx answer parsed as JSON; anything else is `assistant.err_bad_answer` (or the key of its status). */
export function jsonOf(res: LocalHttpResponse): unknown {
  if (res.status < 200 || res.status >= 300) throw new AiProviderError(localErrorKeyForStatus(res.status));
  try {
    return JSON.parse(res.text) as unknown;
  } catch {
    throw new AiProviderError("assistant.err_bad_answer");
  }
}

/** Does the refusal of a server (400) say that the model does not do tools? Only the answer's own words are looked at; they go nowhere. */
export function refusesTools(res: LocalHttpResponse): boolean {
  return res.status === 400 && /tool|function/i.test(res.text.slice(0, 2_000));
}

// ───────────────────────────────────────── fitting the window ─────────────────────────────────────────

/** A cautious estimate (Arabic and JSON cost more tokens per character than English): two characters per token. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 2);

export const CUT_MARKER = "…[قُصّ لأن النموذج المحلي نافذته صغيرة]\n";

/**
 * The prompt must fit the window, or the server silently drops the START of it (the instructions). So: the oldest earlier turns go
 * first (the conversation still opens with a user turn), and if the last message alone is still too long, its OLDEST part is cut and
 * the cut is marked. The system text and the end of the last message (the question) are never cut.
 */
export function fitToContext(system: string, messages: readonly AiChatMessage[], promptTokens: number): AiChatMessage[] {
  const out = messages.map((m) => ({ ...m }));
  const total = () => estimateTokens(system) + out.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);
  while (out.length > 1 && total() > promptTokens) out.shift();
  while (out.length > 1 && out[0]?.role !== "user") out.shift();
  const last = out[out.length - 1];
  if (last && total() > promptTokens) {
    const room = Math.max(200, (promptTokens - estimateTokens(system) - 4) * 2 - CUT_MARKER.length);
    if (last.content.length > room) last.content = `${CUT_MARKER}${last.content.slice(last.content.length - room)}`;
  }
  return out;
}

/** The part of the window left for the prompt once the answer's room is taken. */
export const promptBudget = (numCtx: number, maxOutput: number): number => Math.max(512, numCtx - maxOutput - 64);

export function clampOutput(maxTokens: number): number {
  return Math.max(16, Math.min(Math.floor(maxTokens), LOCAL_MAX_OUTPUT_TOKENS));
}

/** An answer's text without the «thinking» block some small models write first. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** The arguments of a tool call: an object, or a JSON text of one (a bad text is an empty object: the proposal checks fail closed). */
export function argumentsOf(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}
