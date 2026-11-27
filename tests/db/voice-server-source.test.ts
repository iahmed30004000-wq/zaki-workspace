import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-voice-server-${process.pid}`;
});

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as uploadsRoute from "@/app/api/chat/uploads/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as takeRoute from "@/app/api/chat/conversations/[id]/transcribe/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as transcriptRoute from "@/app/api/chat/attachments/[id]/transcript/route";
import * as settingsRoute from "@/app/api/owner-assistant/settings/route";
import * as voiceServerRoute from "@/app/api/owner-assistant/voice-server/route";
import { fileLibrary } from "@/server/services/files";
import { setLocalTransportForTests, type LocalHttpRequest } from "@/server/ai/local-transport";
import { HEALTH_SIGNED_TEXT, noteSignedText, verifySignature } from "@/server/calls/agent-link";
import { withFeature, type FeatureKey } from "@/lib/features";
import type { ConversationDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * «تحويل الصوت لنص على السيرفر» against the real database: only the owner sees the card, the program is chosen only while it can really do the work,
 * and once chosen «اكتب النص» (and the preview of a recording) go to its signed door, their words kept as they are because they never left the server.
 */
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, ...Buffer.from("webm"), 0x42, 0x87, 0x81, 0x04, 0, 0, 0, 0]);
const SECRET = "test-agent-secret-0123456789abcdef";
const SAID = "اتصل فيني على 0791234567 أو ابعت على sara@example.com";
const STT = { door: 1, ready: true, device: "cpu", gpuFound: false, gpu: null, model: "small", compute: "int8", requested: "large-v3", setting: "auto", reason: "no_gpu", fallback: false, meetings: "local" };

let seen: LocalHttpRequest[] = [];
let health: Record<string, unknown> | null = null;
const saved: Record<string, string | undefined> = {};
const ENV = ["VOICE_AGENT_URL", "VOICE_AGENT_SECRET", "TRANSCRIBE_URL", "TRANSCRIBE_MODEL", "TRANSCRIBE_LANGUAGE"];

beforeAll(() => {
  for (const k of ENV) saved[k] = process.env[k];
});
beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env["VOICE_AGENT_URL"] = "http://voice-agent:8080";
  process.env["VOICE_AGENT_SECRET"] = SECRET;
  seen = [];
  health = { ok: true, meetings: 0, secretOk: true, stt: STT };
  setLocalTransportForTests(async (request) => {
    seen.push(request);
    if (request.url.endsWith("/health")) {
      if (!health) throw new Error("ECONNREFUSED");
      return { status: 200, text: JSON.stringify(health) };
    }
    return { status: 200, text: JSON.stringify({ text: SAID }) };
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
  await setSwitch(t.org.id, "voiceNotes", true);
  await setSwitch(t.org.id, "voiceTranscript", true);
  await setSwitch(t.org.id, "ownerAssistant", true);
  return { t, dm, fileId, attachmentId: att.id };
}

const headerOf = async (dm: string) => (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${dm}`, params: { id: dm } })).json as unknown as ConversationDto;
const card = () => call(voiceServerRoute.GET, { method: "GET" });
const put = (transcribeSource: string | null) => call(settingsRoute.PUT, { method: "PUT", body: { transcribeSource } });
const chosen = async (orgId: string) => (await db.aiSettings.findUnique({ where: { orgId }, select: { transcribeSource: true } }))?.transcribeSource ?? null;

describe("the card of the voice program", () => {
  it("is the owner's alone and carries neither the address nor the secret", async () => {
    const w = await noteWorld();
    for (const id of [w.t.admin.id, w.t.member.id, w.t.guest.id]) {
      await loginAs(id);
      expect((await card()).status).toBe(404);
    }
    expect(seen).toHaveLength(0);
    await loginAs(w.t.owner.id);
    const res = await card();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ source: null, transcriptOn: true, serviceReady: false, agent: { state: "cpu", model: "small" } });
    expect(res.text).not.toContain(SECRET);
    expect(res.text).not.toContain("voice-agent:8080");
    expect(verifySignature(SECRET, seen[0]!.headers["x-agent-timestamp"] ?? null, seen[0]!.headers["x-agent-signature"] ?? null, HEALTH_SIGNED_TEXT)).toBe(true);
    await setSwitch(w.t.org.id, "ownerAssistant", false);
    expect((await card()).status).toBe(404);
  });
});

describe("choosing the program", () => {
  it("is refused while it is gone or too old, allowed on the processor, and never by anybody but the owner", async () => {
    const w = await noteWorld();
    await loginAs(w.t.admin.id);
    expect((await put("agent")).status).toBe(404);
    await loginAs(w.t.owner.id);
    health = null;
    const gone = await put("agent");
    expect(gone.status).toBe(422);
    expect(gone.text).toContain("gpuVoice.refused.unreachable");
    health = { ok: true, meetings: 0 };
    expect((await put("agent")).text).toContain("gpuVoice.refused.old");
    expect(await chosen(w.t.org.id)).toBeNull();
    health = { ok: true, meetings: 0, secretOk: true, stt: STT };
    expect((await put("agent")).status).toBe(200);
    expect(await chosen(w.t.org.id)).toBe("agent");
  });
});

describe("once it is chosen", () => {
  it("«اكتب النص» appears, the note goes to the signed door as it is, and the words are kept unfiltered; turning it off removes the button", async () => {
    const w = await noteWorld();
    await loginAs(w.t.member.id);
    expect((await headerOf(w.dm)).voiceTranscript).toBe(false);
    await loginAs(w.t.owner.id);
    expect((await put("agent")).status).toBe(200);
    await loginAs(w.t.member.id);
    expect((await headerOf(w.dm)).voiceTranscript).toBe(true);
    seen = [];
    const res = await call(transcriptRoute.POST, { params: { id: w.attachmentId } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ text: SAID, cached: false });
    expect(seen).toHaveLength(1);
    const req = seen[0]!;
    expect(req.url).toBe("http://voice-agent:8080/transcribe-note");
    expect(Buffer.from(req.rawBody as Uint8Array).equals(Buffer.from(WEBM))).toBe(true);
    const sha = createHash("sha256").update(WEBM).digest("hex");
    expect(req.headers["x-agent-audio-sha256"]).toBe(sha);
    expect(verifySignature(SECRET, req.headers["x-agent-timestamp"] ?? null, req.headers["x-agent-signature"] ?? null, noteSignedText(sha, "ar"))).toBe(true);
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: w.fileId }, select: { meta: true } });
    expect(JSON.stringify(row.meta)).toContain("0791234567");

    await loginAs(w.t.owner.id);
    expect((await put(null)).status).toBe(200);
    await loginAs(w.t.member.id);
    expect((await headerOf(w.dm)).voiceTranscript).toBe(false);
  });

  it("the words of a recording that was not sent yet go the same way", async () => {
    const w = await noteWorld();
    await loginAs(w.t.owner.id);
    expect((await put("agent")).status).toBe(200);
    await loginAs(w.t.member.id);
    seen = [];
    const form = new FormData();
    form.append("language", "auto");
    form.append("file", new File([new Uint8Array(WEBM)], "voice.webm", { type: "audio/webm" }));
    const res = await takeRoute.POST(new Request(`http://localhost/api/chat/conversations/${w.dm}/transcribe`, { method: "POST", body: form }), { params: { id: w.dm } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: SAID });
    expect(seen[0]!.url).toBe("http://voice-agent:8080/transcribe-note");
    expect(seen[0]!.headers["x-agent-language"]).toBe("");
  });
});
