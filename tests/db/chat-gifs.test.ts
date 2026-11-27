/**
 * «صور متحركة» — the GIF library's rules against a real database.
 *
 *  - a person keeps a GIF only from a live message in a conversation they can read by the ordinary rule (silent oversight keeps nothing)
 *  - a kept one is a POINTER: leaving the space, a deleted message or a purged conversation puts it out of the list, the file door and the send; access that comes back brings it back
 *  - another live copy the person can read keeps it; their own upload is theirs wherever it was sent
 *  - one tap sends it: the same right to write as any message; the new conversation's people read it through the ordinary attachment door and nobody else gains anything
 *  - nobody uses another person's library row
 *  - an upload takes GIFs only, is left alone by the sweep of unsent chat uploads, and is capped
 *  - the switch closes every door and loses nothing
 */
import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as listRoute from "@/app/api/chat/gifs/route";
import * as uploadRoute from "@/app/api/chat/gifs/upload/route";
import * as sendRoute from "@/app/api/chat/gifs/send/route";
import * as rowRoute from "@/app/api/chat/gifs/[id]/route";
import * as fileRoute from "@/app/api/chat/gifs/[id]/file/route";
import * as attachmentRoute from "@/app/api/chat/attachments/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as headerRoute from "@/app/api/chat/conversations/[id]/header/route";
import { openDm } from "@/server/chat/dm";
import { purgeConversation } from "@/server/chat/purge";
import { createChatUpload, purgeOrphanUploads } from "@/server/chat/attachments";
import { uploadMyGif } from "@/server/chat/gifs";
import { GIF_MAX_SAVED, type GifListDto } from "@/lib/chat/gifs";
import type { ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { withFeature, type FeatureKey } from "@/lib/features";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/** A real one-pixel GIF. */
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function setSwitch(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world() {
  const t = await makeTeam();
  await setSwitch(t.org.id, "chatLayoutV2", true);
  const space = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.guest.id, role: "GUEST" }]);
  const peer = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Peer" });
  await db.workspaceMember.create({ data: { workspaceId: space.id, userId: peer.id, role: "MEMBER" } });
  const stranger = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Stranger" });
  const away = await makeWorkspace(t.org.id, [{ userId: stranger.id }, { userId: t.member.id }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: space.id, title: "General" } });
  const second = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: away.id, title: "Away" } });
  return { ...t, space, away, peer, stranger, topic, second };
}
type World = Awaited<ReturnType<typeof world>>;

const ctxOf = (w: World, userId: string, orgRole: "MEMBER" | "OWNER" | "GUEST" = "MEMBER") => ({ orgId: w.org.id, orgRole, userId });

/** `author` posts a real GIF into a conversation through the ordinary upload and send; answers the message and its attachment. */
async function post(w: World, author: string, conversationId: string): Promise<{ messageId: string; attachmentId: string; fileId: string }> {
  await loginAs(author);
  const made = await createChatUpload({ actor: { orgId: w.org.id, userId: author, role: "MEMBER" } as never, name: "dance.gif", bytes: GIF, declaredKind: "IMAGE" });
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { attachmentIds: [made.id] } });
  expect(res.status, res.text).toBe(201);
  const att = await db.messageAttachment.findFirstOrThrow({ where: { fileId: made.id } });
  return { messageId: att.messageId!, attachmentId: att.id, fileId: made.id };
}

const keep = (attachmentId: string) => call(listRoute.POST, { body: { attachmentId } });
const list = async (): Promise<GifListDto> => (await call(listRoute.GET, { method: "GET" })).json as unknown as GifListDto;
const send = (body: Record<string, unknown>) => call(sendRoute.POST, { body });
const drop = (id: string) => call(rowRoute.DELETE, { method: "DELETE", params: { id } });
async function bytes(handler: unknown, id: string) {
  const res = await (handler as (req: Request, ctx: { params: { id: string } }) => Promise<Response>)(new Request("http://localhost/api/x"), { params: { id } });
  return { status: res.status, body: new Uint8Array(await res.arrayBuffer()) };
}
const fileOf = (savedId: string) => bytes(fileRoute.GET, savedId);
const savedRows = (userId: string) => db.savedGif.count({ where: { userId } });

/** The member keeps the GIF the peer posted in the open topic. */
async function kept(w: World) {
  const source = await post(w, w.peer.id, w.topic.id);
  await loginAs(w.member.id);
  const res = await keep(source.attachmentId);
  expect(res.status, res.text).toBe(201);
  return { ...source, savedId: (res.json as { id: string }).id };
}

describe("keeping a GIF from a conversation", () => {
  it("a person who reads it keeps it once; it is listed with an address that judges the reader, and its bytes come back", async () => {
    const w = await world();
    const k = await kept(w);
    expect((await keep(k.attachmentId)).status).toBe(201);
    expect(await savedRows(w.member.id)).toBe(1);
    const mine = await list();
    expect(mine.saved).toHaveLength(1);
    expect(mine.saved[0]).toMatchObject({ savedId: k.savedId, url: `/api/chat/gifs/${k.savedId}/file` });
    const got = await fileOf(k.savedId);
    expect(got.status).toBe(200);
    expect([...got.body]).toEqual([...GIF]);
  });

  it("somebody who cannot read the conversation keeps nothing: «not found», no row", async () => {
    const w = await world();
    const source = await post(w, w.peer.id, w.topic.id);
    await loginAs(w.stranger.id);
    const res = await keep(source.attachmentId);
    expect(res.status).toBe(404);
    expect(res.text).toContain("gifs.e.not_found");
    expect(await savedRows(w.stranger.id)).toBe(0);
    expect((await send({ conversationId: w.second.id, attachmentId: source.attachmentId })).status).toBe(404);
  });

  it("a picture that is not a GIF, and a deleted message, are not kept", async () => {
    const w = await world();
    await loginAs(w.peer.id);
    const png = await createChatUpload({ actor: { orgId: w.org.id, userId: w.peer.id, role: "MEMBER" } as never, name: "a.png", bytes: PNG, declaredKind: "IMAGE" });
    expect((await call(messagesRoute.POST, { params: { id: w.topic.id }, body: { attachmentIds: [png.id] } })).status).toBe(201);
    const att = await db.messageAttachment.findFirstOrThrow({ where: { fileId: png.id } });
    await loginAs(w.member.id);
    expect((await keep(att.id)).status).toBe(404);
    const source = await post(w, w.peer.id, w.topic.id);
    await db.chatMessage.update({ where: { id: source.messageId }, data: { deletedAt: new Date() } });
    await loginAs(w.member.id);
    expect((await keep(source.attachmentId)).status).toBe(404);
  });

  it("the owner who only reads a private chat in silence keeps nothing from it, and leaves no row", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const dm = await openDm(ctxOf(w, w.member.id), w.peer.id, w.space.id);
    const source = await post(w, w.peer.id, dm.id);
    await loginAs(w.owner.id);
    expect((await keep(source.attachmentId)).status).toBe(404);
    expect(await savedRows(w.owner.id)).toBe(0);
  });

  it("a guest keeps from a topic of their space, and from nowhere else", async () => {
    const w = await world();
    const here = await post(w, w.peer.id, w.topic.id);
    const there = await post(w, w.stranger.id, w.second.id);
    await loginAs(w.guest.id);
    expect((await keep(here.attachmentId)).status).toBe(201);
    expect((await keep(there.attachmentId)).status).toBe(404);
  });
});

describe("losing access to where it came from", () => {
  async function expectOutOfReach(w: World, savedId: string) {
    await loginAs(w.member.id);
    const mine = await list();
    expect(mine.saved).toEqual([]);
    expect(JSON.stringify(mine)).not.toContain(savedId);
    expect((await fileOf(savedId)).status).toBe(404);
    const res = await send({ conversationId: w.second.id, savedId });
    expect(res.status, res.text).toBe(404);
    expect(await db.chatMessage.count({ where: { conversationId: w.second.id, authorId: w.member.id } })).toBe(0);
  }

  it("removed from the space: not listed, not read, not sent; the row stays and comes back with the access", async () => {
    const w = await world();
    const k = await kept(w);
    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.space.id, userId: w.member.id } } });
    await expectOutOfReach(w, k.savedId);
    expect(await savedRows(w.member.id)).toBe(1);
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: w.member.id, role: "MEMBER" } });
    await loginAs(w.member.id);
    expect((await list()).saved.map((g) => g.savedId)).toEqual([k.savedId]);
  });

  it("the source message is deleted", async () => {
    const w = await world();
    const k = await kept(w);
    await loginAs(w.peer.id);
    expect((await call(messageRoute.DELETE, { method: "DELETE", params: { id: k.messageId } })).status).toBeLessThan(300);
    await expectOutOfReach(w, k.savedId);
  });

  it("the conversation is purged by the owner", async () => {
    const w = await world();
    const k = await kept(w);
    await purgeConversation(ctxOf(w, w.owner.id, "OWNER"), w.topic.id);
    await expectOutOfReach(w, k.savedId);
  });

  it("another live copy the person can read keeps it", async () => {
    const w = await world();
    const k = await kept(w);
    await loginAs(w.member.id);
    expect((await send({ conversationId: w.second.id, savedId: k.savedId })).status).toBe(201);
    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.space.id, userId: w.member.id } } });
    expect((await list()).saved.map((g) => g.savedId)).toEqual([k.savedId]);
    expect((await fileOf(k.savedId)).status).toBe(200);
  });
});

describe("one tap sends it", () => {
  it("a message with no words and the same file; the target's people read it through the attachment door, nobody else does", async () => {
    const w = await world();
    const k = await kept(w);
    await loginAs(w.member.id);
    const res = await send({ conversationId: w.second.id, savedId: k.savedId, clientId: "gif-1" });
    expect(res.status, res.text).toBe(201);
    const dto = res.json as unknown as MessageDto;
    expect(dto.kind).toBe("TEXT");
    expect(dto.body).toBe("");
    expect(dto.attachments).toHaveLength(1);
    expect(dto.attachments[0]).toMatchObject({ kind: "IMAGE", mime: "image/gif" });
    expect(dto.forwardedFrom).toBeUndefined();
    const link = await db.messageAttachment.findFirstOrThrow({ where: { messageId: dto.id } });
    expect(link.fileId).toBe(k.fileId);
    // the stranger is in the target and not in the source: they read the NEW message's attachment, never the source's
    await loginAs(w.stranger.id);
    expect((await bytes(attachmentRoute.GET, link.id)).status).toBe(200);
    expect((await bytes(attachmentRoute.GET, k.attachmentId)).status).toBe(404);
    // the peer is in the source and not in the target
    await loginAs(w.peer.id);
    expect((await bytes(attachmentRoute.GET, link.id)).status).toBe(404);
  });

  it("a retry with the same id is the same message", async () => {
    const w = await world();
    const k = await kept(w);
    await loginAs(w.member.id);
    const first = await send({ conversationId: w.second.id, savedId: k.savedId, clientId: "gif-retry" });
    const again = await send({ conversationId: w.second.id, savedId: k.savedId, clientId: "gif-retry" });
    expect((again.json as { id: string }).id).toBe((first.json as { id: string }).id);
    expect(await db.chatMessage.count({ where: { conversationId: w.second.id, authorId: w.member.id } })).toBe(1);
    expect(await db.messageAttachment.count({ where: { fileId: k.fileId } })).toBe(2);
  });

  it("only where the person may write: a closed topic, a restricted topic they are not in and an unknown one take nothing", async () => {
    const w = await world();
    const k = await kept(w);
    const closed = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Closed", closedAt: new Date() } });
    const locked = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Locked", restricted: true, members: { create: [{ userId: w.peer.id }] } } });
    await loginAs(w.member.id);
    for (const conversationId of [closed.id, locked.id, uid()]) {
      const res = await send({ conversationId, savedId: k.savedId });
      expect(res.status, res.text).toBeGreaterThanOrEqual(400);
    }
    expect(await db.messageAttachment.count({ where: { fileId: k.fileId } })).toBe(1);
  });

  it("exactly one source, and never a file id", async () => {
    const w = await world();
    const k = await kept(w);
    await loginAs(w.member.id);
    expect((await send({ conversationId: w.second.id })).status).toBe(422);
    expect((await send({ conversationId: w.second.id, savedId: k.savedId, attachmentId: k.attachmentId })).status).toBe(422);
    expect((await send({ conversationId: w.second.id, fileId: k.fileId })).status).toBe(422);
    // the ordinary send cannot claim a file that is already a message's
    expect((await call(messagesRoute.POST, { params: { id: w.second.id }, body: { attachmentIds: [k.fileId] } })).status).toBeGreaterThanOrEqual(400);
  });

  it("another person's library row is nobody else's: no send, no bytes, no delete", async () => {
    const w = await world();
    const k = await kept(w);
    await loginAs(w.peer.id);
    expect((await send({ conversationId: w.topic.id, savedId: k.savedId })).status).toBe(404);
    expect((await fileOf(k.savedId)).status).toBe(404);
    expect((await drop(k.savedId)).status).toBe(404);
    expect(await savedRows(w.member.id)).toBe(1);
  });

  it("«المرسلة مؤخرًا»: my own sent GIFs only, once each, and only where I can still read", async () => {
    const w = await world();
    const mine = await post(w, w.member.id, w.topic.id);
    await post(w, w.peer.id, w.topic.id);
    await loginAs(w.member.id);
    expect((await send({ conversationId: w.second.id, attachmentId: mine.attachmentId })).status).toBe(201);
    expect((await list()).recent).toHaveLength(1);
    await db.chatMessage.updateMany({ where: { authorId: w.member.id }, data: { deletedAt: new Date() } });
    expect((await list()).recent).toEqual([]);
  });
});

describe("uploading to the library", () => {
  it("through the route: a GIF is kept as the person's own, with its own purpose; anything else is refused and keeps nothing", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const form = (name: string, data: Uint8Array) => {
      const body = new FormData();
      body.append("file", new Blob([data as unknown as BlobPart]), name);
      return new Request("http://localhost/api/chat/gifs/upload", { method: "POST", body });
    };
    const ok = await uploadRoute.POST(form("a.gif", GIF));
    expect(ok.status).toBe(201);
    const row = await db.savedGif.findFirstOrThrow({ where: { userId: w.member.id }, include: { file: true } });
    expect(row.file).toMatchObject({ purpose: "GIF", mimeType: "image/gif", uploaderId: w.member.id });
    const refused = await uploadRoute.POST(form("fake.gif", PNG));
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain("gifs.e.only_gif");
    expect(await savedRows(w.member.id)).toBe(1);
  });

  it("the sweep of unsent chat uploads leaves it alone, and it stays mine after I leave where I sent it", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const { id } = await uploadMyGif(ctxOf(w, w.member.id), { name: "mine.gif", bytes: GIF });
    const row = await db.savedGif.findUniqueOrThrow({ where: { id } });
    await db.storedFile.update({ where: { id: row.fileId }, data: { createdAt: new Date(Date.now() - 48 * 3600_000) } });
    await purgeOrphanUploads(w.org.id);
    expect(await db.storedFile.count({ where: { id: row.fileId, deletedAt: null } })).toBe(1);
    expect((await send({ conversationId: w.topic.id, savedId: id })).status).toBe(201);
    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.space.id, userId: w.member.id } } });
    expect((await list()).saved.map((g) => g.savedId)).toEqual([id]);
    expect((await fileOf(id)).status).toBe(200);
    expect((await send({ conversationId: w.second.id, savedId: id })).status).toBe(201);
  });

  it("taking out a never-sent upload puts its file out of reach; taking out a sent one leaves the message whole", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const unsent = await uploadMyGif(ctxOf(w, w.member.id), { name: "a.gif", bytes: GIF });
    const sentOne = await uploadMyGif(ctxOf(w, w.member.id), { name: "b.gif", bytes: GIF });
    const fileIdOf = async (id: string) => (await db.savedGif.findUniqueOrThrow({ where: { id } })).fileId;
    const [a, b] = [await fileIdOf(unsent.id), await fileIdOf(sentOne.id)];
    const message = (await send({ conversationId: w.topic.id, savedId: sentOne.id })).json as unknown as MessageDto;
    expect((await drop(unsent.id)).status).toBe(200);
    expect((await drop(sentOne.id)).status).toBe(200);
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: a } })).deletedAt).not.toBeNull();
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();
    await loginAs(w.peer.id);
    const link = await db.messageAttachment.findFirstOrThrow({ where: { messageId: message.id } });
    expect((await bytes(attachmentRoute.GET, link.id)).status).toBe(200);
  });

  it(`at ${GIF_MAX_SAVED} the library takes no more`, async () => {
    const w = await world();
    for (let i = 0; i < GIF_MAX_SAVED; i++) {
      const fileId = `g${uid()}${i}`;
      await db.storedFile.create({ data: { id: fileId, orgId: w.org.id, uploaderId: w.member.id, familyId: fileId, name: "x.gif", path: fileId, mimeType: "image/gif", size: 1, purpose: "GIF" } });
      await db.savedGif.create({ data: { orgId: w.org.id, userId: w.member.id, fileId } });
    }
    await expect(uploadMyGif(ctxOf(w, w.member.id), { name: "one-more.gif", bytes: GIF })).rejects.toThrow("gifs.e.too_many");
    const source = await post(w, w.peer.id, w.topic.id);
    await loginAs(w.member.id);
    const res = await keep(source.attachmentId);
    expect(res.status).toBe(403);
    expect(res.text).toContain("gifs.e.too_many");
  });
});

describe("the switch «الصور المتحركة»", () => {
  it("off: every door is «not found», the header says no, and nothing kept is lost", async () => {
    const w = await world();
    const k = await kept(w);
    await setSwitch(w.org.id, "chatGifs", false);
    await loginAs(w.member.id);
    expect((await call(listRoute.GET, { method: "GET" })).status).toBe(404);
    expect((await keep(k.attachmentId)).status).toBe(404);
    expect((await send({ conversationId: w.second.id, savedId: k.savedId })).status).toBe(404);
    expect((await fileOf(k.savedId)).status).toBe(404);
    expect((await drop(k.savedId)).status).toBe(404);
    await expect(uploadMyGif(ctxOf(w, w.member.id), { name: "a.gif", bytes: GIF })).rejects.toThrow("features.off");
    const header = async () => (await call(headerRoute.GET, { params: { id: w.topic.id } })).json as unknown as ConversationHeaderDto;
    expect((await header()).gifs).toBe(false);
    await setSwitch(w.org.id, "chatGifs", true);
    expect((await header()).gifs).toBe(true);
    expect((await list()).saved.map((g) => g.savedId)).toEqual([k.savedId]);
  });
});
