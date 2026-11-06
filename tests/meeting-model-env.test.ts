import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LocalQueue } from "@/server/ai/local-queue";
import { createOpenAiCompatProvider } from "@/server/ai/openai-compat-provider";
import type { LocalHttpRequest, LocalTransport } from "@/server/ai/local-transport";
import { meetingModelEnv } from "@/server/services/meeting-model-env";

/** «نموذج الاجتماعات»: MEETING_LLM_URL / _MODEL / _API_KEY — a fast model for the meeting assistant, all three or none, judged strictly. */

const KEY = "gsk_meeting-env-KEY-0123456789abcdef"; // scan-secrets:ignore
const GOOD = { MEETING_LLM_URL: "https://api.groq.com/openai/v1/chat/completions", MEETING_LLM_MODEL: "llama-3.3-70b-versatile", MEETING_LLM_API_KEY: KEY };

describe("the variables of the server", () => {
  it("all three valid: the origin, the path, the model and the key", () => {
    expect(meetingModelEnv(GOOD)).toEqual({ origin: "https://api.groq.com", path: "/openai/v1/chat/completions", model: "llama-3.3-70b-versatile", key: KEY });
    expect(meetingModelEnv({ ...GOOD, MEETING_LLM_URL: " https://api.cerebras.ai/v1/chat/completions/ ", MEETING_LLM_MODEL: "openai/gpt-oss-120b" })).toMatchObject({ origin: "https://api.cerebras.ai", path: "/v1/chat/completions", model: "openai/gpt-oss-120b" });
  });

  it("nothing set, or any one missing: off (the chosen model answers as before)", () => {
    expect(meetingModelEnv({})).toBeNull();
    for (const drop of ["MEETING_LLM_URL", "MEETING_LLM_MODEL", "MEETING_LLM_API_KEY"] as const) expect(meetingModelEnv({ ...GOOD, [drop]: "  " }), drop).toBeNull();
  });

  it("an address that is not a plain https chat endpoint on a public name is refused", () => {
    const bad = [
      "http://api.groq.com/openai/v1/chat/completions",
      "https://api.groq.com/openai/v1",
      "https://api.groq.com/chat/completions/../x",
      "https://api.groq.com/v1/chat/completions?key=1",
      "https://api.groq.com/v1/chat/completions#x",
      "https://user:pw@api.groq.com/v1/chat/completions",
      "https://8.8.8.8/v1/chat/completions",
      "https://169.254.169.254/v1/chat/completions",
      "https://localhost/v1/chat/completions",
      "https://litellm/v1/chat/completions",
      "https://metadata.google.internal/v1/chat/completions",
      "https://api.groq.com/a b/chat/completions",
      "not a url",
    ];
    for (const url of bad) expect(meetingModelEnv({ ...GOOD, MEETING_LLM_URL: url }), url).toBeNull();
  });

  it("a bad model name or key counts as not set", () => {
    for (const m of ["../x", "a b", "x".repeat(200)]) expect(meetingModelEnv({ ...GOOD, MEETING_LLM_MODEL: m }), m).toBeNull();
    for (const k of ["short", "has space in it 123", "ب".repeat(12)]) expect(meetingModelEnv({ ...GOOD, MEETING_LLM_API_KEY: k }), k).toBeNull();
  });
});

describe("the adapter sends to the path of that service", () => {
  it("chatPath replaces /v1/chat/completions, the key goes in the one header, and the answer is read", async () => {
    let seen: LocalHttpRequest | null = null;
    const transport: LocalTransport = async (req) => {
      seen = req;
      return { status: 200, text: JSON.stringify({ choices: [{ message: { content: "أهلًا بكم." } }], usage: { prompt_tokens: 10, completion_tokens: 3 } }) };
    };
    const out = await createOpenAiCompatProvider({
      baseUrl: "https://api.groq.com",
      model: "llama-3.3-70b-versatile",
      apiKey: KEY,
      external: true,
      chatPath: "/openai/v1/chat/completions",
      transport,
      queue: new LocalQueue(2, 5_000),
    }).complete({ system: "s", messages: [{ role: "user", content: "مرحبا" }], tools: [], maxTokens: 220 });
    expect(out.text).toBe("أهلًا بكم.");
    const req = seen as LocalHttpRequest | null;
    expect(req?.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(req?.headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(req?.external).toBe(true);
  });
});

describe("the meeting answer", () => {
  const source = readFileSync("src/server/calls/assistant-agent.ts", "utf8");

  it("tries the fast model first and falls back to the chosen one, logging only the reason", () => {
    expect(source).toContain("meetingModelEnv()");
    expect(source).toContain("assistant_meeting.fast_failed");
    expect(source).toMatch(/reason: err instanceof AiProviderError \? err\.key : "unknown"/);
  });

  it("the key never reaches a log line or an audit row", () => {
    const logLines = source.split("\n").filter((l) => /log\.(warn|info|error)|auditLog\.create/.test(l));
    for (const l of logLines) expect(l).not.toMatch(/fast\.key|apiKey/);
  });
});
