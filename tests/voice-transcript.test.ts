import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AR } from "@/lib/i18n/dict";
import { ECONOMY_FORCED_OFF, FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { LocalQueue } from "@/server/ai/local-queue";
import type { LocalHttpRequest, LocalTransport } from "@/server/ai/local-transport";
import { MAX_TRANSCRIPT_CHARS, multipartBody, transcribeBytes, transcribeServer, VoiceTranscriptError } from "@/server/services/voice-transcript";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const AUDIO = { bytes: new Uint8Array([1, 2, 3, 4, 5]), mime: "audio/webm;codecs=opus" };
const SERVER = { origin: "http://whisper:8000", model: "whisper-1", language: "ar" };

function fake(answer: { status: number; text: string } | Error) {
  const seen: LocalHttpRequest[] = [];
  const transport: LocalTransport = async (request) => {
    seen.push(request);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { seen, transport };
}

describe("«كتابة نص الرسالة الصوتية»: where the service lives", () => {
  it("is only the owner's own machine: nothing set, a public address or a path means no service", () => {
    expect(transcribeServer({})).toBeNull();
    expect(transcribeServer({ TRANSCRIBE_URL: "   " })).toBeNull();
    expect(transcribeServer({ TRANSCRIBE_URL: "https://api.openai.com" })).toBeNull();
    expect(transcribeServer({ TRANSCRIBE_URL: "http://8.8.8.8:8000" })).toBeNull();
    expect(transcribeServer({ TRANSCRIBE_URL: "http://169.254.169.254" })).toBeNull();
    expect(transcribeServer({ TRANSCRIBE_URL: "http://whisper:8000/v1/audio" })).toBeNull();
    expect(transcribeServer({ TRANSCRIBE_URL: "http://whisper:8000" })).toEqual(SERVER);
    expect(transcribeServer({ TRANSCRIBE_URL: "http://192.168.1.20:9000/" })).toMatchObject({ origin: "http://192.168.1.20:9000" });
  });

  it("the model defaults to whisper-1, the language to Arabic (empty: let the service decide) and nonsense is refused", () => {
    const base = { TRANSCRIBE_URL: "http://whisper:8000" };
    expect(transcribeServer({ ...base, TRANSCRIBE_MODEL: "Systran/faster-whisper-small" })).toMatchObject({ model: "Systran/faster-whisper-small" });
    expect(transcribeServer({ ...base, TRANSCRIBE_LANGUAGE: "" })).toMatchObject({ language: null });
    expect(transcribeServer({ ...base, TRANSCRIBE_LANGUAGE: "EN" })).toMatchObject({ language: "en" });
    expect(transcribeServer({ ...base, TRANSCRIBE_LANGUAGE: "arabic!" })).toBeNull();
    expect(transcribeServer({ ...base, TRANSCRIBE_MODEL: "a b; rm" })).toBeNull();
  });
});

describe("the request and the answer", () => {
  it("the form carries the model, the language and the recording, with a boundary nothing inside can end early", () => {
    const form = multipartBody({ model: "whisper-1", language: "ar" }, AUDIO, "BOUND");
    const text = Buffer.from(form.bytes).toString("latin1");
    expect(form.contentType).toBe("multipart/form-data; boundary=BOUND");
    expect(text).toContain('name="model"\r\n\r\nwhisper-1\r\n');
    expect(text).toContain('name="language"\r\n\r\nar\r\n');
    expect(text).toContain('name="file"; filename="voice.webm"\r\ncontent-type: audio/webm\r\n\r\n\u0001\u0002\u0003\u0004\u0005\r\n--BOUND--\r\n');
  });

  it("posts to the OpenAI path on the judged origin and returns the trimmed text", async () => {
    const f = fake({ status: 200, text: JSON.stringify({ text: "  مرحبا شباب  " }) });
    expect(await transcribeBytes(SERVER, AUDIO, { transport: f.transport, boundary: "B" })).toBe("مرحبا شباب");
    expect(f.seen).toHaveLength(1);
    const req = f.seen[0] as LocalHttpRequest;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://whisper:8000/v1/audio/transcriptions");
    expect(req.headers["content-type"]).toBe("multipart/form-data; boundary=B");
    expect(req.body).toBeUndefined();
    expect(req.rawBody?.byteLength).toBeGreaterThan(5);
  });

  it("an over-long text is cut and a silent one comes back empty", async () => {
    const long = fake({ status: 200, text: JSON.stringify({ text: "ا".repeat(MAX_TRANSCRIPT_CHARS + 50) }) });
    expect((await transcribeBytes(SERVER, AUDIO, { transport: long.transport })).length).toBe(MAX_TRANSCRIPT_CHARS);
    const silent = fake({ status: 200, text: JSON.stringify({ text: "   " }) });
    expect(await transcribeBytes(SERVER, AUDIO, { transport: silent.transport })).toBe("");
  });

  it("a failure is a dictionary key and never the service's words, its address or the audio", async () => {
    const cases: [{ status: number; text: string } | Error, string][] = [
      [{ status: 500, text: "boom http://whisper:8000 secret" }, "voiceTranscript.err_failed"],
      [{ status: 200, text: "<html>not json</html>" }, "voiceTranscript.err_failed"],
      [{ status: 404, text: "" }, "voiceTranscript.err_failed"],
      [new Error("ECONNREFUSED whisper:8000"), "voiceTranscript.err_down"],
    ];
    for (const [answer, key] of cases) {
      const f = fake(answer);
      const err = await transcribeBytes(SERVER, AUDIO, { transport: f.transport }).catch((e: unknown) => e);
      expect(err, key).toBeInstanceOf(VoiceTranscriptError);
      expect((err as VoiceTranscriptError).key).toBe(key);
      expect((err as Error).message).toBe(key);
      expect(AR[key], key).toBeTruthy();
    }
  });

  it("a busy machine is told so instead of piling work up", async () => {
    const queue = new LocalQueue(0, 1_000);
    let release: () => void = () => undefined;
    const held = queue.run(() => new Promise<void>((resolve) => (release = resolve)));
    const f = fake({ status: 200, text: JSON.stringify({ text: "x" }) });
    const err = await transcribeBytes(SERVER, AUDIO, { transport: f.transport, queue }).catch((e: unknown) => e);
    expect((err as VoiceTranscriptError).key).toBe("voiceTranscript.err_busy");
    expect(f.seen).toHaveLength(0);
    release();
    await held;
  });
});

describe("the switch, the words and the screen", () => {
  it("is off by default (the audio leaves the app), has its words, and economy mode does not own it", () => {
    expect(FEATURES).toContain("voiceTranscript");
    expect(FEATURE_DEFAULTS.voiceTranscript).toBe(false);
    expect(AR["features.voiceTranscript.name"]).toBeTruthy();
    expect(AR["features.voiceTranscript.hint"]).toContain("⚠️");
    expect(AR["features.voiceTranscript.hint"]).toContain("🔧");
    expect(ECONOMY_FORCED_OFF as readonly string[]).not.toContain("voiceTranscript");
  });

  it("every key the screen and the route can show has its Arabic", () => {
    for (const key of ["button", "busy_button", "label", "hide", "show", "not_found", "err_not_configured", "err_down", "err_busy", "err_timeout", "err_failed", "err_big", "err_empty"]) {
      expect(AR[`voiceTranscript.${key}`], key).toBeTruthy();
    }
  });

  it("the route asks the service, the log draws the button only when the server says so, and the text sits under the note", () => {
    const route = read("src/app/api/chat/attachments/[id]/transcript/route.ts");
    expect(route).toContain("export async function POST");
    expect(route).toContain("transcribeAttachment(actor, params.id)");
    expect(read("src/server/chat/topics.ts")).toContain('voiceTranscript: await transcriptAvailable(ctx.orgId)');
    expect(read("src/components/chat/conversation/conversation-screen.tsx")).toContain("canTranscribe={detail?.voiceTranscript===true}");
    const item = read("src/components/chat/message/message-item.tsx");
    expect(item).toMatch(/\{canTranscribe&&<VoiceTranscript attachmentId=\{file\.id\}\/>\}/);
    const ui = read("src/components/chat/message/voice-transcript.tsx");
    expect(ui).toContain("/transcript");
    expect(ui).toContain("voiceTranscript.label");
  });
});
