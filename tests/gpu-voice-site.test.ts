import * as React from "react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The components are TSX; under vitest their JSX compiles to React.createElement (global React).
(globalThis as { React?: typeof React }).React = React;

/**
 * The third transcription source: «برنامج الصوت على سيرفري» (the voice agent the site already talks to). The real service and the real settings rules,
 * with the database stood in for and the socket to the agent replaced by a fake transport. The rule against the REAL database is in
 * tests/db/voice-server-source.test.ts.
 */
const world = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  writes: [] as Record<string, unknown>[],
}));

vi.mock("@/server/db", () => {
  const aiSettings = {
    findUnique: vi.fn(async () => world.row),
    upsert: vi.fn(async (args: { update: Record<string, unknown> }) => {
      world.writes.push(args.update);
      world.row = { ...(world.row ?? {}), ...args.update };
      return world.row;
    }),
  };
  const tx = { aiSettings, auditLog: { create: vi.fn(async () => ({})) } };
  return { db: { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } };
});

import { AR } from "@/lib/i18n/dict";
import { I18nProvider } from "@/lib/i18n";
import { canChooseVoiceServer, cpuHelpKey, transcriptButtonReason, type VoiceAgentState, type VoiceServerStatus } from "@/lib/voice-server";
import { HEALTH_SIGNED_TEXT, noteSignedText, signBody, verifySignature } from "@/server/calls/agent-link";
import { agentSettings, signBody as signBodyFromAssistant } from "@/server/calls/assistant-agent";
import { LocalQueue } from "@/server/ai/local-queue";
import { setLocalTransportForTests, type LocalHttpRequest, type LocalTransport } from "@/server/ai/local-transport";
import { readVoiceAgent, voiceAgentTarget } from "@/server/services/voice-server";
import { resolveTranscribeServer, transcribeBytes, VoiceTranscriptError } from "@/server/services/voice-transcript";
import { updateSettings } from "@/server/services/owner-assistant-settings";
import { VoiceServerView } from "@/components/owner-assistant/voice-server-card";
import { SettingsForm } from "@/components/owner-assistant/settings-form";
import { DEFAULT_SETTINGS } from "@/server/services/owner-assistant-settings";

const SECRET = "test-agent-secret-0123456789abcdef";
const ENV = { VOICE_AGENT_URL: "http://voice-agent:8080", VOICE_AGENT_SECRET: SECRET };
const AUDIO = { bytes: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]), mime: "audio/webm;codecs=opus" };

function fake(answer: { status: number; text: string } | Error) {
  const seen: LocalHttpRequest[] = [];
  const transport: LocalTransport = async (request) => {
    seen.push(request);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { seen, transport };
}
const json = (body: unknown, status = 200) => ({ status, text: JSON.stringify(body) });
const STT = { door: 1, ready: true, device: "cpu", gpuFound: false, gpu: null, model: "small", compute: "int8", requested: "large-v3", setting: "auto", reason: "no_gpu", fallback: false, meetings: "local" };
const healthy = (stt: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => json({ ok: true, meetings: 0, secretOk: true, stt: { ...STT, ...stt }, ...over });

describe("the two sides sign alike (the same vectors as voice-agent/test_notes.py)", () => {
  const sha = createHash("sha256").update("abc").digest("hex");

  it("a voice note: the hash of the audio and the language, under the door's own prefix", () => {
    expect(noteSignedText(sha, "ar")).toBe(`transcribe:${sha}:ar`);
    expect(noteSignedText(sha, null)).toBe(`transcribe:${sha}:`);
    expect(signBody(SECRET, 1800000000, noteSignedText(sha, "ar"))).toBe("87fc0ceea2108d232326eed3c311ea181da7325c283402462516c3d5660d6a8a");
  });

  it("a signed look at /health", () => {
    expect(signBody(SECRET, 1800000000, HEALTH_SIGNED_TEXT)).toBe("4418da527a3be7c7aa8ffc5fc6002c3f3f1955341ab208d01845cc07a0107c71");
  });

  it("the old names still come from the assistant's file (one scheme, one place)", () => {
    expect(signBodyFromAssistant).toBe(signBody);
    expect(agentSettings(ENV)).toEqual({ url: "http://voice-agent:8080", secret: SECRET });
  });
});

describe("where the agent may be for a recording", () => {
  it("uses the two variables the site already has, and only an address inside the server", () => {
    expect(voiceAgentTarget({})).toEqual({ ok: false, state: "not_configured" });
    expect(voiceAgentTarget({ ...ENV, VOICE_AGENT_SECRET: "short" })).toEqual({ ok: false, state: "not_configured" });
    expect(voiceAgentTarget({ ...ENV, VOICE_AGENT_URL: "https://voice.example.com" })).toEqual({ ok: false, state: "public_address" });
    expect(voiceAgentTarget({ ...ENV, VOICE_AGENT_URL: "http://8.8.8.8:8080" })).toEqual({ ok: false, state: "public_address" });
    expect(voiceAgentTarget({ ...ENV, VOICE_AGENT_URL: "http://voice-agent:8080/" })).toEqual({ ok: true, origin: "http://voice-agent:8080", secret: SECRET });
  });
});

describe("the live state read from /health", () => {
  const read = (answer: { status: number; text: string } | Error, env: Record<string, string> = ENV) => {
    const f = fake(answer);
    return readVoiceAgent(env, { transport: f.transport }).then((state) => ({ state, seen: f.seen }));
  };

  it("asks /health with a signature of the shared secret, and never sends the secret itself", async () => {
    const { seen } = await read(healthy());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("GET");
    expect(seen[0]!.url).toBe("http://voice-agent:8080/health");
    expect(verifySignature(SECRET, seen[0]!.headers["x-agent-timestamp"] ?? null, seen[0]!.headers["x-agent-signature"] ?? null, HEALTH_SIGNED_TEXT)).toBe(true);
    expect(JSON.stringify(seen[0]!.headers)).not.toContain(SECRET);
  });

  it("asks nobody while the site does not know where the program is", async () => {
    const { state, seen } = await read(healthy(), {});
    expect(state).toEqual({ state: "not_configured" });
    expect(seen).toHaveLength(0);
  });

  it("tells apart: gone, too old, another secret, still loading", async () => {
    expect((await read(new Error("ECONNREFUSED"))).state).toEqual({ state: "unreachable" });
    expect((await read({ status: 502, text: "bad gateway" })).state).toEqual({ state: "unreachable" });
    expect((await read({ status: 200, text: "<html>" })).state).toEqual({ state: "unreachable" });
    // today's agent: no «stt» in its answer, so no door
    expect((await read(json({ ok: true, meetings: 0 }))).state).toEqual({ state: "old" });
    expect((await read(healthy({}, { secretOk: false }))).state).toEqual({ state: "wrong_secret" });
    expect((await read(json({ ok: true, secretOk: true, stt: { door: 1, ready: false, meetings: "local" } }))).state).toEqual({ state: "loading", hostedMeetings: false });
  });

  it("running on the processor or on the card, with the model and why", async () => {
    expect((await read(healthy())).state).toEqual({ state: "cpu", model: "small", compute: "int8", requested: "large-v3", gpuFound: false, gpu: null, reason: "no_gpu", fallback: false, hostedMeetings: false });
    const gpu = { name: "NVIDIA GeForce RTX 3060", memoryMb: 12288 };
    expect((await read(healthy({ device: "cuda", gpuFound: true, gpu, model: "medium", compute: "int8_float16", reason: "gpu_memory", fallback: true, meetings: "hosted" }))).state).toEqual({
      state: "gpu",
      model: "medium",
      compute: "int8_float16",
      requested: "large-v3",
      gpuFound: true,
      gpu,
      reason: "gpu_memory",
      fallback: true,
      hostedMeetings: true,
    });
  });

  it("takes nothing odd from the answer: unknown reasons and strange names are dropped", async () => {
    const { state } = await read(healthy({ model: "<script>", reason: "rm -rf", gpu: { name: 5, memoryMb: "many" } }));
    expect(state).toMatchObject({ state: "cpu", model: "", reason: "", gpu: null });
  });
});

describe("the source «برنامج الصوت على سيرفري»", () => {
  beforeEach(() => {
    world.row = { keyLast4: null, model: "m", dailyLimit: 1, monthlyTokenBudget: 1, ownerProvider: "claude", chatProvider: "claude", transcribeSource: "agent", transcribeBaseUrl: "http://stt:9000", transcribeModel: "whisper-1", gatewayBaseUrl: null };
  });

  it("needs no address and no key from the owner: the agent's own variables, Arabic by default, and no filter (it stays on his server)", async () => {
    expect(await resolveTranscribeServer("o1", ENV)).toEqual({ origin: "http://voice-agent:8080", model: "", language: "ar", agent: { secret: SECRET } });
  });

  it("with the variables missing or an outside address there is no service, even when the server has the old variable: the choice is explicit", async () => {
    expect(await resolveTranscribeServer("o1", { TRANSCRIBE_URL: "http://whisper:8000" })).toBeNull();
    expect(await resolveTranscribeServer("o1", { ...ENV, VOICE_AGENT_URL: "https://voice.example.com" })).toBeNull();
  });

  it("the other sources are as they were", async () => {
    world.row = { ...world.row, transcribeSource: "local" };
    expect(await resolveTranscribeServer("o1", ENV)).toEqual({ origin: "http://stt:9000", model: "whisper-1", language: "ar" });
    world.row = { ...world.row, transcribeSource: null };
    expect(await resolveTranscribeServer("o1", ENV)).toBeNull();
    expect(await resolveTranscribeServer("o1", { ...ENV, TRANSCRIBE_URL: "http://whisper:8000" })).toMatchObject({ origin: "http://whisper:8000" });
  });
});

describe("one voice note to the agent", () => {
  const server = { origin: "http://voice-agent:8080", model: "", language: "ar" as string | null, agent: { secret: SECRET } };

  it("sends the recording itself to the signed door, the signature covering its hash and the language", async () => {
    const f = fake(json({ text: "  بكرا الساعة عشرة " }));
    expect(await transcribeBytes(server, AUDIO, { transport: f.transport })).toBe("بكرا الساعة عشرة");
    const req = f.seen[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://voice-agent:8080/transcribe-note");
    expect([...(req.rawBody as Uint8Array)]).toEqual([...AUDIO.bytes]);
    expect(req.headers["content-type"]).toBe("application/octet-stream");
    expect(req.headers["authorization"]).toBeUndefined();
    const sha = createHash("sha256").update(AUDIO.bytes).digest("hex");
    expect(req.headers["x-agent-audio-sha256"]).toBe(sha);
    expect(req.headers["x-agent-language"]).toBe("ar");
    expect(verifySignature(SECRET, req.headers["x-agent-timestamp"] ?? null, req.headers["x-agent-signature"] ?? null, noteSignedText(sha, "ar"))).toBe(true);
    expect(req.external).toBeUndefined();
  });

  it("«auto» lets the agent hear which language it is", async () => {
    const f = fake(json({ text: "hi" }));
    await transcribeBytes({ ...server, language: null }, AUDIO, { transport: f.transport });
    expect(f.seen[0]!.headers["x-agent-language"]).toBe("");
  });

  it("is signed when it is SENT, not when it started waiting (a signature lives one minute)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
      const queue = new LocalQueue(3, 10 * 60_000);
      let release: () => void = () => undefined;
      const held = queue.run(() => new Promise<void>((resolve) => (release = resolve)));
      const f = fake(json({ text: "x" }));
      const waiting = transcribeBytes(server, AUDIO, { transport: f.transport, queue });
      await vi.advanceTimersByTimeAsync(90_000);
      release();
      await held;
      await waiting;
      expect(Number(f.seen[0]!.headers["x-agent-timestamp"])).toBe(Math.floor(Date.now() / 1000));
    } finally {
      vi.useRealTimers();
    }
  });

  it("the agent's refusals become the same Arabic sentences", async () => {
    for (const [status, key] of [
      [413, "voiceTranscript.err_big"],
      [422, "voiceTranscript.err_big"],
      [429, "voiceTranscript.err_busy"],
      [503, "voiceTranscript.err_busy"],
      [504, "voiceTranscript.err_timeout"],
      [415, "voiceTranscript.err_failed"],
      [404, "voiceTranscript.err_failed"],
      [500, "voiceTranscript.err_failed"],
    ] as const) {
      const err = await transcribeBytes(server, AUDIO, { transport: fake({ status, text: "secret detail" }).transport }).catch((e: unknown) => e);
      expect(err, String(status)).toBeInstanceOf(VoiceTranscriptError);
      expect((err as VoiceTranscriptError).key, String(status)).toBe(key);
    }
    const down = await transcribeBytes(server, AUDIO, { transport: fake(new Error("ECONNREFUSED")).transport }).catch((e: unknown) => e);
    expect((down as VoiceTranscriptError).key).toBe("voiceTranscript.err_down");
  });
});

describe("choosing it is allowed only when the agent can really do it", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of Object.keys(ENV)) saved[k] = process.env[k];
    Object.assign(process.env, ENV);
    world.row = { keyLast4: null, model: "m", dailyLimit: 1, monthlyTokenBudget: 1, ownerProvider: "claude", chatProvider: "claude", transcribeSource: null, gatewayBaseUrl: null, transcribeBaseUrl: null };
    world.writes.length = 0;
  });
  afterEach(() => {
    setLocalTransportForTests(null);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const choose = () => updateSettings({ orgId: "o1", userId: "u1" }, { transcribeSource: "agent" });
  const refusalOf = async () => {
    const err = (await choose().then(
      () => null,
      (e: unknown) => e,
    )) as { issues?: { path: string; message: string }[] } | null;
    return err?.issues?.[0]?.message ?? null;
  };

  it("refuses an agent that is gone, too old or has another secret, each with its own sentence, and saves nothing", async () => {
    for (const [answer, key] of [
      [new Error("ECONNREFUSED"), "gpuVoice.refused.unreachable"],
      [json({ ok: true, meetings: 0 }), "gpuVoice.refused.old"],
      [healthy({}, { secretOk: false }), "gpuVoice.refused.wrong_secret"],
    ] as const) {
      setLocalTransportForTests(fake(answer).transport);
      expect(await refusalOf(), key).toBe(key);
      expect(AR[key], key).toBeTruthy();
    }
    expect(world.writes).toEqual([]);
  });

  it("allows it on the processor too (slower and less accurate, and the card says so)", async () => {
    setLocalTransportForTests(fake(healthy()).transport);
    expect((await choose()).transcribeSource).toBe("agent");
  });

  it("saving the whole screen again while it is already chosen does not ask the agent, so a stopped agent never blocks other settings", async () => {
    world.row = { ...world.row, transcribeSource: "agent" };
    const f = fake(new Error("ECONNREFUSED"));
    setLocalTransportForTests(f.transport);
    await updateSettings({ orgId: "o1", userId: "u1" }, { transcribeSource: "agent", dailyLimit: 5 });
    expect(f.seen).toHaveLength(0);
    // and it can always be turned off
    expect((await updateSettings({ orgId: "o1", userId: "u1" }, { transcribeSource: null })).transcribeSource).toBeNull();
  });
});

// ───────────────────────────────────────── the owner's card ─────────────────────────────────────────

const cpu: VoiceAgentState = { state: "cpu", model: "small", compute: "int8", requested: "large-v3", gpuFound: false, gpu: null, reason: "no_gpu", fallback: false, hostedMeetings: false };
const gpuState: VoiceAgentState = { state: "gpu", model: "large-v3", compute: "int8_float16", requested: "large-v3", gpuFound: true, gpu: { name: "NVIDIA GeForce RTX 3060", memoryMb: 12288 }, reason: "", fallback: false, hostedMeetings: false };
const statusOf = (over: Partial<VoiceServerStatus> = {}): VoiceServerStatus => ({ agent: cpu, source: null, transcriptOn: true, serviceReady: false, ...over });
const view = (status: VoiceServerStatus | null, extra: { failed?: boolean; busy?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(I18nProvider, { initial: "ar", children: createElement(VoiceServerView, { status, failed: false, busy: false, onToggle: () => {}, onRefresh: () => {}, ...extra }) }),
  );
/** The attribute, not the «disabled:» classes of the button set. */
const DISABLED = ' disabled=""';
const buttonOf = (markup: string) => /<button[^>]*data-testid="voice-server-toggle"[^>]*>([\s\S]*?)<\/button>/.exec(markup);

describe("the rules of the card", () => {
  it("turning on needs a reachable agent that has the door, on the processor or the card, even while it is still loading", () => {
    for (const state of ["cpu", "gpu", "loading"] as const) expect(canChooseVoiceServer({ state } as VoiceAgentState), state).toBe(true);
    for (const state of ["not_configured", "public_address", "unreachable", "old", "wrong_secret"] as const) expect(canChooseVoiceServer({ state } as VoiceAgentState), state).toBe(false);
  });

  it("says why «اكتب النص» is not in the chat", () => {
    expect(transcriptButtonReason(statusOf({ transcriptOn: false }))).toBe("switch_off");
    expect(transcriptButtonReason(statusOf())).toBe("no_source");
    expect(transcriptButtonReason(statusOf({ source: "local" }))).toBe("source_broken");
    expect(transcriptButtonReason(statusOf({ source: "agent", serviceReady: true }))).toBe("shown");
    expect(transcriptButtonReason(statusOf({ serviceReady: true }))).toBe("shown"); // the server's old variable
  });

  it("every reason for the processor has its own plain sentence", () => {
    for (const reason of ["", "forced_cpu", "no_gpu", "gpu_driver", "gpu_libs", "gpu_memory", "gpu_compute", "gpu_failed", "gpu_runtime"] as const) {
      expect(AR[cpuHelpKey(reason)], reason).toBeTruthy();
    }
  });
});

describe("the settings screen", () => {
  const screen = (source: VoiceServerStatus["source"]) =>
    renderToStaticMarkup(
      createElement(I18nProvider, {
        initial: "ar",
        children: createElement(SettingsForm, { settings: { ...DEFAULT_SETTINGS, transcribeSource: source }, usage: { day: "2026-11-27", requestsToday: 0, dailyLimit: 50, tokensThisMonth: 0, monthlyTokenBudget: 1 }, models: [DEFAULT_SETTINGS.model] }),
      }),
    );

  it("draws the card above the list of sources, and the list knows the program, so «حفظ» never drops the choice", () => {
    const markup = screen("agent");
    expect(markup.indexOf('data-testid="voice-server"')).toBeGreaterThan(-1);
    expect(markup.indexOf('data-testid="voice-server"')).toBeLessThan(markup.indexOf('data-testid="ai-transcribe"'));
    expect(markup).toMatch(/<option value="agent" selected="">/);
    // the program chooses its own model: no address and no name to type
    expect(markup).not.toContain('data-testid="ai-transcribe-url"');
    expect(markup).not.toContain('data-testid="ai-transcribe-model"');
  });

  it("the card reads again after every «حفظ», so its button never acts on a choice the screen has since changed", () => {
    // a render on the server runs no effect and no click, so the wiring is pinned in the source
    const form = readFileSync("src/components/owner-assistant/settings-form.tsx", "utf8");
    const save = form.slice(form.indexOf("const save = async"), form.indexOf("const field ="));
    expect(save).toContain("setSavedTimes((n) => n + 1)");
    expect(save.indexOf("await apiPut(")).toBeLessThan(save.indexOf("setSavedTimes("));
    expect(form).toContain("<VoiceServerCard savedTimes={savedTimes}");
    expect(readFileSync("src/components/owner-assistant/voice-server-card.tsx", "utf8")).toContain("[load, savedTimes]");
  });

  it("the other two sources keep their fields", () => {
    expect(screen("local")).toContain('data-testid="ai-transcribe-model"');
    expect(screen("gateway")).toContain('data-testid="ai-transcribe-model"');
  });
});

describe("the owner's card", () => {
  it("has one button, «شغّل تحويل الصوت لنص على السيرفر», and says the processor is slower and less accurate, with the steps for the card", () => {
    const markup = view(statusOf());
    expect(markup.match(/data-testid="voice-server-toggle"/g)).toHaveLength(1);
    expect(buttonOf(markup)?.[1]).toBe("شغّل تحويل الصوت لنص على السيرفر");
    expect(buttonOf(markup)?.[0]).not.toContain(DISABLED);
    expect(markup).toContain('data-state="cpu"');
    expect(markup).toContain(AR["gpuVoice.cpu.warn"]);
    expect(markup).toContain(AR["gpuVoice.step.driver"]);
    expect(markup).toContain(AR["gpuVoice.step.compose"]);
    expect(markup).toContain(AR["gpuVoice.step.redeploy"]);
    expect(markup).toContain("docker-compose.gpu.yml");
    expect(AR["gpuVoice.cpu.warn"]).toMatch(/⚠️[\s\S]*أبطأ[\s\S]*أقل دقة/);
    expect(markup).toContain(AR["gpuVoice.why.no_source"]);
  });

  it("on the card it names the card, its memory and the model, and shows no steps", () => {
    const markup = view(statusOf({ agent: gpuState, source: "agent", serviceReady: true }));
    expect(markup).toContain('data-state="gpu"');
    expect(markup).toContain("NVIDIA GeForce RTX 3060");
    expect(markup).toContain("large-v3");
    expect(markup).toContain(AR["gpuVoice.model.large-v3"]);
    expect(markup).not.toContain(AR["gpuVoice.step.driver"]);
    expect(buttonOf(markup)?.[1]).toBe(AR["gpuVoice.off_button"]);
    expect(markup).toContain(AR["gpuVoice.why.shown"]);
  });

  it("a smaller model than asked, and meetings sent to an outside service, each come with a warning and its fix", () => {
    const markup = view(statusOf({ agent: { ...gpuState, model: "medium", fallback: true, reason: "gpu_memory", hostedMeetings: true } as VoiceAgentState }));
    for (const key of ["gpuVoice.fallback.warn", "gpuVoice.fallback.fix", "gpuVoice.hosted.warn", "gpuVoice.hosted.fix"]) {
      expect(markup, key).toContain(AR[key]);
    }
  });

  it("an old, missing or unreachable agent is said plainly and the button waits", () => {
    for (const state of ["old", "unreachable", "not_configured", "public_address", "wrong_secret"] as const) {
      const markup = view(statusOf({ agent: { state } }));
      expect(markup, state).toContain(AR[`gpuVoice.${state}.warn`]);
      expect(markup, state).toContain(AR[`gpuVoice.${state}.fix`]);
      expect(AR[`gpuVoice.${state}.warn`], state).toMatch(/^⚠️/);
      expect(AR[`gpuVoice.${state}.fix`], state).toMatch(/^🔧/);
      expect(buttonOf(markup)?.[0], state).toContain(DISABLED);
    }
  });

  it("while it is chosen it can always be turned off, even with the agent gone", () => {
    const markup = view(statusOf({ agent: { state: "unreachable" }, source: "agent", serviceReady: true }));
    expect(buttonOf(markup)?.[0]).not.toContain(DISABLED);
    expect(buttonOf(markup)?.[1]).toBe(AR["gpuVoice.off_button"]);
  });

  it("warns that pressing replaces another chosen service, and says when it is checking or could not check", () => {
    expect(view(statusOf({ source: "gateway", serviceReady: true }))).toContain(AR["gpuVoice.replaces"]);
    expect(view(null)).toContain(AR["gpuVoice.checking"]);
    expect(view(null, { failed: true })).toContain(AR["gpuVoice.check_failed"]);
  });

  it("its words are Arabic only, apart from the names the owner must match outside this app", () => {
    const own = Object.entries(AR).filter(([k]) => k.startsWith("gpuVoice."));
    expect(own.length).toBeGreaterThan(30);
    for (const [key, value] of own) expect(value.replace(/Coolify|\{[a-z]+\}/g, ""), key).not.toMatch(/[A-Za-z]{2,}/);
  });
});
