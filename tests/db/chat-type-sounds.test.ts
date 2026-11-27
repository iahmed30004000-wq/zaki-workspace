/**
 * «صوت لكل نوع إشعار» — what the server owes it, against a real database: the choices are saved on the person's own account beside the five sounds (and nobody else's), a wrong
 * value is refused, and a reader is told when the message answered is THEIR OWN (the screen needs it to ring the «رد على رسالتك» sound).
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as prefsRoute from "@/app/api/me/chat-prefs/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import type { ConversationDto, MessageDto } from "@/server/chat/dto";
import { call, db, loginAs, logout, makeTeam, makeUser, makeWorkspace } from "./helpers";

const URL = "http://localhost/api/me/chat-prefs";
const put = (body: unknown) => call(prefsRoute.PUT, { method: "PUT", url: URL, body });
const get = async () => ((await call(prefsRoute.GET, { method: "GET", url: URL })).json as { prefs: { sounds?: Record<string, string> } }).prefs;

beforeEach(() => logout());

describe("the choices on the account", () => {
  it("each kind's sound is saved for the person who chose it, and read back", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const sounds = { inChat: "tick", typePrivate: "bell", typeTopics: "none", typeMentions: "drop", typeReplies: "custom:abc123", ring: "ring-wave" };
    expect((await put({ sounds })).status).toBe(200);
    expect((await get()).sounds).toEqual(sounds);
    await loginAs(t.admin.id);
    expect((await get()).sounds).toBeUndefined();
    expect((await db.user.findUniqueOrThrow({ where: { id: t.admin.id }, select: { chatPrefs: true } })).chatPrefs).toBeNull();
  });

  it("a value that is not a sound is refused and nothing changes", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    await put({ sounds: { typePrivate: "bell" } });
    expect((await put({ sounds: { typePrivate: "http://elsewhere/x" } })).status).toBeGreaterThanOrEqual(400);
    expect((await get()).sounds).toEqual({ typePrivate: "bell" });
  });
});

describe("«رد على رسالتك»", () => {
  it("the author of the quoted message is told it is theirs; every other reader is not", async () => {
    const t = await makeTeam();
    const peer = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Peer" });
    const space = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: peer.id }, { userId: t.admin.id }]);
    const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: space.id, title: "General" } });
    await loginAs(t.member.id);
    const question = (await call(messagesRoute.POST, { params: { id: topic.id }, body: { body: "سؤال" } })).json as unknown as MessageDto;
    await loginAs(peer.id);
    const answer = (await call(messagesRoute.POST, { params: { id: topic.id }, body: { body: "جواب", replyToId: question.id } })).json as unknown as MessageDto;
    expect(answer.replyTo?.mine).toBeUndefined();
    const read = async () => ((await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${topic.id}`, params: { id: topic.id } })).json as unknown as ConversationDto).messages.find((m) => m.id === answer.id);
    await loginAs(t.member.id);
    expect((await read())?.replyTo?.mine).toBe(true);
    await loginAs(t.admin.id);
    expect((await read())?.replyTo?.mine).toBeUndefined();
  });
});
