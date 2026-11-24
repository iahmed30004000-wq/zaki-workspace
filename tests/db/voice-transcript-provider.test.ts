import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-transcript-provider-${process.pid}`;
});

import { promises as fs } from "node:fs";
import * as uploadsRoute from "@/app/api/chat/uploads/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as transcriptRoute from "@/app/api/chat/attachments/[id]/transcript/route";
import * as settingsRoute from "@/app/api/owner-assistant/settings/route";
import { fileLibrary } from "@/server/services/files";
import { setLocalTransportForTests, type LocalHttpRequest } from "@/server/ai/local-transport";
import { saveGatewayKey } from "@/server/services/owner-assistant-settings";
import { withFeature, type FeatureKey } from "@/lib/features";
import type { ConversationDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * The speech-to-text service is chosen on the owner's AI settings screen, not in the server's environment: «خدمة محلية» (an address inside the server), or
 * «البوابة» (the OpenAI-compatible gateway of the assistant, with its key). The environment variables still work when nothing is chosen. A text that came from a
 * gateway that is not confirmed local goes through the assistant's privacy filter before it is kept.
 */
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, ...Buffer.from("webm"), 0x42, 0x87, 0x81, 0x04, 0, 0, 0, 0]);
const GATEWAY_KEY = "gw-secret-key-must-never-appear-1234567890"; // scan-secrets:ignore

let seen: LocalHttpRequest[] = [];
let said = "اتصل فيني على 0791234567 أو ابعت على sara@example.com";
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ["TRANSCRIBE_URL", "TRANSCRIBE_MODEL", "TRANSCRIBE_LANGUAGE"]) saved[k] = process.env[k];
});
beforeEach(() => {
  delete process.env["TRANSCRIBE_URL"];
  delete process.env["TRANSCRIBE_MODEL"];
  delete process.env["TRANSCRIBE_LANGUAGE"];
  seen = [];
  said = "اتصل فيني على 0791234567 أو ابعت على sara@example.com";
  setLocalTransportForTests(async (request) => {
    seen.push(request);
    return { status: 200, text: JSON.stringify({ text: said }) };
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
  await setSwitch(t.org.id, "voiceTranscript", true);
  return { t, dm, fileId, attachmentId: att.id };
}
const ask = (id: string) => call(transcriptRoute.POST, { params: { id } });
const headerOf = async (dm: string) => (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${dm}`, params: { id: dm } })).json as unknown as ConversationDto;

describe("the speech-to-text service chosen on the settings screen", () => {
  it("a local service saved there is used (its address, its model), with no variable in the environment and no Authorization header", async () => {
    const w = await noteWorld();
    await db.aiSettings.upsert({ where: { orgId: w.t.org.id }, create: { orgId: w.t.org.id, transcribeSource: "local", transcribeBaseUrl: "http://stt:9000", transcribeModel: "whisper-large-v3" }, update: { transcribeSource: "local", transcribeBaseUrl: "http://stt:9000", transcribeModel: "whisper-large-v3" } });
    expect((await headerOf(w.dm)).voiceTranscript).toBe(true);
    said = "مرحبا شباب";
    const res = await ask(w.attachmentId);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ text: "مرحبا شباب", cached: false });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("http://stt:9000/v1/audio/transcriptions");
    expect(seen[0]!.headers["authorization"]).toBeUndefined();
    expect(Buffer.from(seen[0]!.rawBody as Uint8Array).toString("latin1")).toContain('name="model"\r\n\r\nwhisper-large-v3');
  });

  it("the gateway of the assistant: its key goes in ONE Bearer header, and a text from a gateway not confirmed local is filtered before it is kept", async () => {
    const w = await noteWorld();
    await db.aiSettings.upsert({ where: { orgId: w.t.org.id }, create: { orgId: w.t.org.id }, update: {} });
    await db.aiSettings.update({ where: { orgId: w.t.org.id }, data: { transcribeSource: "gateway", gatewayBaseUrl: "http://gateway:8080", transcribeModel: "whisper-1" } });
    await saveGatewayKey({ orgId: w.t.org.id, userId: w.t.owner.id }, GATEWAY_KEY);
    expect((await headerOf(w.dm)).voiceTranscript).toBe(true);
    const res = await ask(w.attachmentId);
    expect(res.status).toBe(200);
    expect(seen[0]!.url).toBe("http://gateway:8080/v1/audio/transcriptions");
    expect(seen[0]!.headers["authorization"]).toBe(`Bearer ${GATEWAY_KEY}`);
    const text = String(res.json?.["text"]);
    expect(text).not.toContain("0791234567");
    expect(text).not.toContain("sara@example.com");
    expect(text).toContain("اتصل فيني على");
    expect(res.text).not.toContain(GATEWAY_KEY);
    // what is kept with the recording is the filtered text too
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: w.fileId }, select: { meta: true } });
    expect(JSON.stringify(row.meta)).not.toContain("0791234567");
  });

  it("a gateway the owner confirmed as local keeps the words as they are", async () => {
    const w = await noteWorld();
    await db.aiSettings.upsert({ where: { orgId: w.t.org.id }, create: { orgId: w.t.org.id }, update: {} });
    await db.aiSettings.update({ where: { orgId: w.t.org.id }, data: { transcribeSource: "gateway", gatewayBaseUrl: "http://gateway:8080", gatewayConfirmedLocal: true } });
    const res = await ask(w.attachmentId);
    expect(res.json?.["text"]).toBe("اتصل فيني على 0791234567 أو ابعت على sara@example.com");
  });

  it("with nothing chosen the server's variable still works (as before), and with neither there is no button", async () => {
    const w = await noteWorld();
    expect((await headerOf(w.dm)).voiceTranscript).toBe(false);
    expect((await ask(w.attachmentId)).status).toBe(409);
    process.env["TRANSCRIBE_URL"] = "http://whisper:8000";
    expect((await headerOf(w.dm)).voiceTranscript).toBe(true);
    said = "نص";
    expect((await ask(w.attachmentId)).json).toEqual({ text: "نص", cached: false });
    expect(seen[0]!.url).toBe("http://whisper:8000/v1/audio/transcriptions");
  });

  it("the settings route saves the choice and refuses nonsense and a public address for a local service", async () => {
    const w = await noteWorld();
    await setSwitch(w.t.org.id, "ownerAssistant", true);
    await loginAs(w.t.owner.id);
    const put = (body: unknown) => call(settingsRoute.PUT, { method: "PUT", body });
    expect((await put({ transcribeSource: "local", transcribeBaseUrl: "http://stt:9000", transcribeModel: "whisper-1" })).status).toBe(200);
    const got = await call(settingsRoute.GET, { method: "GET" });
    expect(got.json?.["transcribeSource"] ?? (got.json?.["settings"] as Record<string, unknown> | undefined)?.["transcribeSource"]).toBe("local");
    expect((await put({ transcribeSource: "somewhere" })).status).toBe(422);
    expect((await put({ transcribeBaseUrl: "https://api.public-service.com" })).status).toBe(422);
    // the owner can put it back to «from the server's variable»
    expect((await put({ transcribeSource: null })).status).toBe(200);
  });
});
