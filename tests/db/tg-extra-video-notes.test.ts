/**
 * «رسالة فيديو دائرية» on the server (`videoNotes`): the upload of kind VIDEO_NOTE is a video with its own ceilings, the message
 * that claims it carries `round` on its one attachment (the screen, the list's line and a forward keep it), and the switches refuse a new one.
 */
import { describe, expect, it } from "vitest";
import * as uploadsRoute from "@/app/api/chat/uploads/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as listRoute from "@/app/api/chat/list/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as forwardRoute from "@/app/api/chat/messages/[id]/forward/route";
import type { ChatListDto, ConversationDto } from "@/server/chat/dto";
import { VIDEO_NOTE_MAX_BYTES, VIDEO_NOTE_MAX_MS } from "@/lib/chat/v2/video-note/limits";
import { call, db, loginAs, makeTeam, makeUser } from "./helpers";

/** The head of a recorder's MP4 (`ftyp` with the `isom` brand), padded to `size` bytes. */
function mp4(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 0x18, ...Buffer.from("ftypisom")]);
  return bytes;
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function upload(bytes: Uint8Array, kind: string, extra: Record<string, string> = {}, name = "video-note.mp4") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name));
  form.append("kind", kind);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const res = await uploadsRoute.POST(new Request("http://localhost/api/chat/uploads", { method: "POST", body: form }));
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null, text };
}

async function world() {
  const t = await makeTeam();
  await loginAs(t.member.id);
  const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
  return { ...t, dm };
}

const setFeatures = (orgId: string, features: Record<string, boolean>) => db.organization.update({ where: { id: orgId }, data: { settings: { features } } });
const send = (conversationId: string, attachmentIds: unknown[]) => call(messagesRoute.POST, { params: { id: conversationId }, body: { attachmentIds } });
const headerOf = async (id: string) => (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } })).json as unknown as ConversationDto;

describe("a round video message", () => {
  it("is uploaded as a video, and the message that claims it says `round` to both people, with the length capped at a minute", async () => {
    const w = await world();
    const up = await upload(mp4(), "VIDEO_NOTE", { durationMs: String(VIDEO_NOTE_MAX_MS + 400) });
    expect(up.status, up.text).toBe(201);
    expect(up.json).toMatchObject({ kind: "VIDEO", mime: "video/mp4", durationMs: VIDEO_NOTE_MAX_MS });
    const sent = await send(w.dm, [up.json?.["id"]]);
    expect(sent.status, sent.text).toBeLessThan(300);
    expect((sent.json?.["attachments"] as unknown[])[0]).toMatchObject({ kind: "VIDEO", round: true, durationMs: VIDEO_NOTE_MAX_MS });

    await loginAs(w.admin.id);
    const seen = (await headerOf(w.dm)).messages.find((m) => m.id === sent.json?.["id"]);
    expect(seen?.attachments[0]?.round).toBe(true);
    const list = (await call(listRoute.GET, { url: "http://localhost/api/chat/list" })).json as unknown as ChatListDto;
    expect(list.rows.find((r) => r.id === w.dm)?.lastMessage?.round).toBe(true);
  });

  it("an ordinary video has no `round`, and neither has a video note sent together with another file", async () => {
    const w = await world();
    const plain = await upload(mp4(), "VIDEO");
    const first = await send(w.dm, [plain.json?.["id"]]);
    expect((first.json?.["attachments"] as Array<Record<string, unknown>>)[0]?.["round"]).toBeUndefined();

    const note = await upload(mp4(), "VIDEO_NOTE", { durationMs: "3000" });
    const picture = await upload(PNG, "IMAGE", {}, "p.png");
    const both = await send(w.dm, [note.json?.["id"], picture.json?.["id"]]);
    expect(both.status, both.text).toBeLessThan(300);
    for (const file of both.json?.["attachments"] as Array<Record<string, unknown>>) expect(file["round"]).toBeUndefined();
  });

  it("a forward is still round", async () => {
    const w = await world();
    const third = await makeUser({ orgId: w.org.id, name: "ثالث" });
    const other = (await call(dmRoute.POST, { body: { userId: third.id } })).json?.["id"] as string;
    const note = await upload(mp4(), "VIDEO_NOTE", { durationMs: "3000" });
    const sent = await send(w.dm, [note.json?.["id"]]);
    const forwarded = await call(forwardRoute.POST, { params: { id: sent.json?.["id"] as string }, body: { conversationId: other } });
    expect(forwarded.status, forwarded.text).toBeLessThan(300);
    const copy = await db.messageAttachment.findFirstOrThrow({ where: { messageId: forwarded.json?.["id"] as string } });
    expect(copy.round).toBe(true);
  });

  it("is refused when it is not a video, longer than a minute, or over its size ceiling", async () => {
    await world();
    expect((await upload(PNG, "VIDEO_NOTE", {}, "p.png")).status).toBe(403);
    const long = await upload(mp4(), "VIDEO_NOTE", { durationMs: String(VIDEO_NOTE_MAX_MS + 5000) });
    expect(long.status).toBe(403);
    expect(long.text).toContain("chat.f.video_note_long");
    const big = await upload(mp4(VIDEO_NOTE_MAX_BYTES + 1), "VIDEO_NOTE", { durationMs: "3000" });
    expect(big.status).toBe(403);
    expect(big.text).toContain("chat.f.too_large");
  });

  it("with its switch or the voice notes' switch off, a new one is refused and the header offers no camera mode; the sent one stays round", async () => {
    const w = await world();
    const note = await upload(mp4(), "VIDEO_NOTE", { durationMs: "3000" });
    const sent = await send(w.dm, [note.json?.["id"]]);
    expect((await headerOf(w.dm)).videoNotes).toBe(true);
    for (const off of ["videoNotes", "voiceNotes"]) {
      await setFeatures(w.org.id, { [off]: false });
      expect((await upload(mp4(), "VIDEO_NOTE", { durationMs: "3000" })).status, off).toBe(404);
      const header = await headerOf(w.dm);
      expect(header.videoNotes, off).toBe(false);
      expect(header.messages.find((m) => m.id === sent.json?.["id"])?.attachments[0]?.round, off).toBe(true);
    }
  });
});
