/**
 * «تعديل صورة أو ملف» against a real database: the author alone, under the rules of editing words; the old file is KEPT with the edit history and opens for the holder of
 * silent oversight only (not even its uploader); nothing reads it as one of the message's files; purge and the orphan sweep treat it as the archive rules say.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendLimiter } from "@/server/chat/messages";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as mediaRoute from "@/app/api/chat/conversations/[id]/media/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as attachmentRoute from "@/app/api/chat/attachments/[id]/route";
import { purgeOrphanUploads } from "@/server/chat/attachments";
import { purgeConversation } from "@/server/chat/purge";
import { readArchive } from "@/server/chat/archive";
import { assertMayReadFile } from "@/server/services/files";
import type { MessageDto, MessagesPageDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function world() {
  const t = await makeTeam();
  const other = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Other" });
  const space = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: other.id }, { userId: t.admin.id, role: "ADMIN" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: space.id, title: "ملفات" } });
  return { ...t, other, space, topic };
}
let w: Awaited<ReturnType<typeof world>>;
beforeAll(async () => {
  w = await world();
});
beforeEach(() => sendLimiter.reset(`chat.send.${w.member.id}`));

async function upload(uploaderId: string, name: string, purpose: "CHAT" | "VOICE" = "CHAT", ageMs = 0) {
  const id = uid();
  const dir = process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), ".data", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, id), PNG);
  return db.storedFile.create({ data: { id, orgId: w.org.id, uploaderId, familyId: id, name, mimeType: purpose === "VOICE" ? "audio/webm" : "image/png", size: PNG.length, path: id, purpose, ...(ageMs ? { createdAt: new Date(Date.now() - ageMs) } : {}) } });
}
async function sent(body: string, names: string[], conversationId = w.topic.id, extra: Record<string, unknown> = {}) {
  await loginAs(w.member.id);
  const files = [];
  for (const name of names) files.push(await upload(w.member.id, name, extra["voice"] ? "VOICE" : "CHAT"));
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { body: body || undefined, attachmentIds: files.map((f) => f.id), ...extra } });
  expect(res.status, res.text).toBe(201);
  return { dto: res.json as unknown as MessageDto, files };
}
const patch = (id: string, body: Record<string, unknown>) => call(messageRoute.PATCH, { method: "PATCH", params: { id }, body });
const bytes = async (userId: string, attachmentId: string) => {
  await loginAs(userId);
  const res = await attachmentRoute.GET(new Request(`http://localhost/api/chat/attachments/${attachmentId}`), { params: { id: attachmentId } });
  // the answer streams a file: letting go of it closes the file (left to the garbage collector it fails the whole run)
  await res.body?.cancel();
  return res.status;
};
const setSwitch = (on: boolean | null) => db.organization.update({ where: { id: w.org.id }, data: { settings: on === null ? {} : { features: { chatEditMedia: on } } } });

describe("replacing a file", () => {
  it("the author: the new file stands in the old one's place, the old row and bytes are kept with the revision, nothing is deleted", async () => {
    const { dto, files } = await sent("الصور", ["one.png", "two.png", "three.png"]);
    const second = dto.attachments[1]!;
    const fresh = await upload(w.member.id, "new-two.png");
    const res = await patch(dto.id, { body: "الصور المعدلة", replace: { attachmentId: second.id, uploadId: fresh.id } });
    expect(res.status, res.text).toBe(200);
    const after = res.json as unknown as MessageDto;
    expect(after.attachments.map((a) => a.name)).toEqual(["one.png", "new-two.png", "three.png"]);
    expect(after.edited).toBe(true);
    const old = await db.messageAttachment.findUniqueOrThrow({ where: { id: second.id } });
    const revision = await db.messageRevision.findFirstOrThrow({ where: { messageId: dto.id } });
    expect(old).toMatchObject({ messageId: null, formerMessageId: dto.id, fileId: files[1]!.id });
    expect(old.replacedAt?.getTime()).toBe(revision.createdAt.getTime());
    expect(revision.body).toBe("الصور");
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: files[1]!.id } })).deletedAt).toBeNull();
  });

  it("the old file opens for the holder of oversight only: not for a reader, not for a moderator, not even for its uploader", async () => {
    const { dto, files } = await sent("ملف", ["secret-old.png"]);
    const fresh = await upload(w.member.id, "safe-new.png");
    await loginAs(w.member.id);
    expect((await patch(dto.id, { body: "ملف", replace: { attachmentId: dto.attachments[0]!.id, uploadId: fresh.id } })).status).toBe(200);
    for (const person of [w.member.id, w.other.id, w.admin.id]) expect(await bytes(person, dto.attachments[0]!.id)).toBe(404);
    expect(await bytes(w.owner.id, dto.attachments[0]!.id)).toBe(200);
    // by the FILE's id too (the uploader's «not sent yet» door must not reopen it)
    expect(await bytes(w.member.id, files[0]!.id)).toBe(404);
    await expect(assertMayReadFile({ orgId: w.org.id, userId: w.member.id, orgRole: "MEMBER" }, files[0]!.id)).rejects.toThrow();
    await expect(assertMayReadFile({ orgId: w.org.id, userId: w.owner.id, orgRole: "OWNER" }, files[0]!.id)).resolves.toBeUndefined();
  });

  it("only the holder of oversight is told what an edit took off; the media tab and everybody's window never list it; the archive lists it", async () => {
    const { dto } = await sent("قبل", ["old-name.png"]);
    const fresh = await upload(w.member.id, "new-name.png");
    await loginAs(w.member.id);
    await patch(dto.id, { body: "بعد", replace: { attachmentId: dto.attachments[0]!.id, uploadId: fresh.id } });
    for (const person of [w.member.id, w.other.id, w.admin.id]) {
      await loginAs(person);
      const page = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages`, params: { id: w.topic.id } });
      const media = await call(mediaRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/media?kind=MEDIA&limit=100`, params: { id: w.topic.id } });
      const mine = (page.json as unknown as MessagesPageDto).messages.find((m) => m.id === dto.id)!;
      expect(JSON.stringify(mine)).not.toContain("old-name.png");
      expect(media.text).not.toContain(dto.attachments[0]!.id);
    }
    await loginAs(w.owner.id);
    const page = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages`, params: { id: w.topic.id } });
    const owners = (page.json as unknown as MessagesPageDto).messages.find((m) => m.id === dto.id)!;
    expect(owners.history?.at(-1)?.files?.map((f) => f.name)).toEqual(["old-name.png"]);
    const archive = await readArchive({ orgId: w.org.id, userId: w.owner.id, orgRole: "OWNER" }, { type: "edited" });
    expect(archive.items.find((i) => i.messageId === dto.id)?.oldFiles?.map((f) => f.name)).toEqual(["old-name.png"]);
  });

  it("the rules of editing words: the author alone, never a deleted message, never a voice note; the upload must be mine and unused", async () => {
    const { dto } = await sent("صورة", ["a.png"]);
    const { dto: another } = await sent("غيرها", ["b.png"]);
    const attachmentId = dto.attachments[0]!.id;
    const theirs = await upload(w.other.id, "theirs.png");
    const mine = await upload(w.member.id, "mine.png");
    const change = (uploadId: string, id = attachmentId) => patch(dto.id, { body: "صورة", replace: { attachmentId: id, uploadId } });
    for (const person of [w.other.id, w.admin.id, w.owner.id]) {
      await loginAs(person);
      expect((await change(theirs.id)).status).toBe(403);
    }
    await loginAs(w.member.id);
    expect((await change(theirs.id)).status).toBe(404);
    // a file another message of mine already holds: refused, and the whole edit goes back
    const used = await db.messageAttachment.findUniqueOrThrow({ where: { id: another.attachments[0]!.id } });
    expect((await change(used.fileId)).status).toBe(403);
    expect((await change(mine.id, another.attachments[0]!.id)).status).toBe(404);
    const recording = await upload(w.member.id, "v.webm", "VOICE");
    expect((await change(recording.id)).status).toBe(404);
    // nothing moved by any of those
    expect((await db.messageAttachment.findUniqueOrThrow({ where: { id: attachmentId } })).messageId).toBe(dto.id);
    expect(await db.messageRevision.count({ where: { messageId: dto.id } })).toBe(0);
    const { dto: voice } = await sent("", ["n.webm"], w.topic.id, { voice: true });
    await loginAs(w.member.id);
    expect((await patch(voice.id, { body: "x", replace: { attachmentId: voice.attachments[0]!.id, uploadId: mine.id } })).status).toBe(403);
    await db.chatMessage.update({ where: { id: dto.id }, data: { deletedAt: new Date() } });
    expect((await change(mine.id)).status).toBe(403);
  });

  it("the caption of a file may be emptied; words alone may not; with the switch off neither the swap nor the empty caption", async () => {
    const { dto } = await sent("تعليق", ["c.png"]);
    await loginAs(w.member.id);
    expect((await patch(dto.id, { body: "   " })).status).toBe(200);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: dto.id } })).body).toBe("");
    const words = await call(messagesRoute.POST, { params: { id: w.topic.id }, body: { body: "كلام بس" } });
    expect((await patch((words.json as unknown as MessageDto).id, { body: "" })).status).toBe(422);
    expect((await patch((words.json as unknown as MessageDto).id, { body: "ا".repeat(4001) })).status).toBe(422);
    await setSwitch(false);
    await loginAs(w.member.id);
    const { dto: held } = await sent("تعليق", ["d.png"]);
    const fresh = await upload(w.member.id, "e.png");
    expect((await patch(held.id, { body: "تعليق", replace: { attachmentId: held.attachments[0]!.id, uploadId: fresh.id } })).status).toBe(404);
    expect((await patch(held.id, { body: "" })).status).toBe(422);
    expect((await patch(held.id, { body: "تعليق جديد" })).status).toBe(200);
    await setSwitch(null);
  });

  it("the orphan sweep keeps a replaced file; the owner's full delete of the conversation takes it out of reach with the others", async () => {
    const doomed = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "للحذف" } });
    const { dto, files } = await sent("x", ["old.png"], doomed.id);
    const fresh = await upload(w.member.id, "new.png");
    await loginAs(w.member.id);
    await patch(dto.id, { body: "x", replace: { attachmentId: dto.attachments[0]!.id, uploadId: fresh.id } });
    await db.storedFile.update({ where: { id: files[0]!.id }, data: { createdAt: new Date(Date.now() - 48 * 3_600_000) } });
    await purgeOrphanUploads(w.org.id);
    expect(await db.storedFile.findUnique({ where: { id: files[0]!.id } })).not.toBeNull();
    await purgeConversation({ orgId: w.org.id, userId: w.owner.id, orgRole: "OWNER" }, doomed.id);
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: files[0]!.id } })).deletedAt).not.toBeNull();
  });
});
