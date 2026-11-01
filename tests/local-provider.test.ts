import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AiProviderError, isValidLocalModelId, type AiRequest } from "@/server/ai/provider";
import { LocalQueue } from "@/server/ai/local-queue";
import { buildOllamaBody, createOllamaProvider, modelIsInstalled, parseOllamaAnswer, probeOllama } from "@/server/ai/local-provider";
import { buildOpenAiBody, createOpenAiCompatProvider, parseOpenAiAnswer, probeOpenAiCompat } from "@/server/ai/openai-compat-provider";
import { CUT_MARKER, LOCAL_MAX_OUTPUT_TOKENS, LOCAL_NUM_CTX, clampOutput, estimateTokens, fitToContext, promptBudget, setLocalTransportForTests, type LocalHttpRequest, type LocalTransport } from "@/server/ai/local-transport";
import { makeProvider } from "@/server/ai/registry";

/**
 * «نموذج محلي» — the two local adapters (Ollama and the OpenAI-compatible gateway) against a FAKE transport, plus a few calls over real
 * sockets to a throw-away server on 127.0.0.1 (the real path: the address guard, no redirects, the size cap). No test touches the Internet.
 *
 * What is pinned: the exact request each adapter builds, the answers it understands, every failure as a dictionary KEY that carries
 * none of the text that was sent and none of the answer's body, the 4096-token window, the 512-token cap, one-at-a-time, the retry
 * without tools, the Bearer key in ONE header, «اختبر الاتصال».
 */

const BASE = "http://ollama:11434";
const SECRET_TEXT = "نص-سري-لا-يظهر-أبدًا-SECRET-WORDS";
const KEY = "gw-secret-bearer-key-0123456789"; // scan-secrets:ignore

const request: AiRequest = {
  system: "نظام",
  messages: [{ role: "user", content: "سؤال" }],
  tools: [{ name: "propose_action", description: "d", inputSchema: { type: "object", properties: {} } }],
  maxTokens: 1500,
};

const reply = (status: number, body: unknown) => ({ status, text: typeof body === "string" ? body : JSON.stringify(body) });
const ollamaAnswer = { message: { role: "assistant", content: "الجواب" }, prompt_eval_count: 120, eval_count: 30 };
const openaiAnswer = { choices: [{ message: { role: "assistant", content: "الجواب" } }], usage: { prompt_tokens: 120, completion_tokens: 30 } };

const fresh = () => new LocalQueue(2, 5_000);

afterEach(() => {
  setLocalTransportForTests(null);
  vi.restoreAllMocks();
});

describe("the Ollama request", () => {
  it("is a POST of JSON to /api/chat on the validated origin, not streamed, with the window and the output cap", async () => {
    const seen: LocalHttpRequest[] = [];
    const transport: LocalTransport = async (req) => {
      seen.push(req);
      return reply(200, ollamaAnswer);
    };
    const out = await createOllamaProvider({ baseUrl: BASE, model: "qwen2.5:3b-instruct", transport, queue: fresh() }).complete(request);
    expect(out).toEqual({ text: "الجواب", toolCalls: [], usage: { inputTokens: 120, outputTokens: 30 } });
    expect(seen).toHaveLength(1);
    const req = seen[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://ollama:11434/api/chat");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["authorization"]).toBeUndefined();
    const body = JSON.parse(req.body as string);
    expect(body).toMatchObject({ model: "qwen2.5:3b-instruct", stream: false, keep_alive: "10m", options: { num_ctx: LOCAL_NUM_CTX, num_predict: LOCAL_MAX_OUTPUT_TOKENS } });
    expect(body.messages).toEqual([
      { role: "system", content: "نظام" },
      { role: "user", content: "سؤال" },
    ]);
    expect(body.tools).toEqual([{ type: "function", function: { name: "propose_action", description: "d", parameters: { type: "object", properties: {} } } }]);
    expect(req.signal).toBeInstanceOf(AbortSignal);
  });

  it("the model id and the text sent never become part of the URL", async () => {
    const urls: string[] = [];
    const transport: LocalTransport = async (req) => {
      urls.push(req.url);
      return reply(200, ollamaAnswer);
    };
    await createOllamaProvider({ baseUrl: BASE, model: "https://evil.example/x", transport, queue: fresh() }).complete({ ...request, messages: [{ role: "user", content: "http://169.254.169.254/latest" }] });
    expect(urls).toEqual(["http://ollama:11434/api/chat"]);
  });

  it("a stored address that is not internal is refused BEFORE anything is sent", async () => {
    const transport = vi.fn(async () => reply(200, ollamaAnswer));
    for (const bad of ["https://api.openai.com", "http://169.254.169.254", "http://ollama:11434/api", ""]) {
      const err = await createOllamaProvider({ baseUrl: bad, model: "m3b", transport, queue: fresh() }).complete(request).catch((e: unknown) => e);
      expect((err as AiProviderError).key, bad).toBe("assistant.err_local_host");
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("the answer is capped to 512 tokens however much the assistant asked for", () => {
    expect(clampOutput(1500)).toBe(LOCAL_MAX_OUTPUT_TOKENS);
    expect(clampOutput(800)).toBe(LOCAL_MAX_OUTPUT_TOKENS);
    expect(clampOutput(100)).toBe(100);
    expect((buildOllamaBody("m3b", { ...request, maxTokens: 1500 }, 4096, true).options as { num_predict: number }).num_predict).toBe(512);
  });

  it("a model that refuses tools (400) is asked again WITHOUT them, once; any other 400 is a refusal", async () => {
    const bodies: Record<string, unknown>[] = [];
    const transport: LocalTransport = async (req) => {
      const b = JSON.parse(req.body as string) as Record<string, unknown>;
      bodies.push(b);
      return b["tools"] ? reply(400, { error: "registry.ollama.ai/library/gemma:2b does not support tools" }) : reply(200, ollamaAnswer);
    };
    const out = await createOllamaProvider({ baseUrl: BASE, model: "gemma:2b", transport, queue: fresh() }).complete(request);
    expect(out.text).toBe("الجواب");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("tools");
    expect(bodies[1]).not.toHaveProperty("tools");

    const other = vi.fn(async () => reply(400, { error: "bad json" }));
    const err = await createOllamaProvider({ baseUrl: BASE, model: "gemma:2b", transport: other, queue: fresh() }).complete(request).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_request");
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe("the Ollama answer", () => {
  it("is the text (a thinking block removed), the tool calls (arguments as an object or as JSON text) and the token counts", () => {
    expect(
      parseOllamaAnswer({
        message: {
          content: "<think>داخلي</think>الجواب",
          tool_calls: [{ function: { name: "propose_action", arguments: { type: "pin_task" } } }, { function: { name: "propose_action", arguments: '{"type":"create_task"}' } }, { function: { name: "x", arguments: "not json" } }, { nothing: true }],
        },
        prompt_eval_count: 5,
        eval_count: 7,
      }),
    ).toEqual({
      text: "الجواب",
      toolCalls: [
        { name: "propose_action", input: { type: "pin_task" } },
        { name: "propose_action", input: { type: "create_task" } },
        { name: "x", input: {} },
      ],
      usage: { inputTokens: 5, outputTokens: 7 },
    });
    expect(parseOllamaAnswer({ message: { content: "ب" } }).usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(parseOllamaAnswer({ message: { content: "ب" }, eval_count: -3, prompt_eval_count: "x" }).usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("a body without a message, an error field, or something that is not JSON is a refusal", async () => {
    expect(() => parseOllamaAnswer({})).toThrowError(AiProviderError);
    expect(() => parseOllamaAnswer(null)).toThrowError(AiProviderError);
    expect(() => parseOllamaAnswer({ error: "x" })).toThrowError(AiProviderError);
    const transport: LocalTransport = async () => reply(200, "<html>not json</html>");
    const err = await createOllamaProvider({ baseUrl: BASE, model: "m3b", transport, queue: fresh() }).complete(request).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_bad_answer");
  });
});

describe("failures are dictionary keys that carry nothing", () => {
  const cases: [number, string][] = [
    [400, "assistant.err_request"],
    [401, "assistant.err_key_rejected"],
    [403, "assistant.err_key_rejected"],
    [404, "assistant.err_local_missing"], // «model not found»: not installed
    [408, "assistant.err_local_timeout"],
    [422, "assistant.err_request"],
    [429, "assistant.err_local_busy"],
    [500, "assistant.err_server"],
    [502, "assistant.err_server"],
    [503, "assistant.err_local_busy"],
    [504, "assistant.err_local_timeout"],
    [302, "assistant.err_request"], // a redirect is never followed: it is a refusal
  ];

  it.each(cases)("HTTP %i is %s and the body is never echoed", async (status, key) => {
    const transport: LocalTransport = async () => reply(status, { error: `model "${SECRET_TEXT}" not found at 10.1.2.3` });
    for (const make of [
      () => createOllamaProvider({ baseUrl: BASE, model: "m3b", transport, queue: fresh() }),
      () => createOpenAiCompatProvider({ baseUrl: BASE, model: "m3b", apiKey: KEY, transport, queue: fresh() }),
    ]) {
      const err = await make().complete({ ...request, tools: [], messages: [{ role: "user", content: SECRET_TEXT }] }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiProviderError);
      expect((err as AiProviderError).key).toBe(key);
      const shown = JSON.stringify(err) + String((err as Error).message) + String((err as Error).stack ?? "").split("\n")[0];
      expect(shown).not.toContain(SECRET_TEXT);
      expect(shown).not.toContain("10.1.2.3");
      expect(shown).not.toContain(KEY);
    }
  });

  it("a socket that cannot connect is «down»; its own words (they may name the address) are dropped", async () => {
    const transport: LocalTransport = async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 172.18.0.5:11434"), { code: "ECONNREFUSED" });
    };
    const err = await createOllamaProvider({ baseUrl: BASE, model: "m3b", transport, queue: fresh() }).complete(request).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_local_down");
    expect(String((err as Error).message)).not.toContain("172.18");
  });

  it("a call that takes longer than the timeout is a timeout", async () => {
    const transport: LocalTransport = (req) =>
      new Promise((_resolve, reject) => {
        req.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    const err = await createOllamaProvider({ baseUrl: BASE, model: "m3b", transport, queue: fresh(), timeoutMs: 30 }).complete(request).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_local_timeout");
  });

  it("an abort from the caller is an abort, not a timeout", async () => {
    const ctl = new AbortController();
    const transport: LocalTransport = (req) =>
      new Promise((_resolve, reject) => {
        req.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        setTimeout(() => ctl.abort(), 5);
      });
    const err = await createOllamaProvider({ baseUrl: BASE, model: "m3b", transport, queue: fresh() }).complete({ ...request, signal: ctl.signal }).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_aborted");
  });

  it("nothing is written to the console, whatever fails", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const transport: LocalTransport = async () => reply(500, SECRET_TEXT);
    await createOllamaProvider({ baseUrl: BASE, model: "m3b", transport, queue: fresh() }).complete(request).catch(() => {});
    await createOpenAiCompatProvider({ baseUrl: BASE, model: "m3b", transport, queue: fresh() }).complete(request).catch(() => {});
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("ONE request at a time", () => {
  it("two calls to the model never overlap, and a full line answers «السيرفر مشغول» (busy) without sending anything", async () => {
    let active = 0;
    let peak = 0;
    let calls = 0;
    const gate: { open: () => void } = { open: () => {} };
    const opened = new Promise<void>((r) => (gate.open = r));
    const transport: LocalTransport = async () => {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      await opened;
      active -= 1;
      return reply(200, ollamaAnswer);
    };
    const queue = new LocalQueue(1, 5_000);
    const make = () => createOllamaProvider({ baseUrl: BASE, model: "m3b", transport, queue });
    const a = make().complete(request);
    const b = make().complete(request);
    const c = await make().complete(request).catch((e: unknown) => e);
    expect((c as AiProviderError).key).toBe("assistant.err_local_busy");
    gate.open();
    await Promise.all([a, b]);
    expect(peak).toBe(1);
    expect(calls).toBe(2);
  });

  it("the Ollama adapter and the gateway adapter share the same queue", async () => {
    let active = 0;
    let peak = 0;
    const transport: LocalTransport = async (req) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return reply(200, req.url.endsWith("/api/chat") ? ollamaAnswer : openaiAnswer);
    };
    const queue = new LocalQueue(3, 5_000);
    await Promise.all([
      createOllamaProvider({ baseUrl: BASE, model: "m3b", transport, queue }).complete(request),
      createOpenAiCompatProvider({ baseUrl: BASE, model: "m3b", transport, queue }).complete(request),
      createOllamaProvider({ baseUrl: BASE, model: "m3b", transport, queue }).complete(request),
    ]);
    expect(peak).toBe(1);
  });
});

describe("the prompt is fitted to the window", () => {
  const long = (n: number) => "س".repeat(n);

  it("short requests are untouched", () => {
    const messages = [
      { role: "user" as const, content: "أ" },
      { role: "assistant" as const, content: "ب" },
      { role: "user" as const, content: "ج" },
    ];
    expect(fitToContext("نظام", messages, promptBudget(LOCAL_NUM_CTX, 512))).toEqual(messages);
  });

  it("old turns go first, the conversation still opens with a user turn, and the last message is kept", () => {
    const messages = [
      { role: "user" as const, content: long(3000) },
      { role: "assistant" as const, content: long(3000) },
      { role: "user" as const, content: long(3000) },
      { role: "assistant" as const, content: "قصير" },
      { role: "user" as const, content: "السؤال الأخير" },
    ];
    const out = fitToContext("نظام", messages, promptBudget(LOCAL_NUM_CTX, 512));
    expect(out[0]?.role).toBe("user");
    expect(out[out.length - 1]?.content).toBe("السؤال الأخير");
    expect(out.length).toBeLessThan(messages.length);
    expect(out.reduce((n, m) => n + estimateTokens(m.content), 0) + estimateTokens("نظام")).toBeLessThanOrEqual(promptBudget(LOCAL_NUM_CTX, 512));
  });

  it("a last message that is alone too long is cut at its OLDEST end, with the cut marked, and its end (the question) is kept", () => {
    const content = `${long(20_000)} السؤال في النهاية`;
    const out = fitToContext("نظام", [{ role: "user", content }], promptBudget(LOCAL_NUM_CTX, 512));
    expect(out).toHaveLength(1);
    expect(out[0]!.content.startsWith(CUT_MARKER)).toBe(true);
    expect(out[0]!.content.endsWith("السؤال في النهاية")).toBe(true);
    expect(estimateTokens(out[0]!.content) + estimateTokens("نظام")).toBeLessThanOrEqual(promptBudget(LOCAL_NUM_CTX, 512) + 8);
  });

  it("the request body of both adapters carries the fitted messages and the system text first", () => {
    const huge: AiRequest = { ...request, messages: [{ role: "user", content: long(50_000) }] };
    for (const body of [buildOllamaBody("m3b", huge, 4096, true), buildOpenAiBody("m3b", huge, 4096, true)]) {
      const messages = body["messages"] as { role: string; content: string }[];
      expect(messages[0]).toEqual({ role: "system", content: "نظام" });
      expect(messages[1]!.content.length).toBeLessThan(10_000);
    }
  });
});

describe("the OpenAI-compatible gateway", () => {
  it("POSTs to /v1/chat/completions with the Bearer key in ONE header and nowhere else", async () => {
    const seen: LocalHttpRequest[] = [];
    const transport: LocalTransport = async (req) => {
      seen.push(req);
      return reply(200, openaiAnswer);
    };
    const out = await createOpenAiCompatProvider({ baseUrl: "http://hermes:8642", model: "hermes-3", apiKey: KEY, transport, queue: fresh() }).complete(request);
    expect(out).toEqual({ text: "الجواب", toolCalls: [], usage: { inputTokens: 120, outputTokens: 30 } });
    const req = seen[0]!;
    expect(req.url).toBe("http://hermes:8642/v1/chat/completions");
    expect(req.headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(req.url).not.toContain(KEY);
    expect(req.body).not.toContain(KEY);
    const body = JSON.parse(req.body as string);
    expect(body).toMatchObject({ model: "hermes-3", stream: false, max_tokens: LOCAL_MAX_OUTPUT_TOKENS });
    expect(body.tools[0]).toEqual({ type: "function", function: { name: "propose_action", description: "d", parameters: { type: "object", properties: {} } } });
  });

  it("without a key there is no authorization header at all", async () => {
    const seen: LocalHttpRequest[] = [];
    const transport: LocalTransport = async (req) => {
      seen.push(req);
      return reply(200, openaiAnswer);
    };
    await createOpenAiCompatProvider({ baseUrl: BASE, model: "m3b", apiKey: "", transport, queue: fresh() }).complete(request);
    expect(Object.keys(seen[0]!.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
  });

  it("tool calls come as JSON text; a missing choice is a refusal", () => {
    expect(parseOpenAiAnswer({ choices: [{ message: { content: "x", tool_calls: [{ function: { name: "propose_action", arguments: '{"a":1}' } }] } }] }).toolCalls).toEqual([{ name: "propose_action", input: { a: 1 } }]);
    expect(() => parseOpenAiAnswer({ choices: [] })).toThrowError(AiProviderError);
    expect(() => parseOpenAiAnswer(null)).toThrowError(AiProviderError);
  });

  it("a refused address is refused before anything is sent, here too", async () => {
    const transport = vi.fn(async () => reply(200, openaiAnswer));
    const err = await createOpenAiCompatProvider({ baseUrl: "https://api.openai.com", model: "gpt", apiKey: KEY, transport, queue: fresh() }).complete(request).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_local_host");
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("«اختبر الاتصال»", () => {
  const tags = { models: [{ name: "qwen2.5:3b-instruct", size: 1 }, { name: "llama3.2:3b" }, { name: "bad name with spaces" }, { nothing: 1 }] };

  it("lists the installed models (only valid names), times the list, and pings the named model with 5 tokens", async () => {
    const seen: LocalHttpRequest[] = [];
    const transport: LocalTransport = async (req) => {
      seen.push(req);
      return req.url.endsWith("/api/tags") ? reply(200, tags) : reply(200, ollamaAnswer);
    };
    const r = await probeOllama({ baseUrl: BASE, model: "llama3.2:3b", transport, queue: fresh() });
    expect(r.reachable).toBe(true);
    expect(r.models).toEqual(["qwen2.5:3b-instruct", "llama3.2:3b"]);
    expect(r.installed).toBe(true);
    expect(r.listMs).toBeGreaterThanOrEqual(0);
    expect(r.ping).toMatchObject({ ok: true });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET http://ollama:11434/api/tags", "POST http://ollama:11434/api/chat"]);
    expect((JSON.parse(seen[1]!.body as string).options as { num_predict: number }).num_predict).toBe(5);
  });

  it("a model that is not installed is said so and is NOT pinged; «latest» counts as installed", async () => {
    const transport = vi.fn(async (req: LocalHttpRequest) => (req.url.endsWith("/api/tags") ? reply(200, { models: [{ name: "llama3.2:latest" }] }) : reply(200, ollamaAnswer)));
    const missing = await probeOllama({ baseUrl: BASE, model: "qwen2.5:3b", transport, queue: fresh() });
    expect(missing).toMatchObject({ installed: false, ping: null });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(modelIsInstalled(["llama3.2:latest"], "llama3.2")).toBe(true);
    expect(modelIsInstalled(["llama3.2:latest"], "llama3.1")).toBe(false);
    const noModel = await probeOllama({ baseUrl: BASE, model: null, transport, queue: fresh() });
    expect(noModel).toMatchObject({ installed: null, ping: null });
  });

  it("a ping that fails is reported as a key while the list still shows; a service that is down throws a key", async () => {
    const transport: LocalTransport = async (req) => (req.url.endsWith("/api/tags") ? reply(200, { models: [{ name: "llama3.2:3b" }] }) : reply(500, "x"));
    const r = await probeOllama({ baseUrl: BASE, model: "llama3.2:3b", transport, queue: fresh() });
    expect(r.ping).toEqual({ ok: false, key: "assistant.err_server" });
    const down: LocalTransport = async () => {
      throw new Error("ECONNREFUSED");
    };
    const err = await probeOllama({ baseUrl: BASE, model: null, transport: down, queue: fresh() }).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_local_down");
  });

  it("the gateway: GET /v1/models with the key, then a 5-token ping on /v1/chat/completions", async () => {
    const seen: LocalHttpRequest[] = [];
    const transport: LocalTransport = async (req) => {
      seen.push(req);
      return req.url.endsWith("/v1/models") ? reply(200, { data: [{ id: "hermes-3" }, { id: "other" }] }) : reply(200, openaiAnswer);
    };
    const r = await probeOpenAiCompat({ baseUrl: "http://hermes:8642", model: "hermes-3", apiKey: KEY, transport, queue: fresh() });
    expect(r.models).toEqual(["hermes-3", "other"]);
    expect(r.installed).toBe(true);
    expect(r.ping).toMatchObject({ ok: true });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET http://hermes:8642/v1/models", "POST http://hermes:8642/v1/chat/completions"]);
    expect(seen.every((s) => s.headers["authorization"] === `Bearer ${KEY}`)).toBe(true);
    expect((JSON.parse(seen[1]!.body as string) as { max_tokens: number }).max_tokens).toBe(5);
  });

  it("a gateway with an empty list may still serve the named model: it is pinged and installed is unknown", async () => {
    const transport: LocalTransport = async (req) => (req.url.endsWith("/v1/models") ? reply(200, { data: [] }) : reply(200, openaiAnswer));
    const r = await probeOpenAiCompat({ baseUrl: BASE, model: "x-model", transport, queue: fresh() });
    expect(r.installed).toBeNull();
    expect(r.ping).toMatchObject({ ok: true });
  });
});

describe("model names", () => {
  it("a local name may carry a registry path; traversal, spaces and URLs are refused", () => {
    for (const ok of ["qwen2.5:3b-instruct", "llama3.2:3b", "hf.co/user/model:Q4_K_M", "m3b"]) expect(isValidLocalModelId(ok), ok).toBe(true);
    for (const bad of ["", "a", "ab", "has space", "../x", "a/../b", "a//b", "a/", "/a", "https://x.io", ".hidden", "م".repeat(5), "a".repeat(121), 5, null]) expect(isValidLocalModelId(bad), String(bad)).toBe(false);
  });

  it("the registry makes the right adapter for each kind (a fake factory replaces all of them)", () => {
    for (const kind of ["claude", "ollama", "openai"] as const) {
      const p = makeProvider({ kind, apiKey: kind === "claude" ? "sk-ant-TEST-KEY-do-not-leak-0123456789" : "", model: "m3b", baseUrl: "http://ollama:11434" }); // scan-secrets:ignore
      expect(typeof p.complete, kind).toBe("function");
    }
  });
});

// ───────────────────────────────────────── the real socket path ─────────────────────────────────────────

describe("over a real socket to 127.0.0.1", () => {
  let server: http.Server;
  let port = 0;
  const seen: { method?: string; url?: string; auth?: string; body: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers["authorization"], body: Buffer.concat(chunks).toString() });
        if (req.url === "/api/tags") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ models: [{ name: "llama3.2:3b" }] }));
        } else if (req.url === "/api/chat") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(ollamaAnswer));
        } else if (req.url === "/v1/chat/completions") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(openaiAnswer));
        } else if (req.url === "/redirect") {
          res.statusCode = 302;
          res.setHeader("location", "http://169.254.169.254/latest/meta-data");
          res.end();
        } else {
          res.statusCode = 404;
          res.end("nope");
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("Ollama: the real transport sends the JSON and reads the answer", async () => {
    const out = await createOllamaProvider({ baseUrl: `http://127.0.0.1:${port}`, model: "llama3.2:3b", queue: fresh() }).complete(request);
    expect(out.text).toBe("الجواب");
    const hit = seen.find((s) => s.url === "/api/chat")!;
    expect(hit.method).toBe("POST");
    expect(JSON.parse(hit.body).model).toBe("llama3.2:3b");
  });

  it("the gateway: the Bearer header arrives, the path is fixed", async () => {
    const out = await createOpenAiCompatProvider({ baseUrl: `http://127.0.0.1:${port}`, model: "m3b", apiKey: KEY, queue: fresh() }).complete(request);
    expect(out.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    const hit = seen.find((s) => s.url === "/v1/chat/completions")!;
    expect(hit.auth).toBe(`Bearer ${KEY}`);
  });

  it("«اختبر الاتصال» works end to end over the socket", async () => {
    const r = await probeOllama({ baseUrl: `http://127.0.0.1:${port}`, model: "llama3.2:3b", queue: fresh() });
    expect(r).toMatchObject({ reachable: true, models: ["llama3.2:3b"], installed: true, ping: { ok: true } });
  });

  it("a name that resolves to loopback (localhost) is allowed and a closed port is «down»", async () => {
    const ok = await probeOllama({ baseUrl: `http://localhost:${port}`, model: null, queue: fresh() }).catch((e: unknown) => e);
    // localhost may resolve to ::1 only on some machines; either it works or the service «is not there», never «forbidden»
    if (ok instanceof AiProviderError) expect(ok.key).toBe("assistant.err_local_down");
    else expect(ok).toMatchObject({ reachable: true });
    const closed = await probeOllama({ baseUrl: "http://127.0.0.1:1", model: null, queue: fresh() }).catch((e: unknown) => e);
    expect((closed as AiProviderError).key).toBe("assistant.err_local_down");
  });

  it("a redirect is never followed (the Location is a metadata address): it is a plain refusal", async () => {
    setLocalTransportForTests(null);
    const { callLocal, targetOf } = await import("@/server/ai/local-transport");
    const res = await callLocal({ target: targetOf(`http://127.0.0.1:${port}`), method: "GET", path: "/redirect", timeoutMs: 5_000 });
    expect(res.status).toBe(302);
    const before = seen.length;
    expect(seen.slice(before)).toEqual([]);
    // and the adapters turn that into a key, not into a second request
    const err = await probeOllama({ baseUrl: `http://127.0.0.1:${port}`, model: null, queue: fresh(), transport: async () => res }).catch((e: unknown) => e);
    expect((err as AiProviderError).key).toBe("assistant.err_request");
  });
});
