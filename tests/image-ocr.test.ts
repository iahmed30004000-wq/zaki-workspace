import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AR } from "@/lib/i18n/dict";
import { ECONOMY_FORCED_OFF, FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { LocalQueue } from "@/server/ai/local-queue";
import type { LocalHttpRequest, LocalTransport } from "@/server/ai/local-transport";
import { buildOcrBody, ImageOcrError, MAX_FILE_TEXT_CHARS, OCR_PROMPT, ocrBytes, ocrServer, sniffImage, textOfAnswer } from "@/server/services/image-ocr";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const KEY = "sk-unit-secret-key-9876";
const IMAGE = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]), mime: "image/png" as const };
const SERVER = { origin: "http://ocr:8000", model: "qwen-vl", apiKey: null, external: false };
const answerOf = (text: string) => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: text } }] }) });

function fake(answer: { status: number; text: string } | Error) {
  const seen: LocalHttpRequest[] = [];
  const transport: LocalTransport = async (request) => {
    seen.push(request);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { seen, transport };
}

describe("«قراءة نص الصور»: where the service lives", () => {
  it("nothing set, no model, a public IP, a metadata address, plain http to a public name or a path: no service", () => {
    expect(ocrServer({})).toBeNull();
    expect(ocrServer({ OCR_URL: "http://ocr:8000" })).toBeNull(); // the model is required
    expect(ocrServer({ OCR_MODEL: "m" })).toBeNull();
    for (const url of ["http://8.8.8.8", "https://8.8.8.8", "http://169.254.169.254", "http://metadata.google.internal", "http://vision.example.com", "https://user:pw@vision.example.com", "https://vision.example.com/api", "https://vision.example.com?x=1", "ftp://ocr"]) {
      expect(ocrServer({ OCR_URL: url, OCR_MODEL: "m" }), url).toBeNull();
    }
  });

  it("accepts an https public name (marked outside) and an inside address, drops a trailing /v1, and judges the model and the key", () => {
    expect(ocrServer({ OCR_URL: "http://ocr:8000", OCR_MODEL: "qwen-vl" })).toEqual({ origin: "http://ocr:8000", model: "qwen-vl", apiKey: null, external: false });
    expect(ocrServer({ OCR_URL: "https://vision.example.com/v1/", OCR_MODEL: "org/model:7b", OCR_API_KEY: ` ${KEY} ` })).toEqual({ origin: "https://vision.example.com", model: "org/model:7b", apiKey: KEY, external: true });
    expect(ocrServer({ OCR_URL: "http://192.168.1.20:9000", OCR_MODEL: "m" })).toMatchObject({ origin: "http://192.168.1.20:9000", external: false });
    expect(ocrServer({ OCR_URL: "http://ocr:8000", OCR_MODEL: "a b; rm" })).toBeNull();
    // a key that would split the header means no service at all, never a half-working one
    expect(ocrServer({ OCR_URL: "http://ocr:8000", OCR_MODEL: "m", OCR_API_KEY: "bad key\r\nx: y" })).toBeNull();
  });
});

describe("the picture and the request", () => {
  it("png, jpeg and webp are told apart by their first bytes; anything else is nothing", () => {
    expect(sniffImage(IMAGE.bytes)).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]))).toBeNull(); // gif
    expect(sniffImage(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // pdf
    expect(sniffImage(new Uint8Array())).toBeNull();
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull(); // wav
  });

  it("the body asks for the exact text and carries the picture as a data URL, and never the key", () => {
    const body = buildOcrBody("qwen-vl", IMAGE) as { model: string; messages: { content: { type: string; text?: string; image_url?: { url: string } }[] }[] };
    expect(body.model).toBe("qwen-vl");
    const parts = body.messages[0]?.content ?? [];
    expect(parts[0]).toEqual({ type: "text", text: OCR_PROMPT });
    expect(OCR_PROMPT).toMatch(/exactly as written/);
    expect(OCR_PROMPT).toMatch(/Arabic, Latin/);
    expect(OCR_PROMPT).toMatch(/no commentary/);
    expect(parts[1]?.image_url?.url).toBe(`data:image/png;base64,${Buffer.from(IMAGE.bytes).toString("base64")}`);
  });

  it("posts to the chat path of the judged origin; the key rides in ONE header, only when set", async () => {
    const without = fake(answerOf("  نص  "));
    expect(await ocrBytes(SERVER, IMAGE, { transport: without.transport })).toBe("نص");
    const req = without.seen[0] as LocalHttpRequest;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://ocr:8000/v1/chat/completions");
    expect(req.headers["authorization"]).toBeUndefined();
    expect(req.external).toBeUndefined();

    const withKey = fake(answerOf("x"));
    await ocrBytes({ origin: "https://vision.example.com", model: "m", apiKey: KEY, external: true }, IMAGE, { transport: withKey.transport });
    const r2 = withKey.seen[0] as LocalHttpRequest;
    expect(r2.url).toBe("https://vision.example.com/v1/chat/completions");
    expect(r2.headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(r2.external).toBe(true);
    expect(r2.body).not.toContain(KEY);
    expect(r2.url).not.toContain(KEY);
  });

  it("reads the answer in its two shapes, drops a thinking block, and cuts an over-long text", () => {
    expect(textOfAnswer({ choices: [{ message: { content: " a " } }] })).toBe("a");
    expect(textOfAnswer({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] })).toBe("ab");
    expect(textOfAnswer({ choices: [{ message: { content: "<think>hmm</think>الجواب" } }] })).toBe("الجواب");
    expect(textOfAnswer({ choices: [] })).toBe("");
    expect(textOfAnswer(null)).toBe("");
    expect(textOfAnswer({ choices: [{ message: { content: "ا".repeat(MAX_FILE_TEXT_CHARS + 50) } }] }).length).toBe(MAX_FILE_TEXT_CHARS);
  });

  it("a failure is a dictionary key and never the service's words, its address or the key", async () => {
    const cases: [{ status: number; text: string } | Error, string][] = [
      [{ status: 500, text: `boom http://ocr:8000 ${KEY}` }, "imageOcr.err_failed"],
      [{ status: 401, text: `bad key ${KEY}` }, "imageOcr.err_failed"],
      [{ status: 200, text: "<html>not json</html>" }, "imageOcr.err_failed"],
      [{ status: 302, text: "" }, "imageOcr.err_failed"], // a redirect is never followed: any 3xx is a failure
      [new Error(`ECONNREFUSED ocr:8000 ${KEY}`), "imageOcr.err_down"],
    ];
    for (const [answer, key] of cases) {
      const f = fake(answer);
      const err = await ocrBytes({ ...SERVER, apiKey: KEY }, IMAGE, { transport: f.transport }).catch((e: unknown) => e);
      expect(err, key).toBeInstanceOf(ImageOcrError);
      expect((err as ImageOcrError).key).toBe(key);
      expect((err as Error).message).toBe(key);
      expect(AR[key], key).toBeTruthy();
    }
  });

  it("a busy machine is told so instead of piling work up", async () => {
    const queue = new LocalQueue(0, 1_000);
    let release: () => void = () => undefined;
    const held = queue.run(() => new Promise<void>((resolve) => (release = resolve)));
    const f = fake(answerOf("x"));
    const err = await ocrBytes(SERVER, IMAGE, { transport: f.transport, queue }).catch((e: unknown) => e);
    expect((err as ImageOcrError).key).toBe("imageOcr.err_busy");
    expect(f.seen).toHaveLength(0);
    release();
    await held;
  });

  it("an address that stopped being acceptable is refused at call time, before anything is sent", async () => {
    const f = fake(answerOf("x"));
    const err = await ocrBytes({ ...SERVER, origin: "http://8.8.8.8" }, IMAGE, { transport: f.transport }).catch((e: unknown) => e);
    expect((err as ImageOcrError).key).toBe("imageOcr.err_down");
    expect(f.seen).toHaveLength(0);
  });
});

describe("the switch, the words and the screen", () => {
  it("is off by default (the picture leaves the app), has its words, and economy mode does not own it", () => {
    expect(FEATURES).toContain("imageOcr");
    expect(FEATURE_DEFAULTS.imageOcr).toBe(false);
    expect(AR["features.imageOcr.name"]).toBeTruthy();
    expect(AR["features.imageOcr.hint"]).toContain("⚠️");
    expect(AR["features.imageOcr.hint"]).toContain("🔧");
    expect(ECONOMY_FORCED_OFF as readonly string[]).not.toContain("imageOcr");
  });

  it("every key the screen and the routes can show has its Arabic", () => {
    for (const key of ["button", "busy_button", "label", "hint_wrong", "copy", "copied", "again", "hide", "show", "not_found", "err_guest", "err_not_configured", "err_down", "err_busy", "err_timeout", "err_failed", "err_big", "err_type", "err_empty", "err_rate"]) {
      expect(AR[`imageOcr.${key}`], key).toBeTruthy();
    }
  });

  it("both doors go through the one service; the chat log draws the button only when the server says so; the text sits under the picture", () => {
    const files = read("src/app/api/files/[id]/text/route.ts");
    const chat = read("src/app/api/chat/attachments/[id]/text/route.ts");
    expect(files).toContain("export async function POST");
    expect(files).toContain("answerReadText(req, await requireActor(), params.id)");
    expect(chat).toContain("export async function POST");
    expect(chat).toContain('assertFeatureOn(actor.orgId, "imageOcr")');
    expect(chat).toContain("answerReadText(req, actor, att.fileId)");
    // the access rule lives in the service, once: the file gate, the guest refusal, the conversation's guests
    const service = read("src/server/services/image-ocr.ts");
    expect(service).toContain("assertMayReadFile(");
    expect(service).toContain("actor.isExternal");
    expect(service).toContain("conversationHasGuest(");
    expect(service).toContain('assertFeatureOn(actor.orgId, "imageOcr")');
    expect(read("src/server/chat/topics.ts")).toContain("conversationHasGuest(facts, conversationId, ctx.orgId)");
    expect(read("src/components/chat/conversation/conversation-screen.tsx")).toContain("canReadImages={detail?.imageOcr===true}");
    expect(read("src/components/chat/message/message-item.tsx")).toMatch(/\{canReadImages&&file\.kind==="IMAGE"/);
    expect(read("src/components/files-view.tsx")).toContain("list.data?.ocr === true");
    const ui = read("src/components/image-text.tsx");
    expect(ui).toContain("imageOcr.label");
    expect(ui).toContain("imageOcr.again");
    expect(ui).toContain("imageOcr.copy");
  });

  it("the key is read from the environment only: never selected, stored, returned or logged by the service", () => {
    const service = read("src/server/services/image-ocr.ts");
    const code = service.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/log\.|console\./);
    expect(code.match(/apiKey/g)?.length).toBeLessThan(10);
    // the kept row has no place for it, and the audit meta is counters only
    expect(read("prisma/migrations/20261111100000_file_text/migration.sql")).not.toMatch(/secret|apikey|token/i);
    expect(code).toMatch(/meta: \{ outcome, \.\.\.\(failure \? \{ key: failure \} : \{\}\), \.\.\.counters \}/);
  });
});
