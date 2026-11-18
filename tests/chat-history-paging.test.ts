import { describe, expect, it } from "vitest";
import { messagesQueryOptions } from "@/lib/chat/cache/queries";
import { hasMessage, pageIndexOf, reachesNewest, reachesOldest } from "@/lib/chat/cache/pages";
import { MAX_PAGES, trimPages, viewportPageOf } from "@/lib/chat/cache/trim";
import { LATEST, type MessageDto, type MessagesData, type MessagesPageDto, type MessagesParam } from "@/lib/chat/cache/types";
import { makeConversation, serve } from "./chat-history-model.test";

/**
 * C1.6 — paging in both directions over a pure model of the server's windows (`conversationMessages`: the order and the cursor are
 * `(createdAt, id)`). The model lives in `tests/chat-history-model.test.ts`; the real server is held to the same rules by
 * `tests/db/chat-messages-paging.test.ts` and `tests/db/chat-paging-ties.test.ts`.
 */

const options = messagesQueryOptions("c1");
const older = (d: MessagesData): MessagesParam | undefined => options.getPreviousPageParam(d.pages[0]!);
const newer = (d: MessagesData): MessagesParam | undefined => options.getNextPageParam(d.pages[d.pages.length - 1]!);
const prepend = (d: MessagesData, page: MessagesPageDto, param: MessagesParam): MessagesData => ({ pages: [page, ...d.pages], pageParams: [param, ...d.pageParams] });
const append = (d: MessagesData, page: MessagesPageDto, param: MessagesParam): MessagesData => ({ pages: [...d.pages, page], pageParams: [...d.pageParams, param] });
const flat = (d: MessagesData): MessageDto[] => d.pages.flatMap((p) => p.messages);

/** The windows hold ONE unbroken run of the conversation: every neighbour pair is adjacent in the full log, nothing twice. */
function expectContiguous(all: MessageDto[], d: MessagesData) {
  const at = new Map(all.map((m, i) => [m.id, i]));
  const ids = flat(d).map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (let i = 1; i < ids.length; i++) expect(at.get(ids[i]!)!, `${ids[i - 1]} then ${ids[i]}`).toBe(at.get(ids[i - 1]!)! + 1);
}

describe("paging both ways: no gap, no duplicate", () => {
  it("the cursors of the real query options walk a conversation back to its first message, and forward to the newest again", () => {
    const all = makeConversation(430, 1);
    let d: MessagesData = { pages: [serve(all, LATEST)], pageParams: [LATEST] };
    const seen = new Set(flat(d).map((m) => m.id));
    for (let guard = 0; guard < 50; guard++) {
      const param = older(d);
      if (!param) break;
      d = prepend(d, serve(all, param), param);
      expectContiguous(all, d);
      for (const m of d.pages[0]!.messages) seen.add(m.id);
    }
    expect(seen.size).toBe(430);
    expect(reachesOldest(d)).toBe(true);
    expect(flat(d)[0]!.id).toBe(all[0]!.id);
    expect(older(d)).toBeUndefined();
    // and from the oldest forward: a window that is not the newest says so, and `after` walks to the end
    let f: MessagesData = { pages: [d.pages[0]!], pageParams: [d.pageParams[0]!] };
    expect(reachesNewest(f)).toBe(false);
    for (let guard = 0; guard < 50; guard++) {
      const param = newer(f);
      if (!param) break;
      f = append(f, serve(all, param), param);
      expectContiguous(all, f);
    }
    expect(reachesNewest(f)).toBe(true);
    expect(flat(f).at(-1)!.id).toBe(all.at(-1)!.id);
    expect(flat(f)).toHaveLength(430);
  });

  it("ties on createdAt at a window boundary lose nothing and repeat nothing, in either direction (ties longer than a window too)", () => {
    for (const tie of [3, 7, 50, 120]) {
      const all = makeConversation(600, tie);
      let d: MessagesData = { pages: [serve(all, LATEST)], pageParams: [LATEST] };
      for (let guard = 0; guard < 50; guard++) {
        const param = older(d);
        if (!param) break;
        d = prepend(d, serve(all, param), param);
        expectContiguous(all, d);
      }
      expect(flat(d)).toHaveLength(600);
      // a window that STARTS in the middle of a tie group, walked forward
      let f: MessagesData = { pages: [serve(all, { kind: "around", id: all[300]!.id })], pageParams: [{ kind: "around", id: all[300]!.id }] };
      expectContiguous(all, f);
      for (let guard = 0; guard < 50; guard++) {
        const param = newer(f);
        if (!param) break;
        f = append(f, serve(all, param), param);
        expectContiguous(all, f);
      }
      for (let guard = 0; guard < 50; guard++) {
        const param = older(f);
        if (!param) break;
        f = prepend(f, serve(all, param), param);
        expectContiguous(all, f);
      }
      expect(flat(f)).toHaveLength(600);
    }
  });

});

describe("a 5 000-message conversation is read from the newest message to the first one without a jump", () => {
  const all = makeConversation(5000, 7);

  it("backward: each older window ends right before the message the person was looking at; at most 10 windows are ever kept", () => {
    let d: MessagesData = { pages: [serve(all, LATEST)], pageParams: [LATEST] };
    let fetched = 1;
    let widest = 1;
    const visited = new Set(flat(d).map((m) => m.id));
    for (let guard = 0; guard < 200; guard++) {
      const param = older(d);
      if (!param) break;
      const viewing = flat(d)[0]!; // the message at the top of the screen when the window arrives
      const page = serve(all, param);
      const at = new Map(all.map((m, i) => [m.id, i]));
      // no gap, no overlap: the new window ends right before the message on screen
      expect(at.get(page.messages.at(-1)!.id)! + 1).toBe(at.get(viewing.id)!);
      d = prepend(d, page, param);
      fetched++;
      for (const m of page.messages) visited.add(m.id);
      d = trimPages(d, 0).data; // the screen is at the top: the newest windows are far from it
      widest = Math.max(widest, d.pages.length);
      expect(d.pages.length).toBeLessThanOrEqual(MAX_PAGES);
      expect(hasMessage(d, viewing.id)).toBe(true); // the message on screen is never dropped
      expectContiguous(all, d);
    }
    expect(fetched).toBe(100);
    expect(visited.size).toBe(5000);
    expect(flat(d)[0]!.id).toBe(all[0]!.id);
    expect(reachesOldest(d)).toBe(true);
    expect(widest).toBe(MAX_PAGES);
  });

  it("forward from the first message to the newest, the same way", () => {
    const first = serve(all, { kind: "around", id: all[0]!.id });
    let d: MessagesData = { pages: [first], pageParams: [{ kind: "around", id: all[0]!.id }] };
    const visited = new Set(flat(d).map((m) => m.id));
    for (let guard = 0; guard < 200; guard++) {
      const param = newer(d);
      if (!param) break;
      const viewing = flat(d).at(-1)!;
      const page = serve(all, param);
      const at = new Map(all.map((m, i) => [m.id, i]));
      expect(at.get(page.messages[0]!.id)!).toBe(at.get(viewing.id)! + 1);
      d = append(d, page, param);
      for (const m of page.messages) visited.add(m.id);
      d = trimPages(d, d.pages.length - 1).data; // the screen is at the bottom: the oldest windows are far from it
      expect(d.pages.length).toBeLessThanOrEqual(MAX_PAGES);
      expect(hasMessage(d, viewing.id)).toBe(true);
      expectContiguous(all, d);
    }
    expect(visited.size).toBe(5000);
    expect(reachesNewest(d)).toBe(true);
    expect(flat(d).at(-1)!.id).toBe(all.at(-1)!.id);
  });
});

describe("the ten-window cap", () => {
  const all = makeConversation(1500, 1);
  const build = (n: number): MessagesData => {
    let d: MessagesData = { pages: [serve(all, LATEST)], pageParams: [LATEST] };
    for (let i = 1; i < n; i++) {
      const param = older(d)!;
      d = prepend(d, serve(all, param), param);
    }
    return d;
  };

  it("does nothing while there are ten windows or fewer (the very same object)", () => {
    const d = build(10);
    const out = trimPages(d, 3);
    expect(out.data).toBe(d);
    expect(out.droppedOlder + out.droppedNewer).toBe(0);
  });

  it("drops the windows FAR from the viewport: the newest when the viewport is at the top, the oldest when it is at the bottom", () => {
    const d = build(14);
    const top = trimPages(d, 0);
    expect(top.data.pages).toHaveLength(10);
    expect(top.droppedNewer).toBe(4);
    expect(top.droppedOlder).toBe(0);
    expect(top.data.pages[0]).toBe(d.pages[0]); // nothing was copied that did not need to be
    const bottom = trimPages(d, 13);
    expect(bottom.data.pages).toHaveLength(10);
    expect(bottom.droppedOlder).toBe(4);
    expect(bottom.data.pages.at(-1)).toBe(d.pages.at(-1));
    const middle = trimPages(d, 6); // 6 from the top, 7 from the bottom: the newer end is farther
    expect(middle.droppedOlder).toBe(1);
    expect(middle.droppedNewer).toBe(3);
    expect(middle.data.pages.map((p) => p.messages[0]!.id)).toContain(d.pages[6]!.messages[0]!.id);
  });

  it("what is left says honestly that there is more: the cut end is hasOlder / hasNewer, and the cursors still page across the cut", () => {
    const d = build(13);
    const cutNewer = trimPages(d, 0).data;
    expect(cutNewer.pages.at(-1)!.hasNewer).toBe(true); // it was the newest window: it no longer reaches the newest message
    expect(reachesNewest(cutNewer)).toBe(false);
    expect(newer(cutNewer)).toEqual({ kind: "after", id: cutNewer.pages.at(-1)!.messages.at(-1)!.id });
    const cutOlder = trimPages(d, 12).data;
    expect(cutOlder.pages[0]!.hasOlder).toBe(true);
    expect(older(cutOlder)).toEqual({ kind: "before", id: cutOlder.pages[0]!.messages[0]!.id });
    // and the page params follow their pages
    expect(cutOlder.pageParams).toHaveLength(cutOlder.pages.length);
    expect(cutNewer.pageParams).toEqual(d.pageParams.slice(0, 10));
  });

  it("the viewport window is found from the message on screen; an unknown message means NO window (nothing is cut on a guess)", () => {
    const d = build(12);
    const id = d.pages[4]!.messages[10]!.id;
    expect(pageIndexOf(d, id)).toBe(4);
    expect(viewportPageOf(d, id)).toBe(4);
    expect(viewportPageOf(d, "nope")).toBe(-1); // e.g. the id from before a jump: cutting around a guess could drop the windows under the screen
    expect(viewportPageOf(d, null)).toBe(-1);
    expect(pageIndexOf(d, "nope")).toBe(-1);
  });

  it("a cap other than ten, and a viewport outside the windows, are honoured and clamped", () => {
    const d = build(6);
    expect(trimPages(d, 99, 3).data.pages).toHaveLength(3);
    expect(trimPages(d, -4, 3).data.pages[0]).toBe(d.pages[0]);
    expect(trimPages(d, 2, 1).data.pages).toHaveLength(1);
  });
});
