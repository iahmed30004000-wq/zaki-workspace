import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/chat/conversations/[id]/transcribe` — the words of a recording that was NOT sent yet (the preview of `tgPhone`). The real route and the real
 * service, with the database, the sign-in, the switches and the socket to the transcription service stood in for. It must be at least as strict as «اكتب
 * النص» of a sent note: the switch, the conversation of THIS company, the right to read it, and (a recording exists only where one may write) the right to
 * post; a size cap, a rate limit, the same filter on a service outside the owner's machine; and nothing of the audio is kept.
 */
const world = vi.hoisted(() => {
  const dir = `${process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp"}/zk-take-${process.pid}-${Date.now()}`;
  process.env["UPLOAD_DIR"] = dir;
  process.env["TRANSCRIBE_URL"] = "http://whisper:8000";
  return {
    dir,
    off: new Set<string>(),
    inOrg: true,
    canRead: true,
    canPost: true,
    user: "u1",
    settings: { transcribeSource: null as string | null, transcribeModel: null as string | null, transcribeBaseUrl: null as string | null, gatewayBaseUrl: "", gatewayConfirmedLocal: false, hasGatewayKey: false },
    answer: { status: 200, text: JSON.stringify({ text: "مرحبا شباب" }) } as { status: number; text: string },
    calls: [] as { path: string; body: string }[],
    queries: [] as unknown[],
  };
});

vi.mock("@/server/db", () => ({
  db: {
    conversation: {
      findFirst: vi.fn(async (query: unknown) => {
        world.queries.push(query);
        return world.inOrg ? { id: "c1" } : null;
      }),
    },
  },
}));
vi.mock("@/server/policy/actor", () => ({ requireActor: vi.fn(async () => ({ userId: world.user, orgId: "o1", isOwner: false })) }));
vi.mock("@/server/policy/conversation", () => ({
  canReadConversation: vi.fn(async () => world.canRead),
  canPostInConversation: vi.fn(async () => world.canPost),
}));
vi.mock("@/server/services/features", async () => {
  const { NotFoundError } = await import("@/server/auth");
  return {
    isFeatureOn: vi.fn(async (_: string, key: string) => !world.off.has(key)),
    assertFeatureOn: vi.fn(async (_: string, key: string) => {
      if (world.off.has(key)) throw new NotFoundError("features.off");
    }),
  };
});
vi.mock("@/server/services/owner-assistant-settings", () => ({ getSettings: vi.fn(async () => world.settings), readGatewayKey: vi.fn(async () => null) }));
vi.mock("@/server/services/files", () => ({ openStored: vi.fn() }));
vi.mock("@/server/services/gateway-address", () => ({ judgeGatewayAddress: vi.fn(async () => ({ ok: true, external: true, target: { origin: "https://stt.example.com" } })) }));
vi.mock("@/server/ai/local-transport", async (original) => {
  const real = await original<typeof import("@/server/ai/local-transport")>();
  return {
    ...real,
    targetOf: vi.fn((origin: string) => ({ origin })),
    callLocal: vi.fn(async (request: { path: string; raw: { bytes: Uint8Array } }) => {
      world.calls.push({ path: request.path, body: Buffer.from(request.raw.bytes).toString("latin1") });
      return world.answer;
    }),
  };
});

import { POST } from "@/app/api/chat/conversations/[id]/transcribe/route";
import { MAX_TAKE_BYTES, TAKE_LIMIT, takeGuard } from "@/server/services/voice-transcript";
import { AR } from "@/lib/i18n/dict";

const WEBM = () => {
  const bytes = new Uint8Array(64);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  bytes.set(Buffer.from("webm"), 24);
  return bytes;
};

function request(file: Uint8Array = WEBM(), fields: Record<string, string> = { language: "ar" }): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", new File([file as BlobPart], "voice.webm", { type: "audio/webm" }));
  return new Request("http://app/api/chat/conversations/c1/transcribe", { method: "POST", body: form });
}
const call = async (req: Request = request()) => {
  const res = await POST(req, { params: { id: "c1" } });
  return { status: res.status, body: (await res.json()) as { text?: string; message?: string; error?: string }, headers: res.headers };
};
const leftovers = () => {
  const incoming = join(world.dir, ".incoming");
  return existsSync(incoming) ? readdirSync(incoming) : [];
};

beforeEach(() => {
  world.off.clear();
  Object.assign(world, { inOrg: true, canRead: true, canPost: true, user: `u${Math.random()}`, answer: { status: 200, text: JSON.stringify({ text: "مرحبا شباب" }) } });
  world.settings = { transcribeSource: null, transcribeModel: null, transcribeBaseUrl: null, gatewayBaseUrl: "", gatewayConfirmedLocal: false, hasGatewayKey: false };
  world.calls.length = 0;
  world.queries.length = 0;
});

describe("who may ask", () => {
  it("answers the words, never cached, in Arabic by default, and keeps nothing of the audio", async () => {
    const r = await call(request(WEBM(), {}));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ text: "مرحبا شباب" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(world.calls).toHaveLength(1);
    expect(world.calls[0]!.path).toBe("/v1/audio/transcriptions");
    expect(world.calls[0]!.body).toContain('name="language"\r\n\r\nar\r\n');
    expect(leftovers()).toEqual([]);
  });

  it("asks the conversation of THIS company, the right to read it and the right to post in it; anything less is refused before a byte leaves", async () => {
    await call();
    expect(world.queries[0]).toMatchObject({ where: { id: "c1", orgId: "o1" } });
    world.calls.length = 0;
    for (const [patch, status] of [
      [{ inOrg: false }, 404],
      [{ canRead: false }, 404],
      [{ canPost: false }, 403],
    ] as const) {
      Object.assign(world, { inOrg: true, canRead: true, canPost: true }, patch);
      expect((await call()).status, JSON.stringify(patch)).toBe(status);
    }
    expect(world.calls).toHaveLength(0);
    expect(leftovers()).toEqual([]);
  });

  it("either switch off is «not found»: the transcript's, and the voice notes'", async () => {
    for (const key of ["voiceTranscript", "voiceNotes"]) {
      world.off.clear();
      world.off.add(key);
      expect((await call()).status, key).toBe(404);
    }
    expect(world.calls).toHaveLength(0);
  });
});

describe("what is accepted", () => {
  it("only a recording: other bytes are refused, whatever the file is called", async () => {
    const r = await call(request(new Uint8Array(Buffer.from("%PDF-1.7 not audio at all"))));
    expect(r.status).toBe(422);
    expect(world.calls).toHaveLength(0);
    expect(leftovers()).toEqual([]);
  });

  it("no more than a voice note may weigh", async () => {
    const big = new Uint8Array(MAX_TAKE_BYTES + 10);
    big.set(WEBM());
    const r = await call(request(big));
    expect(r.status).toBe(409);
    expect(r.body.message).toBe("voiceTranscript.err_big");
    expect(MAX_TAKE_BYTES).toBe(10 * 1024 * 1024);
    expect(world.calls).toHaveLength(0);
    expect(leftovers()).toEqual([]);
  });

  it("the person's language goes to the service: a short code, «auto» to let it guess, and anything else is the service's own", async () => {
    await call(request(WEBM(), { language: "en" }));
    expect(world.calls[0]!.body).toContain('name="language"\r\n\r\nen\r\n');
    await call(request(WEBM(), { language: "auto" }));
    expect(world.calls[1]!.body).not.toContain('name="language"');
    await call(request(WEBM(), { language: 'ar"\r\nx' }));
    expect(world.calls[2]!.body).toContain('name="language"\r\n\r\nar\r\n');
  });

  it("is rate limited per person, with a plain Arabic sentence", async () => {
    world.user = "busy-person";
    for (let i = 0; i < TAKE_LIMIT.limit; i++) expect((await call()).status).toBe(200);
    const r = await call();
    expect(r.status).toBe(429);
    expect(r.body.message).toBe("tgvoice.err_rate");
    expect(AR["tgvoice.err_rate"]).toBeTruthy();
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect(world.calls).toHaveLength(TAKE_LIMIT.limit);
    world.user = "somebody-else";
    expect((await call()).status).toBe(200);
  });

  it("one person holds at most two requests in the air", () => {
    const first = takeGuard.enter("twice");
    const second = takeGuard.enter("twice");
    expect(() => takeGuard.enter("twice")).toThrow("voiceTranscript.err_busy");
    first();
    const third = takeGuard.enter("twice");
    second();
    third();
  });
});

describe("what comes back", () => {
  it("no service set up is said plainly", async () => {
    const url = process.env["TRANSCRIBE_URL"];
    delete process.env["TRANSCRIBE_URL"];
    const r = await call();
    process.env["TRANSCRIBE_URL"] = url;
    expect(r.status).toBe(409);
    expect(r.body.message).toBe("voiceTranscript.err_not_configured");
  });

  it("a service outside the owner's machine has its words filtered like the sent note's", async () => {
    world.settings = { ...world.settings, transcribeSource: "gateway", gatewayBaseUrl: "https://stt.example.com" };
    world.answer = { status: 200, text: JSON.stringify({ text: "اتصل على 0791234567 أو راسل a@b.com" }) };
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body.text).not.toContain("0791234567");
    expect(r.body.text).not.toContain("a@b.com");
  });

  it("a silent take and a failing service are keys of the dictionary (never the service's words)", async () => {
    world.answer = { status: 200, text: JSON.stringify({ text: "  " }) };
    expect((await call()).body.message).toBe("voiceTranscript.err_empty");
    world.answer = { status: 500, text: "secret stack trace" };
    const r = await call();
    expect(r.status).toBe(502);
    expect(r.body.message).toBe("voiceTranscript.err_failed");
    expect(JSON.stringify(r.body)).not.toContain("secret");
    expect(leftovers()).toEqual([]);
  });
});
