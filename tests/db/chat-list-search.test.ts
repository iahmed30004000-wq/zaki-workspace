/**
 * C3d — the chat list's search: ONE request `GET /api/search?scope=chat&q=` that answers the chats (topics, private chats, spaces by title), the people
 * and the messages (snippet, chat, date), and the in-chat search's extras (`conversationId`, `from`, `since`). The rules it must keep:
 *  - the existing Arabic-folding search and its reading rule (`src/server/chat/search.ts`): never a snippet from a conversation the caller cannot read, never
 *    a deleted message or a system line, the formatting markers stripped from the snippet;
 *  - the people follow the directory rules: a guest gets NAMES only (and only the people of the space they share);
 *  - the route stays backward compatible: with no `scope` the answer is exactly what the search palette has always read;
 *  - it writes nothing.
 */
import { describe, expect, it } from "vitest";
import * as searchRoute from "@/app/api/search/route";
import { openDm } from "@/server/chat/dm";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeUser, uid } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

type Chat = { id: string; kind: string; title: string; emoji: string | null; context: string | null };
type Person = { id: string; name: string; avatarUrl?: string | null; jobTitle?: string | null; dmId?: string | null };
type Hit = { id: string; conversationId: string; conversationTitle: string; authorName: string; at: string; snippet: string };
type Body = { chats: Chat[]; people: Person[]; messages: Hit[] };

async function world() {
  const w = await makeTeamsWorld();
  const word = `zq${uid().slice(0, 6)}`;
  const topic = (title: string, spaceId: string, extra: Record<string, unknown> = {}) => db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId, title, ...extra } });
  const open = await topic(`Plan ${word}`, w.s.id);
  const teamY = await topic(`Y ${word}`, w.s.id, { teamId: w.y.id });
  const restricted = await topic(`Secret ${word}`, w.s.id, { restricted: true, members: { create: [{ userId: w.alice.id }, { userId: w.bob.id }] } });
  const elsewhere = await topic(`Other ${word}`, w.other.id);
  const say = (conversationId: string, body: string, extra: Record<string, unknown> = {}) =>
    db.chatMessage.create({ data: { orgId: w.org.id, conversationId, authorId: w.spaceAdmin.id, body, ...extra } });
  const ctxOf = (u: { id: string }) => ({ orgId: w.org.id, userId: u.id, orgRole: "MEMBER" as const });
  return { ...w, word, open, teamY, restricted, elsewhere, say, ctxOf };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

const scoped = async (query: string) => {
  const res = await call(searchRoute.GET, { url: `http://localhost/api/search?scope=chat&${query}` });
  return { status: res.status, json: res.json as unknown as Record<string, unknown>, body: res.json as unknown as Body, text: res.text };
};
const chatSearch = (q: string) => scoped(`q=${encodeURIComponent(q)}`);

describe("the chat list's search — one request", () => {
  it("answers chats, people and messages — and ONLY those three", async () => {
    const w = await getWorld();
    await loginAs(w.carol.id);
    enter(w.s.id);
    const r = await chatSearch(w.word);
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(["chats", "messages", "people"]);
  });

  it("chats: the topics one may open by title, the private chats by the other person's name, the spaces by name — never a topic one cannot open", async () => {
    const w = await getWorld();
    const dm = await openDm(w.ctxOf(w.carol), w.alice.id, w.s.id);
    await loginAs(w.carol.id);
    enter(w.s.id);
    // topics (carol is in no «مقطع» and not in the restricted topic)
    const topics = (await chatSearch(w.word)).body.chats.filter((c) => c.kind === "TOPIC");
    expect(topics.map((c) => c.id)).toEqual([w.open.id]);
    expect(topics[0]).toMatchObject({ title: `Plan ${w.word}`, context: w.s.name });
    // a private chat is found by the other person's name
    const byName = (await chatSearch("Alice")).body.chats.filter((c) => c.kind === "DM");
    expect(byName.map((c) => c.id)).toEqual([dm.id]);
    expect(byName[0]!.title).toBe("Alice");
    // a space by its name (the ones carol is in)
    const spaces = (await chatSearch(w.s.name.slice(0, 6))).body.chats.filter((c) => c.kind === "SPACE");
    expect(spaces.map((c) => c.id)).toContain(w.s.id);
    expect(spaces.map((c) => c.id)).not.toContain(w.other.id);
  });

  it("private chats are found by the other person's name through the same folded pool as the people: a name that STARTS with the words comes first", async () => {
    const w = await getWorld();
    const natalie = await makeUser({ orgId: w.org.id, role: "MEMBER", name: `Natalie ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: natalie.id, role: "MEMBER" } });
    const withNatalie = await openDm(w.ctxOf(w.carol), natalie.id, w.s.id);
    const withAlice = await openDm(w.ctxOf(w.carol), w.alice.id, w.s.id);
    await loginAs(w.carol.id);
    enter(w.s.id);
    const dms = (await chatSearch("ali")).body.chats.filter((c) => c.kind === "DM");
    expect(dms.map((c) => c.id)).toEqual([withAlice.id, withNatalie.id]);
    expect(dms.map((c) => c.title)).toEqual(["Alice", natalie.name]);
    // the chat is found once per person, and only the caller's own
    await loginAs(natalie.id);
    enter(w.s.id);
    expect((await chatSearch("Bob")).body.chats.filter((c) => c.kind === "DM")).toEqual([]);
  });

  it("a private chat of two OTHER people is not found by their names, and an archived topic is not offered", async () => {
    const w = await getWorld();
    await openDm(w.ctxOf(w.alice), w.bob.id, w.s.id);
    await loginAs(w.carol.id);
    enter(w.s.id);
    expect((await chatSearch("Bob")).body.chats.filter((c) => c.kind === "DM")).toEqual([]);
    const gone = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Archived ${w.word}`, archivedAt: new Date(), closedAt: new Date() } });
    expect((await chatSearch(`Archived ${w.word}`)).body.chats.map((c) => c.id)).not.toContain(gone.id);
  });

  it("messages: snippet, chat and date — never from a conversation the caller cannot read, a deleted message or a system line; the markers are stripped; Arabic is folded", async () => {
    const w = await getWorld();
    const seen = await w.say(w.open.id, `we agreed **${w.word}** on the plan`);
    await w.say(w.restricted.id, `private ${w.word}`);
    await w.say(w.teamY.id, `team Y ${w.word}`);
    await w.say(w.elsewhere.id, `elsewhere ${w.word}`);
    await w.say(w.open.id, `gone ${w.word}`, { deletedAt: new Date() });
    await w.say(w.open.id, `{"k":"join","x":"${w.word}"}`, { kind: "SYSTEM" });
    await loginAs(w.carol.id);
    enter(w.s.id);
    const r = (await chatSearch(w.word)).body;
    expect(r.messages.map((m) => m.id)).toEqual([seen.id]);
    const hit = r.messages[0]!;
    expect(hit.snippet).toContain(w.word);
    expect(hit.snippet).not.toContain("**");
    expect(hit).toMatchObject({ conversationId: w.open.id, conversationTitle: `Plan ${w.word}`, authorName: "Space admin" });
    expect(new Date(hit.at).toString()).not.toBe("Invalid Date");
    // one who IS in the restricted topic and in «مقطع» Y finds those too
    await loginAs(w.bob.id);
    enter(w.s.id);
    const bob = (await chatSearch(w.word)).body.messages.map((m) => m.conversationId).sort();
    expect(bob).toEqual([w.open.id, w.restricted.id, w.teamY.id].sort());
    // Arabic spelling is folded: «احمد» finds «أحمد»
    const arabic = await w.say(w.open.id, `قابلت أحمد ${w.word}ع في المكتب`);
    await loginAs(w.carol.id);
    enter(w.s.id);
    expect((await chatSearch(`احمد ${w.word}ع`)).body.messages.map((m) => m.id)).toEqual([arabic.id]);
  });

  it("people: the space's people with their directory fields; nobody of another space", async () => {
    const w = await getWorld();
    const stranger = await makeUser({ orgId: w.org.id, role: "MEMBER", name: `Alicia ${uid()}` });
    await loginAs(w.carol.id);
    enter(w.s.id);
    const r = (await chatSearch("Ali")).body;
    expect(r.people.map((p) => p.id)).toContain(w.alice.id);
    expect(r.people.map((p) => p.id)).not.toContain(stranger.id);
    const alice = r.people.find((p) => p.id === w.alice.id)!;
    expect(alice).toMatchObject({ name: "Alice" });
    expect("jobTitle" in alice && "dmId" in alice).toBe(true);
  });

  it("a person with a private chat already open is given its id, so the list can open it at once", async () => {
    const w = await getWorld();
    const dm = await openDm(w.ctxOf(w.carol), w.bob.id, w.s.id);
    await loginAs(w.carol.id);
    enter(w.s.id);
    const r = (await chatSearch("Bob")).body;
    expect(r.people.find((p) => p.id === w.bob.id)?.dmId).toBe(dm.id);
    expect((await chatSearch("Alice")).body.people.find((p) => p.id === w.alice.id)?.dmId).toBeTruthy();
  });

  it("a guest gets names only: no job title, no picture, no private chats — and only the people of the space they share", async () => {
    const w = await getWorld();
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `Guest ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
    await db.user.update({ where: { id: w.alice.id }, data: { jobTitle: "Secret job", avatarUrl: "/api/avatars/x" } });
    await loginAs(guest.id);
    enter(w.s.id);
    const r = await chatSearch("Alice");
    expect(r.status).toBe(200);
    expect(r.body.people.map((p) => p.id)).toContain(w.alice.id);
    for (const p of r.body.people) expect(Object.keys(p).sort()).toEqual(["id", "name"]);
    expect(r.text).not.toContain("Secret job");
    expect(r.body.chats.filter((c) => c.kind === "DM")).toEqual([]);
    // a person of no space the guest shares is not listed
    const other = (await chatSearch("Bob")).body.people.map((p) => p.id);
    expect(other).toContain(w.bob.id);
    const lonely = await makeUser({ orgId: w.org.id, role: "MEMBER", name: `Lonely ${uid()}` });
    expect((await chatSearch("Lonely")).body.people.map((p) => p.id)).not.toContain(lonely.id);
  });

  it("a word too short, a missing question, and the switch off all answer empty — and nothing is written", async () => {
    const w = await getWorld();
    await loginAs(w.carol.id);
    enter(w.s.id);
    const empty = { chats: [], people: [], messages: [] };
    expect((await chatSearch("a")).json).toEqual(empty);
    expect((await scoped("")).json).toEqual(empty);
    const before = await db.realtimeEvent.count({ where: { orgId: w.org.id } });
    await chatSearch(w.word);
    expect(await db.realtimeEvent.count({ where: { orgId: w.org.id } })).toBe(before);
  });
});

describe("the palette's search is not changed", () => {
  it("with no `scope` the answer has the same keys as ever, and a `scope` it does not know is the old answer too", async () => {
    const w = await getWorld();
    await loginAs(w.carol.id);
    enter(w.s.id);
    for (const url of [`http://localhost/api/search?q=${w.word}`, `http://localhost/api/search?scope=all&q=${w.word}`]) {
      const res = await call(searchRoute.GET, { url });
      expect(res.status).toBe(200);
      expect(Object.keys(res.json as object).sort()).toEqual(["documents", "files", "messages", "people", "projects", "tasks", "topics"]);
    }
  });
});

describe("the search inside one conversation: «من:» and the date jump", () => {
  it("`from` keeps the messages of one person (with or without words); `since` jumps to the first message of that day", async () => {
    const w = await getWorld();
    const conv = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Jump ${uid()}` } });
    const at = (iso: string) => new Date(iso);
    const mk = (authorId: string, body: string, iso: string) => db.chatMessage.create({ data: { orgId: w.org.id, conversationId: conv.id, authorId, body, createdAt: at(iso) } });
    const a1 = await mk(w.alice.id, `${w.word} one`, "2026-11-01T09:00:00.000Z");
    await mk(w.bob.id, `${w.word} two`, "2026-11-02T09:00:00.000Z");
    const a2 = await mk(w.alice.id, `${w.word} three`, "2026-11-05T09:00:00.000Z");
    const b2 = await mk(w.bob.id, "no words here", "2026-11-05T10:00:00.000Z");
    await mk(w.alice.id, "deleted", "2026-11-03T09:00:00.000Z").then((m) => db.chatMessage.update({ where: { id: m.id }, data: { deletedAt: new Date() } }));
    await loginAs(w.carol.id);
    const inChat = async (query: string) => (await scoped(`conversationId=${conv.id}&${query}`)).body as unknown as { messages: Hit[] };

    // everybody's words, then only Alice's
    expect((await inChat(`q=${w.word}`)).messages.map((m) => m.id)).toHaveLength(3);
    expect((await inChat(`q=${w.word}&from=${w.alice.id}`)).messages.map((m) => m.id)).toEqual([a2.id, a1.id]);
    // «من:» alone: everything of that person, newest first, never the deleted one
    expect((await inChat(`from=${w.bob.id}`)).messages.map((m) => m.id)).toContain(b2.id);
    expect((await inChat(`from=${w.alice.id}`)).messages.map((m) => m.id)).toEqual([a2.id, a1.id]);
    // the jump: the first message at or after the start of that day
    expect((await inChat(`since=${encodeURIComponent("2026-11-03T00:00:00.000Z")}`)).messages.map((m) => m.id)).toEqual([a2.id]);
    expect((await inChat(`since=${encodeURIComponent("2026-11-01T00:00:00.000Z")}`)).messages.map((m) => m.id)).toEqual([a1.id]);
    expect((await inChat(`since=${encodeURIComponent("2026-12-01T00:00:00.000Z")}`)).messages).toEqual([]);
    // the jump and a person: the first of THEIR messages from then on
    expect((await inChat(`since=${encodeURIComponent("2026-11-02T00:00:00.000Z")}&from=${w.bob.id}`)).messages.map((m) => m.id)).toHaveLength(1);
    // nothing asked, nothing found; a person of another company is no filter
    expect((await inChat("")).messages).toEqual([]);
    const stranger = await makeUser({ role: "MEMBER", name: "Stranger" });
    expect((await inChat(`from=${stranger.id}`)).messages).toEqual([]);
  });

  it("a conversation one cannot open is «not found» (every filter), and a guest has topics only", async () => {
    const w = await getWorld();
    await loginAs(w.carol.id);
    for (const query of [`q=${w.word}`, `from=${w.alice.id}`, `since=${encodeURIComponent("2026-11-01T00:00:00.000Z")}`]) {
      expect((await scoped(`conversationId=${w.restricted.id}&${query}`)).status).toBe(404);
    }
    expect((await scoped(`conversationId=nothing&q=${w.word}`)).status).toBe(404);
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `Guest ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
    const dm = await openDm(w.ctxOf(w.carol), w.alice.id, w.s.id);
    await loginAs(guest.id);
    expect([403, 404]).toContain((await scoped(`conversationId=${dm.id}&q=${w.word}`)).status);
    expect((await scoped(`conversationId=${w.open.id}&q=${w.word}`)).status).toBe(200);
    // reading first: a missing id and a topic the guest cannot open are the same «not found», so the answer does not tell which ids are topics
    expect((await scoped(`conversationId=nothing&q=${w.word}`)).status).toBe(404);
    expect((await scoped(`conversationId=${w.restricted.id}&q=${w.word}`)).status).toBe(404);
    expect((await scoped(`conversationId=${w.teamY.id}&q=${w.word}`)).status).toBe(404);
  });

  it("a bad date or person is a refusal, not a crash", async () => {
    const w = await getWorld();
    await loginAs(w.carol.id);
    expect((await scoped(`conversationId=${w.open.id}&since=yesterday`)).status).toBe(422);
  });
});
