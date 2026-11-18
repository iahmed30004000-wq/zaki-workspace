import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfiniteQueryObserver, type QueryClient } from "@tanstack/react-query";
import { chatKeys } from "@/lib/chat/cache/keys";
import { messagesQueryOptions } from "@/lib/chat/cache/queries";
import { isNotFound, reachesNewest } from "@/lib/chat/cache/pages";
import { ApiError } from "@/lib/api-client";
import { MAX_PAGES, trimMessages } from "@/lib/chat/cache/trim";
import { LATEST, type MessagesData } from "@/lib/chat/cache/types";
import { HIGHLIGHT_MS, JumpSignals, backToNewest, jumpToMessage } from "@/lib/chat/history/jump";
import { EDGE_SCREENS, nextLoad } from "@/lib/chat/history/edges";
import { clientWithRuntime, makeConversation, serve, stubServer } from "./chat-history-model.test";

/**
 * C1.6 — jumping to a message (reply quote, pinned bar, search hit, `?m=`): `around`, then paging both ways, «آخر الرسائل» back to
 * the newest window, and a highlight that lasts two seconds. The highlight and the scroll are SIGNALS (no DOM here: the bubbles are C2's).
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const all = makeConversation(900, 1);
const data = (qc: QueryClient) => qc.getQueryData<MessagesData>(chatKeys.messages("c1"));
const ids = (d: MessagesData | undefined) => d?.pages.flatMap((p) => p.messages.map((m) => m.id)) ?? [];
const seeded = (qc: QueryClient) => qc.setQueryData<MessagesData>(chatKeys.messages("c1"), { pages: [serve(all, LATEST)], pageParams: [LATEST] });

describe("jumping to a message", () => {
  it("a message the cache already holds costs no request: it is `here`", async () => {
    const asked = stubServer(() => all);
    const qc = clientWithRuntime();
    seeded(qc);
    expect(await jumpToMessage(qc, "c1", all[880]!.id)).toBe("here");
    expect(asked).toEqual([]);
  });

  it("a message far away: `around` it, the window is replaced by that one, and paging works from there in both directions", async () => {
    const asked = stubServer(() => all);
    const qc = clientWithRuntime();
    seeded(qc);
    expect(await jumpToMessage(qc, "c1", all[300]!.id)).toBe("loaded");
    expect(asked).toEqual([`/api/chat/conversations/c1/messages?limit=50&around=${all[300]!.id}`]);
    let d = data(qc)!;
    expect(d.pages).toHaveLength(1);
    expect(ids(d)).toContain(all[300]!.id);
    expect(reachesNewest(d)).toBe(false);
    // bidirectional paging from the jump, through the real query (the cursors are the cache's own)
    const observer = new InfiniteQueryObserver(qc, { ...messagesQueryOptions("c1"), staleTime: Infinity });
    await observer.fetchPreviousPage();
    await observer.fetchNextPage();
    d = data(qc)!;
    expect(d.pages).toHaveLength(3);
    const flat = ids(d);
    expect(new Set(flat).size).toBe(flat.length);
    const at = (id: string) => all.findIndex((m) => m.id === id);
    for (let i = 1; i < flat.length; i++) expect(at(flat[i]!)).toBe(at(flat[i - 1]!) + 1);
    observer.destroy();
  });

  it("a jump that was overtaken by a newer one writes nothing and says `stale`", async () => {
    const asked = stubServer(() => all);
    const qc = clientWithRuntime();
    seeded(qc);
    const before = data(qc);
    expect(await jumpToMessage(qc, "c1", all[300]!.id, () => false)).toBe("stale");
    expect(data(qc)).toBe(before);
    expect(asked.length).toBeLessThanOrEqual(1);
    await backToNewest(qc, "c1", () => false);
    expect(data(qc)).toBe(before);
  });

  it("a message that is gone (404): `missing`, and the window the person is reading is left exactly as it was", async () => {
    const asked = stubServer(() => all);
    const qc = clientWithRuntime();
    seeded(qc);
    const before = data(qc);
    expect(await jumpToMessage(qc, "c1", "does-not-exist")).toBe("missing");
    expect(asked).toHaveLength(1);
    expect(data(qc)).toBe(before);
  });

  it("«آخر الرسائل»: the newest window comes back and replaces the one around the jump", async () => {
    const asked = stubServer(() => all);
    const qc = clientWithRuntime();
    seeded(qc);
    await jumpToMessage(qc, "c1", all[300]!.id);
    asked.length = 0;
    await backToNewest(qc, "c1");
    expect(asked).toEqual(["/api/chat/conversations/c1/messages?limit=50"]);
    const d = data(qc)!;
    expect(reachesNewest(d)).toBe(true);
    expect(d.pageParams).toEqual([LATEST]);
    expect(ids(d)).toEqual(all.slice(850).map((m) => m.id));
  });

  it("a jump while a page request is in the air is not undone by it", async () => {
    const asked = stubServer(() => all);
    const qc = clientWithRuntime();
    seeded(qc);
    const observer = new InfiniteQueryObserver(qc, { ...messagesQueryOptions("c1"), staleTime: Infinity });
    const slow = observer.fetchPreviousPage(); // not awaited
    await jumpToMessage(qc, "c1", all[100]!.id);
    await slow.catch(() => undefined);
    expect(ids(data(qc))).toContain(all[100]!.id);
    expect(asked.length).toBeGreaterThanOrEqual(2);
    observer.destroy();
  });
});

describe("the ten-window cap on the real cache", () => {
  it("walking up through 30 pages with the screen at the top never keeps more than ten, and it never cuts a request in the air", async () => {
    stubServer(() => all);
    const qc = clientWithRuntime();
    seeded(qc);
    const observer = new InfiniteQueryObserver(qc, { ...messagesQueryOptions("c1"), staleTime: Infinity });
    let top = ids(data(qc))[0]!;
    for (let i = 0; i < 17; i++) {
      await observer.fetchPreviousPage();
      expect(data(qc)!.pages.length).toBeLessThanOrEqual(MAX_PAGES + 1); // one more than the cap, until it is trimmed
      const out = trimMessages(qc, "c1", ids(data(qc))[0]!);
      if (data(qc)!.pages.length > MAX_PAGES) throw new Error("not trimmed");
      expect(out === null || out.droppedNewer >= 0).toBe(true);
      top = ids(data(qc))[0]!;
    }
    expect(top).toBe(all[0]!.id);
    expect(data(qc)!.pages).toHaveLength(MAX_PAGES);
    expect(reachesNewest(data(qc)!)).toBe(false);
    observer.destroy();
  });

  it("does nothing while a request is in the air (its answer would overwrite the cut), and says so", async () => {
    stubServer(() => all);
    const qc = clientWithRuntime();
    seeded(qc);
    const observer = new InfiniteQueryObserver(qc, { ...messagesQueryOptions("c1"), staleTime: Infinity });
    for (let i = 0; i < 11; i++) await observer.fetchPreviousPage();
    expect(data(qc)!.pages.length).toBe(12);
    const pending = observer.fetchPreviousPage();
    expect(trimMessages(qc, "c1", ids(data(qc))[0]!)).toBeNull();
    await pending;
    expect(trimMessages(qc, "c1", ids(data(qc))[0]!)).not.toBeNull();
    expect(data(qc)!.pages.length).toBe(MAX_PAGES);
    observer.destroy();
  });

  it("with no known message on screen (nothing reported yet, or an id from before a jump) it cuts NOTHING, however many windows there are", async () => {
    stubServer(() => all);
    const qc = clientWithRuntime();
    seeded(qc);
    const observer = new InfiniteQueryObserver(qc, { ...messagesQueryOptions("c1"), staleTime: Infinity });
    for (let i = 0; i < 11; i++) await observer.fetchPreviousPage();
    expect(trimMessages(qc, "c1", null)).toBeNull();
    expect(trimMessages(qc, "c1", "an-id-from-before-the-jump")).toBeNull();
    expect(data(qc)!.pages).toHaveLength(12);
    observer.destroy();
  });

  it("keeps the freshness of the data it cut (a cut is not a refetch, and not a reason to refetch)", async () => {
    stubServer(() => all);
    const qc = clientWithRuntime();
    seeded(qc);
    const observer = new InfiniteQueryObserver(qc, { ...messagesQueryOptions("c1"), staleTime: Infinity });
    for (let i = 0; i < 11; i++) await observer.fetchPreviousPage();
    const stamp = qc.getQueryState(chatKeys.messages("c1"))!.dataUpdatedAt;
    trimMessages(qc, "c1", ids(data(qc))[0]!);
    expect(qc.getQueryState(chatKeys.messages("c1"))!.dataUpdatedAt).toBe(stamp);
    observer.destroy();
  });
});

describe("a message that is not there", () => {
  it("is a 404 from the server and nothing else (one predicate for the opening and the jump)", () => {
    expect(isNotFound(new ApiError("chat.e.not_found", 404))).toBe(true);
    expect(isNotFound(new ApiError("x", 500))).toBe(false);
    expect(isNotFound(new ApiError("x", 403))).toBe(false);
    expect(isNotFound(new Error("404"))).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});

describe("the signals of a jump", () => {
  beforeEach(() => vi.useFakeTimers());

  it("a jump asks the screen to scroll to the message and highlights it for two seconds", () => {
    const s = new JumpSignals();
    const seen: Array<string | null> = [];
    s.subscribe(() => seen.push(s.getState().highlightId));
    s.scrollToMessage("m1", "center");
    expect(s.getState().scroll).toMatchObject({ target: { kind: "message", id: "m1", align: "center" } });
    expect(s.getState().highlightId).toBe("m1");
    vi.advanceTimersByTime(HIGHLIGHT_MS - 1);
    expect(s.getState().highlightId).toBe("m1");
    vi.advanceTimersByTime(2);
    expect(s.getState().highlightId).toBeNull();
    expect(seen).toEqual(["m1", null]);
    expect(HIGHLIGHT_MS).toBe(2000);
  });

  it("jumping again (the same message, or another) restarts the two seconds and gives the scroll a new token", () => {
    const s = new JumpSignals();
    s.scrollToMessage("m1", "center");
    const first = s.getState().scroll!.token;
    vi.advanceTimersByTime(1500);
    s.scrollToMessage("m1", "center");
    expect(s.getState().scroll!.token).toBeGreaterThan(first);
    vi.advanceTimersByTime(1500);
    expect(s.getState().highlightId).toBe("m1"); // 3 s after the first jump, 1.5 s after the second
    s.scrollToMessage("m2", "center");
    vi.advanceTimersByTime(HIGHLIGHT_MS + 1);
    expect(s.getState().highlightId).toBeNull();
  });

  it("the unread landing and the return to the newest scroll without any highlight", () => {
    const s = new JumpSignals();
    s.scrollToMessage("m9", "start", { highlight: false });
    expect(s.getState().highlightId).toBeNull();
    expect(s.getState().scroll).toMatchObject({ target: { kind: "message", id: "m9", align: "start" } });
    s.scrollToNewest();
    expect(s.getState().scroll).toMatchObject({ target: { kind: "newest" } });
    expect(s.getState().highlightId).toBeNull();
  });

  it("reset forgets everything and cancels the timer (a conversation that was closed)", () => {
    const s = new JumpSignals();
    s.scrollToMessage("m1", "center");
    s.reset();
    expect(s.getState()).toEqual({ scroll: null, highlightId: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the state object is the same one until something changes (a screen can subscribe to it cheaply)", () => {
    const s = new JumpSignals();
    const a = s.getState();
    expect(s.getState()).toBe(a);
    s.scrollToNewest();
    expect(s.getState()).not.toBe(a);
  });
});

describe("when the scroll asks for another page", () => {
  const view = { scrollTop: 5000, scrollHeight: 20000, clientHeight: 800 };
  const idle = { hasOlder: true, hasNewer: true, fetchingOlder: false, fetchingNewer: false };

  it("within one screen of the top → older; within one screen of the bottom (not at the newest) → newer; in the middle → nothing", () => {
    expect(EDGE_SCREENS).toBe(1);
    expect(nextLoad({ ...view, scrollTop: 800 }, idle)).toBe("older");
    expect(nextLoad({ ...view, scrollTop: 801 }, idle)).toBeNull();
    expect(nextLoad({ ...view, scrollTop: 20000 - 800 - 800 }, idle)).toBe("newer");
    expect(nextLoad({ ...view, scrollTop: 20000 - 800 - 801 }, idle)).toBeNull();
    expect(nextLoad(view, idle)).toBeNull();
  });

  it("not when there is nothing more that way, and not while that page is already coming", () => {
    expect(nextLoad({ ...view, scrollTop: 0 }, { ...idle, hasOlder: false })).toBeNull();
    expect(nextLoad({ ...view, scrollTop: 0 }, { ...idle, fetchingOlder: true })).toBeNull();
    expect(nextLoad({ ...view, scrollTop: 19000 }, { ...idle, hasNewer: false })).toBeNull();
    expect(nextLoad({ ...view, scrollTop: 19000 }, { ...idle, fetchingNewer: true })).toBeNull();
  });

  it("a conversation shorter than a screen: older first, then newer, one at a time", () => {
    const short = { scrollTop: 0, scrollHeight: 500, clientHeight: 800 };
    expect(nextLoad(short, idle)).toBe("older");
    expect(nextLoad(short, { ...idle, fetchingOlder: true })).toBeNull(); // never two page requests at once
    expect(nextLoad(short, { ...idle, hasOlder: false })).toBe("newer");
  });
});
