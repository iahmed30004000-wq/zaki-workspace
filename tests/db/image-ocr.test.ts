/**
 * «قراءة نص الصور» against a real database, with a fake vision service (no network): who may read a picture's text, the switch and the
 * setup, the limits of type and size, the kept text, the guest rules, the audit row, the rate limit, the key that never leaves, and the
 * search that finds a picture by the words inside it ONLY for the people who may see that picture.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// uploaded test files stay out of the repo; vi.hoisted runs before the imports, so it must not use any
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-ocr-${process.pid}`;
});

import { promises as fs } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as chatTextRoute from "@/app/api/chat/attachments/[id]/text/route";
import * as fileTextRoute from "@/app/api/files/[id]/text/route";
import * as filesRoute from "@/app/api/files/route";
import * as searchRoute from "@/app/api/search/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as convSearchRoute from "@/app/api/chat/conversations/[id]/search/route";
import { claimUploads } from "@/server/chat/attachments";
import { fileLibrary } from "@/server/services/files";
import { ocrOrgLimiter, ocrUserLimiter } from "@/server/services/image-ocr";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { setLocalTransportForTests, type LocalHttpRequest } from "@/server/ai/local-transport";
import { withFeature, type FeatureKey } from "@/lib/features";
import type { ConversationDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const KEY = "sk-test-ocr-secret-0123456789";
const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

let seen: LocalHttpRequest[] = [];
let answer: { status: number; text: string } | Error;
const said = (text: string) => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: text } }] }) });
const saved: Record<string, string | undefined> = {};
const ENV = ["OCR_URL", "OCR_MODEL", "OCR_API_KEY"];

beforeAll(() => {
  for (const k of ENV) saved[k] = process.env[k];
});

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  seen = [];
  answer = said("فاتورة رقم 4821");
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

const setup = (over: Record<string, string> = {}) => {
  process.env["OCR_URL"] = "http://ocr:8000";
  process.env["OCR_MODEL"] = "qwen-vl";
  for (const [k, v] of Object.entries(over)) process.env[k] = v;
};

async function setSwitch(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

interface StoreOpts {
  purpose: "CHAT" | "LIBRARY";
  name?: string;
  mime?: string;
  bytes?: Uint8Array;
  size?: number;
  workspaceId?: string;
}

async function store(orgId: string, uploaderId: string, opts: StoreOpts) {
  const id = uid();
  const dir = process.env["UPLOAD_DIR"] as string;
  await mkdir(dir, { recursive: true });
  const bytes = opts.bytes ?? PNG;
  await writeFile(path.join(dir, id), bytes);
  return db.storedFile.create({
    data: {
      id,
      orgId,
      uploaderId,
      familyId: id,
      name: opts.name ?? "photo.png",
      mimeType: opts.mime ?? "image/png",
      size: opts.size ?? bytes.length,
      path: id,
      purpose: opts.purpose,
      ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
    },
  });
}

/** A space with `member` and `sara`, an open topic and a restricted one; another space with the admin; every actor of the company. */
async function world() {
  const t = await makeTeam();
  const sara = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "سارة" });
  const space = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: sara.id }]);
  const other = await makeWorkspace(t.org.id, [{ userId: t.admin.id }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: space.id, title: "عام" } });
  const secret = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: space.id, restricted: true, title: "مقفل", members: { create: [{ userId: t.member.id }] } } });
  await setSwitch(t.org.id, "imageOcr", true);
  return { ...t, sara, space, other, topic, secret };
}
type World = Awaited<ReturnType<typeof world>>;

/** A picture sent in a conversation: the file, the message and the attachment row (what the DTO's id is). */
async function picture(w: World, conversationId: string, opts: Partial<StoreOpts> = {}) {
  const file = await store(w.org.id, w.member.id, { purpose: "CHAT", ...opts });
  const msg = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId, authorId: w.member.id, body: "صورة" } });
  await db.$transaction((tx) => claimUploads(tx, { orgId: w.org.id, uploaderId: w.member.id, conversationId, messageId: msg.id, attachmentIds: [file.id] }));
  const att = await db.messageAttachment.findFirstOrThrow({ where: { messageId: msg.id } });
  return { file, msg, att };
}

const readChat = (attId: string, again = false) => call(chatTextRoute.POST, { params: { id: attId }, ...(again ? { body: { again: true } } : {}) });
const readFile = (fileId: string, again = false) => call(fileTextRoute.POST, { params: { id: fileId }, ...(again ? { body: { again: true } } : {}) });
const detailOf = async (id: string) => (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } })).json as unknown as ConversationDto;
const audits = (orgId: string) => db.auditLog.findMany({ where: { orgId, action: "file.text_read" } });

describe("the switch and the setup", () => {
  it("is off by default: «not found» on both doors, nothing is sent, the log draws no button", async () => {
    setup();
    const w = await world();
    await setSwitch(w.org.id, "imageOcr", false);
    const p = await picture(w, w.topic.id);
    const lib = await store(w.org.id, w.member.id, { purpose: "LIBRARY", workspaceId: w.space.id });
    await loginAs(w.member.id);
    const a = await readChat(p.att.id);
    expect(a.status).toBe(404);
    expect(a.json?.["message"]).toBe("features.off");
    expect((await readFile(lib.id)).status).toBe(404);
    expect(seen).toHaveLength(0);
    expect((await detailOf(w.topic.id)).imageOcr).toBe(false);
    expect(await db.fileText.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("switch on but no service: a plain answer, nothing sent, no button; a half-set service (no model) is no service", async () => {
    const w = await world();
    const p = await picture(w, w.topic.id);
    await loginAs(w.member.id);
    const res = await readChat(p.att.id);
    expect(res.status).toBe(409);
    expect(res.json?.["message"]).toBe("imageOcr.err_not_configured");
    process.env["OCR_URL"] = "http://ocr:8000";
    expect((await readChat(p.att.id)).json?.["message"]).toBe("imageOcr.err_not_configured");
    expect(seen).toHaveLength(0);
    expect((await detailOf(w.topic.id)).imageOcr).toBe(false);
  });

  it("the address guard: a public IP, a metadata address or a plain-http public name is never called", async () => {
    const w = await world();
    const p = await picture(w, w.topic.id);
    await loginAs(w.member.id);
    for (const url of ["http://8.8.8.8", "http://169.254.169.254", "http://vision.example.com", "https://8.8.8.8", "ftp://ocr", "https://user:pw@vision.example.com"]) {
      setup({ OCR_URL: url });
      const res = await readChat(p.att.id);
      expect(res.json?.["message"], url).toBe("imageOcr.err_not_configured");
    }
    expect(seen).toHaveLength(0);
    // an https public name and an inside name are both accepted, and the outside one is marked so its socket takes public addresses only
    setup({ OCR_URL: "https://vision.example.com/v1/" });
    expect((await readChat(p.att.id)).status).toBe(200);
    expect(seen[0]?.url).toBe("https://vision.example.com/v1/chat/completions");
    expect(seen[0]?.external).toBe(true);
    setup({ OCR_URL: "http://ocr:8000" });
    expect((await readChat(p.att.id, true)).status).toBe(200);
    expect(seen[1]?.url).toBe("http://ocr:8000/v1/chat/completions");
    expect(seen[1]?.external).toBeUndefined();
  });
});

describe("reading a chat picture", () => {
  it("sends the picture once as a data URL with the exact-text prompt, keeps the text, and the second ask sends nothing", async () => {
    setup();
    const w = await world();
    const p = await picture(w, w.topic.id);
    await loginAs(w.member.id);
    expect((await detailOf(w.topic.id)).imageOcr).toBe(true);

    const first = await readChat(p.att.id);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ text: "فاتورة رقم 4821", cached: false });
    expect(seen).toHaveLength(1);
    const req = seen[0] as LocalHttpRequest;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://ocr:8000/v1/chat/completions");
    const body = JSON.parse(req.body as string) as { model: string; messages: { content: { type: string; text?: string; image_url?: { url: string } }[] }[] };
    expect(body.model).toBe("qwen-vl");
    const parts = body.messages[0]?.content ?? [];
    expect(parts[0]?.text).toContain("exactly as written");
    expect(parts[1]?.image_url?.url).toBe(`data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
    expect(req.headers["authorization"]).toBeUndefined();

    const row = await db.fileText.findUniqueOrThrow({ where: { fileId: p.file.id } });
    expect(row).toMatchObject({ text: "فاتورة رقم 4821", orgId: w.org.id });

    // anybody else who may read the conversation gets the kept text, instantly
    await loginAs(w.sara.id);
    expect((await readChat(p.att.id)).json).toMatchObject({ text: "فاتورة رقم 4821", cached: true });
    expect(seen).toHaveLength(1);
  });

  it("«اقرا من جديد» sends again and replaces the text; one row per file", async () => {
    setup();
    const w = await world();
    const p = await picture(w, w.topic.id);
    await loginAs(w.member.id);
    await readChat(p.att.id);
    answer = said("نص جديد");
    const again = await readChat(p.att.id, true);
    expect(again.json).toMatchObject({ text: "نص جديد", cached: false });
    expect(seen).toHaveLength(2);
    expect((await db.fileText.findMany({ where: { fileId: p.file.id } })).map((r) => r.text)).toEqual(["نص جديد"]);
  });

  it("only a person who may read the conversation: another space, a restricted topic, a deleted message", async () => {
    setup();
    const w = await world();
    const open = await picture(w, w.topic.id);
    const hidden = await picture(w, w.secret.id);
    // another space's admin
    await loginAs(w.admin.id);
    expect((await readChat(open.att.id)).status).toBe(404);
    // a member of the space who is not in the restricted topic
    await loginAs(w.sara.id);
    expect((await readChat(open.att.id)).status).toBe(200);
    expect((await readChat(hidden.att.id)).status).toBe(404);
    expect((await readFile(hidden.file.id)).status).toBe(404);
    // a stranger from nowhere
    const stranger = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "غريب" });
    await loginAs(stranger.id);
    expect((await readChat(open.att.id)).status).toBe(404);
    expect(seen).toHaveLength(1);
    // the owner reads silently
    await loginAs(w.owner.id);
    expect((await readChat(hidden.att.id)).status).toBe(200);
    // a deleted message's picture: gone for the member, still there for the owner
    await db.chatMessage.update({ where: { id: open.msg.id }, data: { deletedAt: new Date() } });
    await loginAs(w.member.id);
    expect((await readChat(open.att.id)).status).toBe(404);
    await loginAs(w.owner.id);
    expect((await readChat(open.att.id)).status).toBe(200);
  });

  it("an attachment of ANOTHER company, an unknown id and a voice note are «not found»", async () => {
    setup();
    const w = await world();
    const w2 = await world();
    const foreign = await picture(w2, w2.topic.id);
    await loginAs(w.member.id);
    expect((await readChat(foreign.att.id)).status).toBe(404);
    expect((await readChat("nope")).status).toBe(404);
    const voice = await store(w.org.id, w.member.id, { purpose: "CHAT", mime: "audio/webm", bytes: new Uint8Array([1, 2, 3]) });
    await db.storedFile.update({ where: { id: voice.id }, data: { purpose: "VOICE" } });
    const msg = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.topic.id, authorId: w.member.id, body: "v" } });
    const att = await db.messageAttachment.create({ data: { messageId: msg.id, fileId: voice.id, kind: "AUDIO" } });
    expect((await readChat(att.id)).status).toBe(404);
    expect(seen).toHaveLength(0);
  });
});

describe("guests are never near the model", () => {
  it("a guest asker is refused (403) on both doors, even in a space they are in", async () => {
    setup();
    const w = await world();
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: w.guest.id, role: "GUEST" } });
    const p = await picture(w, w.topic.id);
    const lib = await store(w.org.id, w.member.id, { purpose: "LIBRARY", workspaceId: w.space.id });
    await loginAs(w.guest.id);
    expect((await readChat(p.att.id)).status).toBe(403);
    expect((await readFile(lib.id)).status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it("a conversation a guest can reach is refused for staff too, and its log draws no button; nothing is sent", async () => {
    setup();
    const w = await world();
    const p = await picture(w, w.topic.id);
    await loginAs(w.member.id);
    expect((await detailOf(w.topic.id)).imageOcr).toBe(true);
    // a guest joins the space: its open topic now reaches them
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: w.guest.id, role: "GUEST" } });
    const refused = await readChat(p.att.id);
    expect(refused.status).toBe(403);
    expect(refused.json?.["message"]).toBe("imageOcr.err_guest");
    expect((await detailOf(w.topic.id)).imageOcr).toBe(false);
    // a text kept BEFORE the guest came is not handed out either
    await db.fileText.create({ data: { fileId: p.file.id, orgId: w.org.id, text: "قديم" } });
    expect((await readChat(p.att.id)).status).toBe(403);
    // the restricted topic without the guest's row is still fine
    const hidden = await picture(w, w.secret.id);
    expect((await readChat(hidden.att.id)).status).toBe(200);
    // …and a private chat of two staff
    const dm = await db.conversation.create({ data: { orgId: w.org.id, kind: "DM", dmKey: `${w.member.id}|${w.sara.id}`, members: { create: [{ userId: w.member.id }, { userId: w.sara.id }] } } });
    const dmPic = await picture(w, dm.id);
    expect((await readChat(dmPic.att.id)).status).toBe(200);
    expect(seen).toHaveLength(2);
  });
});

describe("limits: type and size", () => {
  it("png / jpeg / webp only, judged by the stored type AND by the bytes; nothing is sent for the others", async () => {
    setup();
    const w = await world();
    await loginAs(w.member.id);
    const gif = await picture(w, w.topic.id, { mime: "image/gif" });
    expect((await readChat(gif.att.id)).json?.["message"]).toBe("imageOcr.err_type");
    const fake = await picture(w, w.topic.id, { mime: "image/png", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4, 5, 6, 7, 8]) });
    expect((await readChat(fake.att.id)).json?.["message"]).toBe("imageOcr.err_type");
    expect(seen).toHaveLength(0);
    const jpeg = await picture(w, w.topic.id, { mime: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]) });
    expect((await readChat(jpeg.att.id)).status).toBe(200);
    const webp = await picture(w, w.topic.id, { mime: "image/webp", bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]) });
    expect((await readChat(webp.att.id)).status).toBe(200);
    expect(JSON.parse(seen[0]?.body as string).messages[0].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(JSON.parse(seen[1]?.body as string).messages[0].content[1].image_url.url).toMatch(/^data:image\/webp;base64,/);
  });

  it("over 6 MB is refused before the picture is read or sent", async () => {
    setup();
    const w = await world();
    await loginAs(w.member.id);
    const big = await picture(w, w.topic.id, { size: 6 * 1024 * 1024 + 1 });
    const res = await readChat(big.att.id);
    expect(res.status).toBe(409);
    expect(res.json?.["message"]).toBe("imageOcr.err_big");
    expect(seen).toHaveLength(0);
  });

  it("a service that fails, is down or finds no text answers a key and stores nothing", async () => {
    setup({ OCR_API_KEY: KEY });
    const w = await world();
    await loginAs(w.member.id);
    const p = await picture(w, w.topic.id);
    answer = { status: 500, text: `boom http://ocr:8000 ${KEY}` };
    const failed = await readChat(p.att.id);
    expect(failed.status).toBe(502);
    expect(failed.json?.["message"]).toBe("imageOcr.err_failed");
    answer = new Error(`ECONNREFUSED ocr:8000 ${KEY}`);
    const down = await readChat(p.att.id);
    expect(down.status).toBe(502);
    expect(down.json?.["message"]).toBe("imageOcr.err_down");
    answer = said("   ");
    const empty = await readChat(p.att.id);
    expect(empty.status).toBe(409);
    expect(empty.json?.["message"]).toBe("imageOcr.err_empty");
    for (const r of [failed, down, empty]) {
      expect(r.text).not.toContain(KEY);
      expect(r.text).not.toContain("ocr:8000");
    }
    expect(await db.fileText.count({ where: { fileId: p.file.id } })).toBe(0);
  });

  it("a text over 20 000 characters is cut", async () => {
    setup();
    const w = await world();
    await loginAs(w.member.id);
    const p = await picture(w, w.topic.id);
    answer = said("ا".repeat(25_000));
    const res = await readChat(p.att.id);
    expect((res.json?.["text"] as string).length).toBe(20_000);
    expect((await db.fileText.findUniqueOrThrow({ where: { fileId: p.file.id } })).text.length).toBe(20_000);
  });
});

describe("the library", () => {
  it("a space member reads a library picture of the space; another space's admin and a person without the library box do not", async () => {
    setup();
    const w = await world();
    const lib = await store(w.org.id, w.member.id, { purpose: "LIBRARY", workspaceId: w.space.id, name: "scan.png" });
    await loginAs(w.member.id);
    const ok = await readFile(lib.id);
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ cached: false });
    await loginAs(w.admin.id);
    expect((await readFile(lib.id)).status).toBe(404);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.sara.id } }, data: { revokedCapabilities: ["files.view"] } });
    await loginAs(w.sara.id);
    expect((await readFile(lib.id)).status).toBe(403);
    expect(seen).toHaveLength(1);
  });

  it("the library list says whether the button is drawn", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.space.id);
    expect((await call(filesRoute.GET)).json?.["ocr"]).toBe(false);
    setup();
    expect((await call(filesRoute.GET)).json?.["ocr"]).toBe(true);
    await setSwitch(w.org.id, "imageOcr", false);
    expect((await call(filesRoute.GET)).json?.["ocr"]).toBe(false);
  });
});

describe("the trace, the rate limit and the key", () => {
  it("one audit row per reading, counters only: never the text, the picture, the address or the key", async () => {
    setup({ OCR_API_KEY: KEY });
    const w = await world();
    await loginAs(w.member.id);
    const p = await picture(w, w.topic.id);
    await readChat(p.att.id);
    await readChat(p.att.id); // cached: nothing reached the service, nothing to trace
    const rows = await audits(w.org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: w.member.id, target: p.file.id, meta: { outcome: "read", bytes: PNG.length, chars: "فاتورة رقم 4821".length, again: false } });
    const dump = JSON.stringify(rows);
    for (const secret of [KEY, "4821", "ocr:8000", Buffer.from(PNG).toString("base64")]) expect(dump).not.toContain(secret);
  });

  it("the key goes in the ONE header to the service and nowhere else: not in an answer, a row, the audit log or a screen's data", async () => {
    setup({ OCR_API_KEY: KEY });
    const w = await world();
    await loginAs(w.member.id);
    const p = await picture(w, w.topic.id);
    const ok = await readChat(p.att.id);
    expect(seen[0]?.headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(seen[0]?.body).not.toContain(KEY);
    expect(ok.text).not.toContain(KEY);
    expect(JSON.stringify(await db.fileText.findMany())).not.toContain(KEY);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { orgId: w.org.id } }))).not.toContain(KEY);
    expect(JSON.stringify(await detailOf(w.topic.id))).not.toContain(KEY);
    expect(JSON.stringify((await call(filesRoute.GET)).json)).not.toContain(KEY);
  });

  it("ten readings a minute for a person: the eleventh is 429; cached answers do not count", async () => {
    setup();
    const w = await world();
    await loginAs(w.member.id);
    const p = await picture(w, w.topic.id);
    for (let i = 0; i < 10; i++) expect((await readChat(p.att.id, true)).status).toBe(200);
    const eleventh = await readChat(p.att.id, true);
    expect(eleventh.status).toBe(429);
    expect(eleventh.json?.["message"]).toBe("imageOcr.err_rate");
    expect(seen).toHaveLength(10);
    expect((await readChat(p.att.id)).status).toBe(200); // the kept text still opens
    expect(seen).toHaveLength(10);
    ocrUserLimiter.reset(`ocr.user.${w.member.id}`);
    ocrOrgLimiter.reset(`ocr.org.${w.org.id}`);
  });
});

describe("search finds a picture by the words inside it, only for those who may see it", () => {
  const token = () => `zq${uid().slice(0, 6)}`;
  type Hit = { id: string; name?: string; snippet?: string; conversationId?: string };
  const search = async (q: string) =>
    (await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(q)}` })).json as unknown as { files: Hit[]; messages: Hit[] };
  const keep = (fileId: string, orgId: string, text: string) => db.fileText.create({ data: { fileId, orgId, text } });

  it("a library picture: found by its text for a space member (with a piece of the text), not by another space, not without the box, not a guest", async () => {
    const w = await world();
    const word = token();
    const lib = await store(w.org.id, w.member.id, { purpose: "LIBRARY", workspaceId: w.space.id, name: "scan-1.png" });
    await keep(lib.id, w.org.id, `الفاتورة رقم ${word} بتاريخ اليوم`);
    await loginAs(w.member.id);
    enter(w.space.id);
    const hit = (await search(word)).files;
    expect(hit.map((f) => f.id)).toEqual([lib.id]);
    expect(hit[0]?.snippet).toContain(word);
    // the name hit comes first and carries no snippet
    const named = await store(w.org.id, w.member.id, { purpose: "LIBRARY", workspaceId: w.space.id, name: `${word}.png` });
    const both = (await search(word)).files;
    expect(both.map((f) => f.id)).toEqual([named.id, lib.id]);
    expect(both[0]?.snippet).toBeUndefined();

    // another space finds nothing of it
    await loginAs(w.admin.id);
    enter(w.other.id);
    expect((await search(word)).files).toEqual([]);
    // a colleague of the space finds it, until her library box is taken away
    await loginAs(w.sara.id);
    enter(w.space.id);
    expect((await search(word)).files.map((f) => f.id)).toContain(lib.id);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.sara.id } }, data: { revokedCapabilities: ["files.view"] } });
    expect((await search(word)).files).toEqual([]);
    // a guest never gets the library
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: w.guest.id, role: "GUEST" } });
    await loginAs(w.guest.id);
    enter(w.space.id);
    expect((await search(word)).files).toEqual([]);
  });

  it("an old version and a deleted file are not found by their text", async () => {
    const w = await world();
    const word = token();
    const old = await store(w.org.id, w.member.id, { purpose: "LIBRARY", workspaceId: w.space.id });
    const gone = await store(w.org.id, w.member.id, { purpose: "LIBRARY", workspaceId: w.space.id });
    await db.storedFile.update({ where: { id: old.id }, data: { isLatest: false } });
    await db.storedFile.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    await keep(old.id, w.org.id, `old ${word}`);
    await keep(gone.id, w.org.id, `gone ${word}`);
    await loginAs(w.member.id);
    enter(w.space.id);
    expect((await search(word)).files).toEqual([]);
  });

  it("a chat picture: its message is found by the words in the picture, for the readers of the conversation only", async () => {
    const w = await world();
    const word = token();
    const open = await picture(w, w.topic.id);
    const hidden = await picture(w, w.secret.id);
    await keep(open.file.id, w.org.id, `ملصق فيه ${word} واضح`);
    await keep(hidden.file.id, w.org.id, `سري ${word}`);
    await loginAs(w.member.id);
    enter(w.space.id);
    const mine = (await search(word)).messages;
    expect(mine.map((m) => m.id).sort()).toEqual([open.msg.id, hidden.msg.id].sort());
    expect(mine.find((m) => m.id === open.msg.id)?.snippet).toContain(word);
    // sara is in the space but not in the restricted topic
    await loginAs(w.sara.id);
    expect((await search(word)).messages.map((m) => m.id)).toEqual([open.msg.id]);
    // another space's admin finds nothing
    await loginAs(w.admin.id);
    enter(w.other.id);
    expect((await search(word)).messages).toEqual([]);
    // a deleted message is not found by its picture
    await db.chatMessage.update({ where: { id: open.msg.id }, data: { deletedAt: new Date() } });
    await loginAs(w.sara.id);
    enter(w.space.id);
    expect((await search(word)).messages).toEqual([]);
  });

  it("inside one conversation: the message with the picture is a hit, in a conversation one may open only", async () => {
    const w = await world();
    const word = token();
    const open = await picture(w, w.topic.id);
    const hidden = await picture(w, w.secret.id);
    await keep(open.file.id, w.org.id, `نص ${word}`);
    await keep(hidden.file.id, w.org.id, `نص ${word}`);
    await loginAs(w.sara.id);
    const here = await call(convSearchRoute.GET, { url: `http://localhost/x?q=${word}`, params: { id: w.topic.id } });
    expect((here.json as unknown as { hits: Hit[] }).hits.map((h) => h.id)).toEqual([open.msg.id]);
    expect((await call(convSearchRoute.GET, { url: `http://localhost/x?q=${word}`, params: { id: w.secret.id } })).status).toBe(404);
  });

  it("switch off: the kept texts are not searched (the pictures are still found by name); switched on again they are back", async () => {
    const w = await world();
    const word = token();
    const open = await picture(w, w.topic.id);
    const lib = await store(w.org.id, w.member.id, { purpose: "LIBRARY", workspaceId: w.space.id, name: "plain.png" });
    await keep(open.file.id, w.org.id, `a ${word}`);
    await keep(lib.id, w.org.id, `b ${word}`);
    await loginAs(w.member.id);
    enter(w.space.id);
    expect((await search(word)).files.map((f) => f.id)).toEqual([lib.id]);
    await setSwitch(w.org.id, "imageOcr", false);
    const off = await search(word);
    expect(off.files).toEqual([]);
    expect(off.messages).toEqual([]);
    expect((await search("plain")).files.map((f) => f.id)).toEqual([lib.id]);
    await setSwitch(w.org.id, "imageOcr", true);
    expect((await search(word)).messages.map((m) => m.id)).toEqual([open.msg.id]);
  });

  it("another company never finds the text", async () => {
    const w = await world();
    const w2 = await world();
    const word = token();
    const lib = await store(w.org.id, w.member.id, { purpose: "LIBRARY", workspaceId: w.space.id });
    await keep(lib.id, w.org.id, `x ${word}`);
    await loginAs(w2.member.id);
    enter(w2.space.id);
    const res = await search(word);
    expect(res.files).toEqual([]);
    expect(res.messages).toEqual([]);
  });
});
