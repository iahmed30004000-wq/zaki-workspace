/**
 * C3b.2 — link previews, against a real database. The network is a STUB (`setLinkPreviewDepsForTests`): no suite here ever reaches a real site.
 *
 *  - the card is made AFTER the send committed, from the first link, through the guard; the picture is kept by `ingest` and served only through the preview route
 *  - `message.enriched` is one event with ids only, and sync returns the presented message with its card
 *  - a private address (literal, resolved, or reached by a redirect) is refused and logged, the send is untouched; the size caps; the same page is read once
 *  - the sender removes the card (the author only); a deleted message has no card; per-viewer presentation (a guest as for the text)
 *  - switch off: no fetch, no card, the data stays
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as imageRoute from "@/app/api/chat/messages/[id]/preview/image/route";
import * as previewRoute from "@/app/api/chat/messages/[id]/preview/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { openDm } from "@/server/chat/dm";
import type { MessageDto, MessagesPageDto, SyncDto } from "@/server/chat/dto";
import { deleteMessage, editMessage, sendLimiter, sendMessage } from "@/server/chat/messages";
import { setLinkPreviewDepsForTests, urlHashOf, IMAGE_MAX_BYTES, PAGE_MAX_BYTES } from "@/server/chat/link-preview";
import { syncFeed } from "@/server/chat/sync";
import { assertMayReadFile } from "@/server/services/files";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

type Role = "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST";
type Person = { id: string };

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(120).fill(7)]);
const PAGE_URL = "https://news.example.com/a";
const IMAGE_URL = "https://cdn.example.com/p.png";
const HEAD = `<html><head><meta property="og:title" content="خبر عاجل"><meta property="og:description" content="تفاصيل الخبر"><meta property="og:site_name" content="الأخبار"><meta property="og:image" content="${IMAGE_URL}"></head><body>x</body></html>`;
const htmlResponse = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const pngResponse = (bytes: BodyInit = PNG) => new Response(bytes, { status: 200, headers: { "content-type": "image/png" } });

interface Visit {
  url: string;
  init: RequestInit;
}

/** The stub network. `routes` answer an address; every other address is a 404. A name `private.example.com` resolves to a private address. */
function network(routes: Record<string, () => Response | Promise<Response>> = {}) {
  const visits: Visit[] = [];
  const all: Record<string, () => Response | Promise<Response>> = {
    [PAGE_URL]: () => htmlResponse(HEAD),
    [IMAGE_URL]: () => pngResponse(),
    "https://evil.example.com/": () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } }),
    "https://down.example.com/": () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }),
    ...routes,
  };
  setLinkPreviewDepsForTests({
    timeoutMs: 3_000,
    resolve: async (host) => (host === "private.example.com" ? ["10.0.0.8"] : ["93.184.216.34"]),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      visits.push({ url, init: init ?? {} });
      return (all[url] ?? (() => new Response("nope", { status: 404, headers: { "content-type": "text/html" } })))();
    }) as typeof fetch,
  });
  return visits;
}

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const a = t.member;
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const sa = await makeUser({ orgId, role: "MEMBER", name: "SpaceAdmin" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(orgId, [{ userId: sa.id, role: "ADMIN" }, { userId: a.id }, { userId: b.id }, { userId: t.guest.id }], "Alpha");
  const open = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open" } });
  const restricted = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Restricted", restricted: true, members: { create: [{ userId: a.id }] } } });
  const dm = (await openDm({ orgId, userId: a.id, orgRole: "MEMBER" }, b.id, space.id)).id;
  const other = await makeTeam();
  const otherSpace = await makeWorkspace(other.org.id, [{ userId: other.member.id }]);
  const foreign = await db.conversation.create({ data: { orgId: other.org.id, kind: "TOPIC", spaceId: otherSpace.id, title: "Foreign" } });
  return { t, a, b, sa, outsider, space, open, restricted, dm, other, foreign };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

const ctxOf = (w: World, who: Person, orgRole: Role = "MEMBER") => ({ orgId: w.t.org.id, userId: who.id, orgRole });
const say = async (w: World, who: Person, conversationId: string, body: string, extra: Record<string, unknown> = {}, role: Role = "MEMBER"): Promise<MessageDto> => {
  sendLimiter.reset(`chat.send.${who.id}`);
  return sendMessage(ctxOf(w, who, role), conversationId, { body, ...extra });
};
const cursor = async (w: World) => (await syncFeed(ctxOf(w, w.a))).cursor;
const since = (w: World, who: Person, after: string, role: Role = "MEMBER") => syncFeed(ctxOf(w, who, role), { after: BigInt(after) });
const rowOf = (id: string) => db.chatMessage.findUniqueOrThrow({ where: { id }, include: { preview: true } });
const enrichedAfter = async (w: World, after: string) => db.realtimeEvent.findMany({ where: { orgId: w.t.org.id, kind: "message.enriched", id: { gt: BigInt(after) } }, orderBy: { id: "asc" } });
const setSwitch = async (orgId: string, on: boolean) => {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "linkPreviews", on) as Prisma.InputJsonValue } });
};
const window = async (w: World, who: Person, conversationId: string): Promise<MessageDto[]> => {
  await loginAs(who.id);
  return ((await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${conversationId}/messages`, params: { id: conversationId } })).json as unknown as MessagesPageDto).messages;
};

let visits: Visit[] = [];
let warnings: string[] = [];
beforeEach(() => {
  visits = network();
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warnings.push(String(line));
  });
});
afterEach(() => {
  setLinkPreviewDepsForTests(undefined);
  vi.restoreAllMocks();
});

describe("the card is made after the send commits", () => {
  it("reads the FIRST link through the guard, keeps the words, the picture and ONE `message.enriched` event of ids only", async () => {
    const w = await getWorld();
    const before = await cursor(w);
    const sent = await say(w, w.a, w.open.id, `شوف هاد ${PAGE_URL} مهم، وهاد كمان https://other.example.com/b`);
    // the answer of the send does not wait for the page: it carries no card (the card arrives by the sync feed)
    expect(sent.preview).toBeUndefined();

    const row = await rowOf(sent.id);
    expect(row.previewId).not.toBeNull();
    expect(row.preview).toMatchObject({ url: PAGE_URL, title: "خبر عاجل", description: "تفاصيل الخبر", siteName: "الأخبار", status: "OK", orgId: w.t.org.id, urlHash: urlHashOf(w.t.org.id, PAGE_URL) });
    // only the first link was visited (the page, then its picture)
    expect(visits.map((v) => v.url)).toEqual([PAGE_URL, IMAGE_URL]);
    // no cookie, no authorization, never a redirect followed by itself
    for (const v of visits) {
      expect(Object.keys((v.init.headers ?? {}) as Record<string, string>).map((n) => n.toLowerCase())).not.toContain("cookie");
      expect(Object.keys((v.init.headers ?? {}) as Record<string, string>).map((n) => n.toLowerCase())).not.toContain("authorization");
      expect(v.init.redirect).toBe("manual");
    }
    // the picture is a stored file of the company, tagged for its card (the 24-hour purge of unclaimed CHAT uploads never sees it)
    const file = await db.storedFile.findUniqueOrThrow({ where: { id: row.preview!.imageFileId! } });
    expect(file).toMatchObject({ orgId: w.t.org.id, mimeType: "image/png", purpose: "LINKPREVIEW", uploaderId: w.a.id });
    expect(await db.messageAttachment.count({ where: { messageId: sent.id } })).toBe(0);

    const events = await enrichedAfter(w, before);
    expect(events).toHaveLength(1);
    expect(events[0]!.ids).toEqual({ conversationId: w.open.id, messageId: sent.id, spaceId: w.space.id });
    expect(JSON.stringify(events[0]!.ids)).not.toContain("خبر");
  });

  it("sync returns the presented message with its card, for every reader of the topic and for nobody else", async () => {
    const w = await getWorld();
    const before = await cursor(w);
    const sent = await say(w, w.a, w.open.id, `خبر ${PAGE_URL}`);
    const want = { url: PAGE_URL, title: "خبر عاجل", description: "تفاصيل الخبر", siteName: "الأخبار", image: `/api/chat/messages/${sent.id}/preview/image` };
    for (const [who, role] of [[w.a, "MEMBER"], [w.b, "MEMBER"], [w.sa, "MEMBER"], [w.t.guest, "GUEST"]] as const) {
      const got = (await since(w, who, before, role)).messages.find((m) => m.id === sent.id);
      expect(got?.preview, `${who.id} ${role}`).toEqual(want);
      expect(got?.body).toContain(PAGE_URL);
    }
    // somebody outside the space reads nothing of it
    const outside = await since(w, w.outsider, before);
    expect(JSON.stringify(outside)).not.toContain("خبر عاجل");
    expect(outside.messages.find((m) => m.id === sent.id)).toBeUndefined();
    // the messages window carries the card as well (the same presenter)
    expect((await window(w, w.b, w.open.id)).find((m) => m.id === sent.id)?.preview).toEqual(want);
  });

  it("never fetches for a message that is already stored: a read, a sync of another event, a reaction make no visit and no card", async () => {
    const w = await getWorld();
    const old = await db.chatMessage.create({ data: { orgId: w.t.org.id, conversationId: w.open.id, authorId: w.a.id, body: `قديمة ${PAGE_URL}` } });
    const before = await cursor(w);
    const seen = await window(w, w.b, w.open.id);
    expect(seen.find((m) => m.id === old.id)?.preview).toBeUndefined();
    const { toggleReact } = await import("@/server/chat/messages");
    await toggleReact(ctxOf(w, w.b), old.id, { emoji: "👍" });
    const delta = await since(w, w.a, before);
    expect(delta.messages.find((m) => m.id === old.id)?.preview).toBeUndefined();
    expect(visits).toHaveLength(0);
    expect((await rowOf(old.id)).previewId).toBeNull();
  });

  it("a message with no link, an http or mailto link, a link to the app itself, or the sender's `noPreview` makes no visit", async () => {
    const w = await getWorld();
    const before = process.env["APP_URL"];
    process.env["APP_URL"] = "https://workspace.example.org";
    try {
      for (const [body, extra] of [
        ["مرحبا بدون رابط", {}],
        ["http://news.example.com/a", {}],
        ["mail me@example.com mailto:me@example.com ثم " + PAGE_URL, {}],
        ["https://workspace.example.org/chat/abc", {}],
        [PAGE_URL, { noPreview: true }],
      ] as const) {
        const sent = await say(w, w.a, w.open.id, body, extra);
        expect((await rowOf(sent.id)).previewId, body).toBeNull();
      }
      expect(visits).toHaveLength(0);
    } finally {
      if (before === undefined) delete process.env["APP_URL"];
      else process.env["APP_URL"] = before;
    }
  });
});

describe("only public https pages, only what the guard allows", () => {
  it("a private address, a name that resolves to one, and a redirect to the cloud's metadata address are refused: no card, the send is untouched, the failure is logged by reason", async () => {
    const w = await getWorld();
    for (const body of ["https://10.0.0.5/admin", "https://private.example.com/x", "https://evil.example.com/"]) {
      const sent = await say(w, w.a, w.open.id, `شوف ${body}`);
      expect(sent.id, body).toBeTruthy();
      const row = await rowOf(sent.id);
      expect(row.previewId, body).toBeNull();
      expect(row.body).toContain(body);
    }
    // nothing private was ever asked for: only the public first hop of the redirecting page
    expect(visits.map((v) => v.url)).toEqual(["https://evil.example.com/"]);
    const logged = warnings.map((l) => JSON.parse(l) as { event: string; reason?: string });
    expect(logged.filter((l) => l.event === "chat.link_preview_failed" && l.reason === "unsafe")).toHaveLength(3);
    // the address itself is never in the log
    expect(warnings.join("\n")).not.toContain("10.0.0.5");
    expect(warnings.join("\n")).not.toContain("evil.example.com");
  });

  it("a down site, a page that is not HTML and a network error leave the message as it was, and are logged", async () => {
    const w = await getWorld();
    visits = network({
      "https://json.example.com/": () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      "https://boom.example.com/": () => {
        throw new Error("ECONNRESET");
      },
    });
    for (const url of ["https://down.example.com/", "https://json.example.com/", "https://boom.example.com/"]) {
      const sent = await say(w, w.a, w.open.id, url);
      expect((await rowOf(sent.id)).previewId, url).toBeNull();
    }
    const reasons = warnings.map((l) => (JSON.parse(l) as { reason?: string }).reason);
    expect(reasons).toEqual(expect.arrayContaining(["status", "not_html", "network"]));
  });

  it("the size caps: a page over 512 KB is read up to the cap (its head still makes the card), a picture over 1 MB is left out", async () => {
    const w = await getWorld();
    visits = network({ "https://big.example.com/": () => htmlResponse(HEAD + "x".repeat(PAGE_MAX_BYTES * 2)) });
    const bigPage = await say(w, w.a, w.open.id, "https://big.example.com/");
    expect((await rowOf(bigPage.id)).preview).toMatchObject({ title: "خبر عاجل", status: "OK" });

    const huge = new Uint8Array(IMAGE_MAX_BYTES + 100);
    huge.set(PNG, 0);
    visits = network({ "https://heavy.example.com/": () => htmlResponse(HEAD), [IMAGE_URL]: () => pngResponse(huge) });
    const heavy = await say(w, w.a, w.open.id, "https://heavy.example.com/");
    const row = await rowOf(heavy.id);
    expect(row.preview).toMatchObject({ title: "خبر عاجل", status: "OK", imageFileId: null });
    const dto = (await since(w, w.b, await cursorBefore(w, heavy.id))).messages.find((m) => m.id === heavy.id);
    expect(dto?.preview?.image).toBeNull();
  });

  it("the same page in one company is read once; a failed one is not asked again for ten minutes; another company has its own row", async () => {
    const w = await getWorld();
    const url = "https://shared.example.com/p";
    visits = network({ [url]: () => htmlResponse(HEAD) });
    const first = await say(w, w.a, w.open.id, url);
    const second = await say(w, w.b, w.open.id, `تاني ${url}`);
    expect(visits.map((v) => v.url)).toEqual([url, IMAGE_URL]);
    expect((await rowOf(first.id)).previewId).toBe((await rowOf(second.id)).previewId);
    expect(await db.linkPreview.count({ where: { urlHash: urlHashOf(w.t.org.id, url) } })).toBe(1);

    // another company: its own row, its own picture
    const foreignSent = await say({ ...w, t: w.other } as unknown as World, w.other.member, w.foreign.id, url);
    expect((await rowOf(foreignSent.id)).preview?.orgId).toBe(w.other.org.id);
    expect((await rowOf(foreignSent.id)).previewId).not.toBe((await rowOf(first.id)).previewId);
    expect(visits.filter((v) => v.url === url)).toHaveLength(2);

    // a failed page: asked once, then left alone
    const down = "https://down.example.com/second";
    visits = network({ [down]: () => new Response("down", { status: 503, headers: { "content-type": "text/html" } }) });
    await say(w, w.a, w.open.id, down);
    await say(w, w.b, w.open.id, down);
    expect(visits.filter((v) => v.url === down)).toHaveLength(1);
    expect((await db.linkPreview.findUniqueOrThrow({ where: { urlHash: urlHashOf(w.t.org.id, down) } })).status).toBe("FAILED");
  });
});

/** The sync cursor just before a message: one event earlier than its own `message.created`. */
async function cursorBefore(w: World, messageId: string): Promise<string> {
  const created = await db.realtimeEvent.findFirstOrThrow({ where: { orgId: w.t.org.id, kind: "message.created", ids: { path: ["messageId"], equals: messageId } } });
  return String(created.id - 1n);
}

describe("the picture is served only through the preview route, after the reading rule", () => {
  it("a reader gets the bytes with safe headers; a stranger, another company and a person outside a restricted topic get 404", async () => {
    const w = await getWorld();
    const open = await say(w, w.a, w.open.id, PAGE_URL);
    const hidden = await say(w, w.a, w.restricted.id, PAGE_URL);
    const get = async (who: Person, id: string) => {
      await loginAs(who.id);
      return call(imageRoute.GET, { params: { id }, url: `http://localhost/api/chat/messages/${id}/preview/image` });
    };
    for (const who of [w.a, w.b, w.sa, w.t.guest, w.t.owner]) {
      const res = await get(who, open.id);
      expect(res.status, who.id).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("content-length")).toBe(String(PNG.length));
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-disposition")).toBe("inline");
      expect(res.headers.get("cache-control")).toContain("private");
    }
    expect((await get(w.outsider, open.id)).status).toBe(404);
    expect((await get(w.other.member, open.id)).status).toBe(404);
    // a restricted topic: its own people, and the owner's silent eye
    expect((await get(w.a, hidden.id)).status).toBe(200);
    expect((await get(w.b, hidden.id)).status).toBe(404);
    expect((await get(w.t.guest, hidden.id)).status).toBe(404);
    // a message with no picture or no card, and an id that is not a message
    const plain = await say(w, w.a, w.open.id, "بدون رابط");
    expect((await get(w.a, plain.id)).status).toBe(404);
    expect((await get(w.a, "nope")).status).toBe(404);
  });

  it("the file is nobody's through the library or the chat file door except its own uploader: it is not a library file and no message claims it", async () => {
    const w = await getWorld();
    const sent = await say(w, w.a, w.open.id, PAGE_URL);
    const fileId = (await rowOf(sent.id)).preview!.imageFileId!;
    await expect(assertMayReadFile({ orgId: w.t.org.id, userId: w.b.id, orgRole: "MEMBER" }, fileId)).rejects.toThrow();
    await expect(assertMayReadFile({ orgId: w.t.org.id, userId: w.t.guest.id, orgRole: "GUEST" }, fileId)).rejects.toThrow();
  });

  it("a deleted message gives no picture to anybody, the owner included", async () => {
    const w = await getWorld();
    const sent = await say(w, w.a, w.open.id, PAGE_URL);
    await deleteMessage(ctxOf(w, w.a), sent.id);
    for (const who of [w.a, w.b, w.t.owner]) {
      await loginAs(who.id);
      expect((await call(imageRoute.GET, { params: { id: sent.id } })).status, who.id).toBe(404);
    }
  });
});

describe("the sender removes the card (the author only)", () => {
  const remove = async (who: Person, id: string) => {
    await loginAs(who.id);
    return call(previewRoute.DELETE, { method: "DELETE", params: { id } });
  };

  it("the author takes it off: the words stay, the message is not marked edited, one more event, the others' sync shows no card, the page row stays for other messages", async () => {
    const w = await getWorld();
    const sent = await say(w, w.a, w.open.id, `خبر ${PAGE_URL}`);
    const before = await cursor(w);
    const res = await remove(w.a, sent.id);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ removed: true });
    const row = await rowOf(sent.id);
    expect(row).toMatchObject({ previewId: null, body: `خبر ${PAGE_URL}`, editedAt: null });
    expect(await db.linkPreview.count({ where: { urlHash: urlHashOf(w.t.org.id, PAGE_URL) } })).toBe(1);
    const events = await enrichedAfter(w, before);
    expect(events).toHaveLength(1);
    expect(events[0]!.ids).toEqual({ conversationId: w.open.id, messageId: sent.id, spaceId: w.space.id });
    const seen = (await since(w, w.b, before)).messages.find((m) => m.id === sent.id);
    expect(seen).toBeDefined();
    expect(seen?.preview).toBeUndefined();
    expect(seen?.edited).toBe(false);
    // asking again changes nothing
    expect((await remove(w.a, sent.id)).json).toEqual({ removed: false });
    expect(await enrichedAfter(w, before)).toHaveLength(1);
    // the picture route is closed with the card
    await loginAs(w.b.id);
    expect((await call(imageRoute.GET, { params: { id: sent.id } })).status).toBe(404);
  });

  it("nobody else may: not a reader, not the space's admin, not the owner (403); a stranger gets 404 and the card stays", async () => {
    const w = await getWorld();
    const sent = await say(w, w.a, w.open.id, PAGE_URL);
    for (const who of [w.b, w.sa, w.t.owner, w.t.guest]) expect((await remove(who, sent.id)).status, who.id).toBe(403);
    for (const who of [w.outsider, w.other.member]) expect((await remove(who, sent.id)).status, who.id).toBe(404);
    expect((await rowOf(sent.id)).previewId).not.toBeNull();
    expect((await remove(w.a, "nope")).status).toBe(404);
  });

  it("a deleted message cannot be touched: 403", async () => {
    const w = await getWorld();
    const sent = await say(w, w.a, w.open.id, PAGE_URL);
    await deleteMessage(ctxOf(w, w.a), sent.id);
    expect((await remove(w.a, sent.id)).status).toBe(403);
  });
});

describe("per viewer: a deleted message has no card, and an edit follows the words", () => {
  it("a deleted message carries no card in sync or in the window, for the owner's original neither", async () => {
    const w = await getWorld();
    const sent = await say(w, w.a, w.open.id, PAGE_URL);
    const before = String(BigInt(await cursor(w)) - 1n);
    await deleteMessage(ctxOf(w, w.a), sent.id);
    const got = (await since(w, w.b, before)).messages.find((m) => m.id === sent.id);
    expect(got?.deleted).toBe(true);
    expect(got?.preview).toBeUndefined();
    expect(JSON.stringify(got)).not.toContain("خبر عاجل");
    for (const who of [w.b, w.t.owner]) {
      const dto = (await window(w, who, w.open.id)).find((m) => m.id === sent.id);
      expect(dto?.deleted, who.id).toBe(true);
      expect(dto?.preview, who.id).toBeUndefined();
    }
  });

  it("an edit that keeps the first link keeps the card; one that changes or removes it takes the card off and visits nothing new", async () => {
    const w = await getWorld();
    const keep = await say(w, w.a, w.open.id, PAGE_URL);
    const kept = await editMessage(ctxOf(w, w.a), keep.id, { body: `${PAGE_URL} وكلمتين زيادة` });
    expect(kept.preview?.title).toBe("خبر عاجل");
    const changed = await editMessage(ctxOf(w, w.a), keep.id, { body: "https://another.example.com/z" });
    expect(changed.preview).toBeUndefined();
    expect((await rowOf(keep.id)).previewId).toBeNull();
    const gone = await say(w, w.a, w.open.id, PAGE_URL);
    const noLink = await editMessage(ctxOf(w, w.a), gone.id, { body: "شلت الرابط" });
    expect(noLink.preview).toBeUndefined();
    expect(visits.filter((v) => v.url.includes("another.example.com"))).toHaveLength(0);
  });
});

describe("the switch `linkPreviews`", () => {
  it("off: no page is visited, no card is presented or answered, the routes answer 404, and what was made stays and comes back on", async () => {
    const w = await getWorld();
    const made = await say(w, w.a, w.open.id, PAGE_URL);
    expect((await rowOf(made.id)).previewId).not.toBeNull();
    const before = await cursor(w);
    visits.length = 0;
    await setSwitch(w.t.org.id, false);
    try {
      const sent = await say(w, w.a, w.open.id, "https://fresh.example.com/x");
      expect(visits).toHaveLength(0);
      expect((await rowOf(sent.id)).previewId).toBeNull();
      // sync: the message is there, the card is not (the row is untouched)
      await db.chatMessage.update({ where: { id: made.id }, data: { editedAt: null } });
      const { toggleReact } = await import("@/server/chat/messages");
      await toggleReact(ctxOf(w, w.b), made.id, { emoji: "🔥" });
      const delta = (await since(w, w.a, before)).messages.find((m) => m.id === made.id);
      expect(delta).toBeDefined();
      expect(delta?.preview).toBeUndefined();
      await loginAs(w.b.id);
      expect((await call(imageRoute.GET, { params: { id: made.id } })).status).toBe(404);
      await loginAs(w.a.id);
      expect((await call(previewRoute.DELETE, { method: "DELETE", params: { id: made.id } })).status).toBe(404);
      expect((await rowOf(made.id)).previewId).not.toBeNull();
    } finally {
      await setSwitch(w.t.org.id, true);
    }
    const back = (await since(w, w.a, before)).messages.find((m) => m.id === made.id);
    expect(back?.preview?.title).toBe("خبر عاجل");
  });
});
