import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { chatKeys } from "@/lib/chat/cache/keys";
import { reachesNewest } from "@/lib/chat/cache/pages";
import { LATEST, type MessagesData } from "@/lib/chat/cache/types";
import { landingRule, separatorBefore } from "@/lib/chat/history/landing";
import { resolveOpening } from "@/lib/chat/history/open";
import { chatRuntimeOf } from "@/lib/chat/cache/runtime";
import { clientWithRuntime, makeConversation, serve, stubServer } from "./chat-history-model.test";

/**
 * C1.6 — the landing rule when a conversation is opened. The server already sends `firstUnreadId` with every window, so opening is
 * «fetch the newest window»; if the oldest unread message is not inside it, one more request: `around=firstUnreadId`. A person with
 * no read mark has no `firstUnreadId`: the newest window, the bottom. (Showing «رسائل غير مقروءة» is C2.4's; the data and the rule are here.)
 */

afterEach(() => vi.unstubAllGlobals());

const all = makeConversation(400, 1);
const data = (qc: QueryClient) => qc.getQueryData<MessagesData>(chatKeys.messages("c1"));
const ids = (d: MessagesData | undefined) => d?.pages.flatMap((p) => p.messages.map((m) => m.id)) ?? [];

describe("the rule, on one window", () => {
  it("no read mark (or nothing unread) → newest; unread inside the window → land on it; outside → the window around it is needed", () => {
    const newest = serve(all, LATEST);
    expect(landingRule(newest)).toEqual({ kind: "newest" });
    expect(landingRule({ ...newest, firstUnreadId: all[360]!.id })).toEqual({ kind: "unread-inside", id: all[360]!.id });
    expect(landingRule({ ...newest, firstUnreadId: all[10]!.id })).toEqual({ kind: "unread-outside", id: all[10]!.id });
  });

  it("the separator goes right above the first unread message, and only when that is where the person landed", () => {
    expect(separatorBefore({ kind: "unread", messageId: "m1" })).toBe("m1");
    expect(separatorBefore({ kind: "newest", messageId: null })).toBeNull();
    expect(separatorBefore({ kind: "message", messageId: "m1" })).toBeNull();
    expect(separatorBefore(null)).toBeNull();
  });
});

describe("a run that was overtaken (the person went elsewhere, or asked for something else)", () => {
  it("writes nothing: a late window must not replace the one a newer run chose", async () => {
    stubServer(() => all, { firstUnreadId: () => all[100]!.id });
    const qc = clientWithRuntime();
    let current = true;
    // the person leaves while the requests are in the air
    const pending = resolveOpening(qc, "c1", { unreadHint: 300, current: () => current });
    current = false;
    expect(await pending).toBeNull();
    expect(data(qc)).toBeUndefined();
  });

  it("an opening that is still current writes as before", async () => {
    stubServer(() => all);
    const qc = clientWithRuntime();
    expect(await resolveOpening(qc, "c1", { unreadHint: 0, messageId: all[200]!.id, current: () => true })).toEqual({ kind: "message", messageId: all[200]!.id });
    expect(data(qc)).toBeDefined();
  });
});

describe("the feed replays what happened while a window was on its way", () => {
  it("only AFTER the window is in the cache (the replayed events must land on the window that is shown, not on the one it replaces)", async () => {
    stubServer(() => all);
    const qc = clientWithRuntime();
    await chatRuntimeOf(qc).ensure(); // the feed has said where «now» is
    const seen: Array<MessagesData | undefined> = [];
    vi.spyOn(chatRuntimeOf(qc).engine, "rewindTo").mockImplementation(() => void seen.push(data(qc)));
    await resolveOpening(qc, "c1", { unreadHint: 3 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeDefined(); // the window was already written when the engine was told to go back
    expect(seen[0]!.pages[0]!.messages.at(-1)!.id).toBe(all.at(-1)!.id);
  });

  it("a window that was fetched and never shown (the unread-outside first answer) asks for no replay", async () => {
    stubServer(() => all, { firstUnreadId: () => all[100]!.id });
    const qc = clientWithRuntime();
    await chatRuntimeOf(qc).ensure();
    const spy = vi.spyOn(chatRuntimeOf(qc).engine, "rewindTo").mockImplementation(() => undefined);
    await resolveOpening(qc, "c1", { unreadHint: 300 });
    expect(spy).toHaveBeenCalledTimes(1); // the around window only
  });
});

describe("opening a conversation", () => {
  it("unread INSIDE the newest window: one request, the newest window is what is kept, the landing is that message", async () => {
    const asked = stubServer(() => all, { firstUnreadId: () => all[380]!.id });
    const qc = clientWithRuntime();
    const landing = await resolveOpening(qc, "c1", { unreadHint: 20 });
    expect(landing).toEqual({ kind: "unread", messageId: all[380]!.id });
    expect(asked).toEqual(["/api/chat/conversations/c1/messages?limit=50"]);
    expect(ids(data(qc))).toEqual(all.slice(350).map((m) => m.id));
    expect(reachesNewest(data(qc)!)).toBe(true);
    expect(data(qc)!.pageParams).toEqual([LATEST]);
  });

  it("unread OUTSIDE the newest window: the newest window, then `around=firstUnreadId` — and the around window is what is kept", async () => {
    const asked = stubServer(() => all, { firstUnreadId: () => all[100]!.id });
    const qc = clientWithRuntime();
    const landing = await resolveOpening(qc, "c1", { unreadHint: 300 });
    expect(landing).toEqual({ kind: "unread", messageId: all[100]!.id });
    expect(asked).toEqual(["/api/chat/conversations/c1/messages?limit=50", `/api/chat/conversations/c1/messages?limit=50&around=${all[100]!.id}`]);
    const d = data(qc)!;
    expect(d.pages).toHaveLength(1);
    expect(ids(d)).toContain(all[100]!.id);
    expect(reachesNewest(d)).toBe(false); // the window ends before the newest message: the screen shows «آخر الرسائل» and pages down
    expect(d.pageParams).toEqual([{ kind: "around", id: all[100]!.id }]);
    // older AND newer messages around it: the unread landing is not at an edge of the window
    expect(ids(d).indexOf(all[100]!.id)).toBeGreaterThan(5);
    expect(ids(d).indexOf(all[100]!.id)).toBeLessThan(ids(d).length - 5);
  });

  it("no read mark: the newest window and the bottom, one request", async () => {
    const asked = stubServer(() => all, { firstUnreadId: () => null });
    const qc = clientWithRuntime();
    expect(await resolveOpening(qc, "c1", { unreadHint: null })).toEqual({ kind: "newest", messageId: null });
    expect(asked).toHaveLength(1);
    expect(ids(data(qc))).toEqual(all.slice(350).map((m) => m.id));
  });

  it("a conversation already in the cache with nothing unread opens at once: no request at all", async () => {
    const asked = stubServer(() => all);
    const qc = clientWithRuntime();
    qc.setQueryData<MessagesData>(chatKeys.messages("c1"), { pages: [serve(all, LATEST)], pageParams: [LATEST] });
    expect(await resolveOpening(qc, "c1", { unreadHint: 0 })).toEqual({ kind: "newest", messageId: null });
    expect(asked).toEqual([]);
  });

  it("…but a cached window that does NOT reach the newest message (left around an old message) is replaced by the newest one", async () => {
    const asked = stubServer(() => all);
    const qc = clientWithRuntime();
    const around = serve(all, { kind: "around", id: all[50]!.id });
    qc.setQueryData<MessagesData>(chatKeys.messages("c1"), { pages: [around], pageParams: [{ kind: "around", id: all[50]!.id }] });
    expect(await resolveOpening(qc, "c1", { unreadHint: 0 })).toEqual({ kind: "newest", messageId: null });
    expect(asked).toHaveLength(1);
    expect(reachesNewest(data(qc)!)).toBe(true);
  });

  it("a cached conversation with unread messages still asks the server (the cache cannot know which message is the first unread)", async () => {
    const asked = stubServer(() => all, { firstUnreadId: () => all[395]!.id });
    const qc = clientWithRuntime();
    qc.setQueryData<MessagesData>(chatKeys.messages("c1"), { pages: [serve(all, LATEST)], pageParams: [LATEST] });
    expect(await resolveOpening(qc, "c1", { unreadHint: 5 })).toEqual({ kind: "unread", messageId: all[395]!.id });
    expect(asked).toHaveLength(1);
  });

  it("the first unread message vanished between the two requests (404): fall back to the newest window, never an error screen", async () => {
    let gone = false;
    const asked = stubServer(() => (gone ? all.filter((m) => m.id !== all[100]!.id) : all), { firstUnreadId: () => all[100]!.id });
    const qc = clientWithRuntime();
    // the server purges it right after answering the first window
    const real = globalThis.fetch;
    let calls = 0;
    vi.stubGlobal("fetch", async (input: string) => {
      const res = await real(input);
      if (String(input).includes("messages") && ++calls === 1) gone = true;
      return res;
    });
    expect(await resolveOpening(qc, "c1", { unreadHint: 300 })).toEqual({ kind: "newest", messageId: null });
    expect(asked.length).toBe(2);
    expect(ids(data(qc))).toEqual(all.slice(350).map((m) => m.id));
  });

  it("a link to a message (?m=): around it, the landing is that message; one already in the cache costs no request", async () => {
    const asked = stubServer(() => all);
    const qc = clientWithRuntime();
    expect(await resolveOpening(qc, "c1", { unreadHint: 0, messageId: all[200]!.id })).toEqual({ kind: "message", messageId: all[200]!.id });
    expect(asked).toEqual([`/api/chat/conversations/c1/messages?limit=50&around=${all[200]!.id}`]);
    expect(await resolveOpening(qc, "c1", { unreadHint: 0, messageId: all[201]!.id })).toEqual({ kind: "message", messageId: all[201]!.id });
    expect(asked).toHaveLength(1);
  });

  it("a link to a message that is not in the conversation: the normal opening (newest), not an error", async () => {
    const asked = stubServer(() => all);
    const qc = clientWithRuntime();
    expect(await resolveOpening(qc, "c1", { unreadHint: 0, messageId: "gone" })).toEqual({ kind: "newest", messageId: null });
    expect(asked).toHaveLength(2);
    expect(reachesNewest(data(qc)!)).toBe(true);
  });

  it("a network failure is an error for the screen to show (the window is not touched)", async () => {
    vi.stubGlobal("fetch", async (input: string) => (String(input).startsWith("/api/chat/sync") ? new Response(JSON.stringify({ cursor: "1", messages: [], reads: [], delivered: [], rows: [], removed: [] }), { status: 200 }) : new Response("{}", { status: 500 })));
    const qc = clientWithRuntime();
    await expect(resolveOpening(qc, "c1", { unreadHint: 3 })).rejects.toBeTruthy();
    expect(data(qc)).toBeUndefined();
  });
});
