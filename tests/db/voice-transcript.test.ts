import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// uploaded test files stay out of the repo; vi.hoisted runs before the imports, so it must not use any
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-transcript-${process.pid}`;
});

import { promises as fs } from "node:fs";
import * as uploadsRoute from "@/app/api/chat/uploads/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as transcriptRoute from "@/app/api/chat/attachments/[id]/transcript/route";
import { fileLibrary } from "@/server/services/files";
import { setLocalTransportForTests, type LocalHttpRequest } from "@/server/ai/local-transport";
import { withFeature, type FeatureKey } from "@/lib/features";
import type { ConversationDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser } from "./helpers";

const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, ...Buffer.from("webm"), 0x42, 0x87, 0x81, 0x04, 0, 0, 0, 0]);

let seen: LocalHttpRequest[] = [];
let answer: { status: number; text: string } | Error = { status: 200, text: JSON.stringify({ text: "مرحبا شباب" }) };
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ["TRANSCRIBE_URL", "TRANSCRIBE_MODEL", "TRANSCRIBE_LANGUAGE"]) saved[k] = process.env[k];
});

beforeEach(() => {
  delete process.env["TRANSCRIBE_URL"];
  delete process.env["TRANSCRIBE_MODEL"];
  delete process.env["TRANSCRIBE_LANGUAGE"];
  seen = [];
  answer = { status: 200, text: JSON.stringify({ text: "مرحبا شباب" }) };
  setLocalTransportForTests(async (request) => {
    seen.push(request);
    if (answer instanceof Error) throw answer;
    return answer;
  });
});

afterAll(async () => {
  setLocalTransportForTests(null);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(fileLibrary, { recursive: true, force: true }).catch(() => undefined);
});

async function setSwitch(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

/** A direct chat of two people with one voice note in it; returns the conversation and the attachment of the note. */
async function noteWorld() {
  const t = await makeTeam();
  await loginAs(t.member.id);
  const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
  const form = new FormData();
  form.append("file", new File([new Uint8Array(WEBM)], "voice.webm"));
  form.append("kind", "VOICE");
  const up = await uploadsRoute.POST(new Request("http://localhost/api/chat/uploads", { method: "POST", body: form }));
  expect(up.status).toBe(201);
  const fileId = ((await up.json()) as { id: string }).id;
  const sent = await call(messagesRoute.POST, { params: { id: dm }, body: { voice: true, attachmentIds: [fileId] } });
  expect(sent.status).toBeLessThan(300);
  const att = await db.messageAttachment.findFirstOrThrow({ where: { fileId } });
  return { t, dm, fileId, attachmentId: att.id };
}

const ask = (id: string) => call(transcriptRoute.POST, { params: { id } });

describe("«كتابة نص الرسالة الصوتية»", () => {
  it("is off by default: «not found», nothing is sent, and the log is not told to draw the button", async () => {
    process.env["TRANSCRIBE_URL"] = "http://whisper:8000";
    const w = await noteWorld();
    const res = await ask(w.attachmentId);
    expect(res.status).toBe(404);
    expect(res.json?.["message"]).toBe("features.off");
    expect(seen).toHaveLength(0);
    const detail = (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${w.dm}`, params: { id: w.dm } })).json as unknown as ConversationDto;
    expect(detail.voiceTranscript).toBe(false);
  });

  it("switch on but no service set up: a plain answer, nothing is sent, no button", async () => {
    const w = await noteWorld();
    await setSwitch(w.t.org.id, "voiceTranscript", true);
    const res = await ask(w.attachmentId);
    expect(res.status).toBe(409);
    expect(res.json?.["message"]).toBe("voiceTranscript.err_not_configured");
    expect(seen).toHaveLength(0);
    const detail = (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${w.dm}`, params: { id: w.dm } })).json as unknown as ConversationDto;
    expect(detail.voiceTranscript).toBe(false);
  });

  it("writes the text once, keeps it with the recording, and the second ask never sends the audio again", async () => {
    process.env["TRANSCRIBE_URL"] = "http://whisper:8000";
    const w = await noteWorld();
    await setSwitch(w.t.org.id, "voiceTranscript", true);
    const detail = (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${w.dm}`, params: { id: w.dm } })).json as unknown as ConversationDto;
    expect(detail.voiceTranscript).toBe(true);

    const first = await ask(w.attachmentId);
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ text: "مرحبا شباب", cached: false });
    expect(seen).toHaveLength(1);
    const req = seen[0] as LocalHttpRequest;
    expect(req.url).toBe("http://whisper:8000/v1/audio/transcriptions");
    expect(req.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    const form = Buffer.from(req.rawBody as Uint8Array).toString("latin1");
    expect(form).toContain('name="model"\r\n\r\nwhisper-1');
    expect(form).toContain('name="language"\r\n\r\nar');
    expect(form).toContain('filename="voice.webm"');

    const row = await db.storedFile.findUniqueOrThrow({ where: { id: w.fileId }, select: { meta: true } });
    expect(row.meta).toMatchObject({ kind: expect.any(String), transcript: { text: "مرحبا شباب" } });

    const again = await ask(w.attachmentId);
    expect(again.json).toEqual({ text: "مرحبا شباب", cached: true });
    expect(seen).toHaveLength(1);
  });

  it("only a person who may read the conversation can ask, and a stranger gets «not found»", async () => {
    process.env["TRANSCRIBE_URL"] = "http://whisper:8000";
    const w = await noteWorld();
    await setSwitch(w.t.org.id, "voiceTranscript", true);
    const stranger = await makeUser({ orgId: w.t.org.id, role: "MEMBER", name: "Stranger" });
    await loginAs(stranger.id);
    const res = await ask(w.attachmentId);
    expect(res.status).toBe(404);
    expect(seen).toHaveLength(0);
    await loginAs(w.t.admin.id);
    expect((await ask(w.attachmentId)).status).toBe(200);
  });

  it("a note of a deleted message is gone for everybody but the owner", async () => {
    process.env["TRANSCRIBE_URL"] = "http://whisper:8000";
    const w = await noteWorld();
    await setSwitch(w.t.org.id, "voiceTranscript", true);
    const att = await db.messageAttachment.findUniqueOrThrow({ where: { id: w.attachmentId }, select: { messageId: true } });
    await db.chatMessage.update({ where: { id: att.messageId as string }, data: { deletedAt: new Date() } });
    await loginAs(w.t.admin.id);
    expect((await ask(w.attachmentId)).status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("a service that fails or hears nothing answers a key and stores nothing; one that is down says so", async () => {
    process.env["TRANSCRIBE_URL"] = "http://whisper:8000";
    const w = await noteWorld();
    await setSwitch(w.t.org.id, "voiceTranscript", true);
    const stored = async () => (await db.storedFile.findUniqueOrThrow({ where: { id: w.fileId }, select: { meta: true } })).meta as Record<string, unknown>;

    answer = { status: 500, text: "boom http://whisper:8000" };
    const failed = await ask(w.attachmentId);
    expect(failed.status).toBe(502);
    expect(failed.json?.["message"]).toBe("voiceTranscript.err_failed");
    expect(JSON.stringify(failed.json)).not.toContain("whisper");

    answer = new Error("ECONNREFUSED");
    const down = await ask(w.attachmentId);
    expect(down.status).toBe(502);
    expect(down.json?.["message"]).toBe("voiceTranscript.err_down");

    answer = { status: 200, text: JSON.stringify({ text: "  " }) };
    const silent = await ask(w.attachmentId);
    expect(silent.status).toBe(409);
    expect(silent.json?.["message"]).toBe("voiceTranscript.err_empty");
    expect((await stored())["transcript"]).toBeUndefined();

    answer = { status: 200, text: JSON.stringify({ text: "تمام" }) };
    expect((await ask(w.attachmentId)).json).toEqual({ text: "تمام", cached: false });
  });

  it("a public address in the setting is never called", async () => {
    process.env["TRANSCRIBE_URL"] = "https://api.openai.com";
    const w = await noteWorld();
    await setSwitch(w.t.org.id, "voiceTranscript", true);
    const res = await ask(w.attachmentId);
    expect(res.status).toBe(409);
    expect(res.json?.["message"]).toBe("voiceTranscript.err_not_configured");
    expect(seen).toHaveLength(0);
  });
});
