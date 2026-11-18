import { describe, expect, it } from "vitest";
import { captureAnchor, restoredScrollTop, shouldRestore, type Anchor } from "@/lib/chat/viewport/anchor";
import { PENDING_SCROLL_MS, pendingExpired } from "@/lib/chat/viewport/config";
import { buildRows, rowIndexOfMessage, scrollRowIndex, type Row } from "@/lib/chat/viewport/rows";
import { makeConversation } from "./chat-history-model.test";

/**
 * C1.7 — the pure half of the viewport: the offset arithmetic that keeps the visible message in place when older pages arrive
 * (or far pages are dropped), and the rows the virtual list is made of. The scroll itself needs a browser: see docs/restructure/pr/C1.7 notes.
 */

/** A tiny layout: rows of the given heights stacked from the top. */
const layout = (heights: number[], keys: string[]) => {
  let y = 0;
  return heights.map((h, i) => {
    const item = { key: keys[i]!, index: i, start: y, end: y + h };
    y += h;
    return item;
  });
};
const startOf = (items: ReturnType<typeof layout>, key: string) => items.find((i) => i.key === key)!.start;

describe("the visible message stays where it is when older messages are put above it", () => {
  const keys = Array.from({ length: 100 }, (_, i) => `m${i}`);
  const heights = keys.map((_, i) => 40 + (i % 7) * 13);

  it("captures the first row that is (even partly) in view, with its distance from the top of the view", () => {
    const items = layout(heights, keys);
    const scrollTop = items[30]!.start + 11; // row 30 is cut: 11px of it is above the view
    expect(captureAnchor(items, scrollTop)).toEqual({ key: "m30", index: 30, offset: -11 });
    expect(captureAnchor(items, items[30]!.start)).toEqual({ key: "m30", index: 30, offset: 0 });
    expect(captureAnchor(items, 0)).toEqual({ key: "m0", index: 0, offset: 0 });
    expect(captureAnchor([], 0)).toBeNull();
    expect(captureAnchor(items, items.at(-1)!.end + 500)).toBeNull(); // scrolled past everything: nothing to hold on to
  });

  it("after 50 older rows are prepended (estimated, then measured) the same row is at the same distance from the top", () => {
    const before = layout(heights, keys);
    const scrollTop = before[30]!.start + 11;
    const anchor = captureAnchor(before, scrollTop)!;
    const olderKeys = Array.from({ length: 50 }, (_, i) => `o${i}`);
    // 1) the prepend renders with ESTIMATED heights for the new rows
    const estimated = layout([...olderKeys.map(() => 60), ...heights], [...olderKeys, ...keys]);
    const t1 = restoredScrollTop(anchor, startOf(estimated, "m30"));
    expect(startOf(estimated, "m30") - t1).toBe(anchor.offset);
    // 2) the new rows are measured: they are really taller or shorter; the list shifts the scroll by what they changed (above the view)
    const real = olderKeys.map((_, i) => 30 + (i % 5) * 31);
    const measured = layout([...real, ...heights], [...olderKeys, ...keys]);
    const t2 = t1 + (measured.reduce((s, r) => s + (r.end - r.start), 0) - estimated.reduce((s, r) => s + (r.end - r.start), 0));
    expect(startOf(measured, "m30") - t2).toBe(anchor.offset); // the row did not move on the screen
    expect(restoredScrollTop(anchor, startOf(measured, "m30"))).toBe(t2);
  });

  it("the same when far rows ABOVE are dropped (the cap): the row stays", () => {
    const before = layout(heights, keys);
    const anchor = captureAnchor(before, before[60]!.start + 5)!;
    const kept = keys.slice(40);
    const after = layout(heights.slice(40), kept);
    const t = restoredScrollTop(anchor, startOf(after, "m60"));
    expect(startOf(after, "m60") - t).toBe(anchor.offset);
  });

  it("rows that are not messages (the day row, the unread row) are never the anchor: their keys come and go with the pages", () => {
    const items = layout([44, 60, 60, 60], ["day:a", "a", "b", "c"]);
    const onlyMessages = (i: { key: string | number | bigint }) => !String(i.key).startsWith("day:") && i.key !== "unread";
    // the view is at the very top: the day row is the first row in view, the first MESSAGE is held instead
    expect(captureAnchor(items, 0)).toMatchObject({ key: "day:a" });
    expect(captureAnchor(items, 0, onlyMessages)).toEqual({ key: "a", index: 1, offset: 44 });
    // an older page of the SAME day goes in front: the day row of "a" goes away, the anchor row is still there and the view follows it
    const anchor = captureAnchor(items, 0, onlyMessages)!;
    const older = layout([44, 60, 60, 60, 60, 60, 60], ["day:z", "x", "y", "w", "a", "b", "c"]); // day row of z, then four older, then a b c
    const t = restoredScrollTop(anchor, startOf(older, "a"));
    expect(startOf(older, "a") - t).toBe(anchor.offset);
    expect(shouldRestore(anchor, older.findIndex((i) => i.key === "a"))).toBe(true);
  });

  it("never scrolls to a negative offset", () => {
    const anchor: Anchor = { key: "a", index: 0, offset: 300 };
    expect(restoredScrollTop(anchor, 100)).toBe(0);
  });

  it("only acts when rows moved ABOVE the anchor (a new message at the bottom must not move the view)", () => {
    const anchor: Anchor = { key: "m30", index: 30, offset: 0 };
    expect(shouldRestore(anchor, 30)).toBe(false); // appended below
    expect(shouldRestore(anchor, 80)).toBe(true); // 50 prepended
    expect(shouldRestore(anchor, 10)).toBe(true); // 20 dropped above
    expect(shouldRestore(anchor, -1)).toBe(false); // the anchor row is gone
    expect(shouldRestore(null, 5)).toBe(false);
  });
});

describe("a landing that never finds its row", () => {
  it("is given up after two seconds, so it can never hold paging back for good", () => {
    expect(PENDING_SCROLL_MS).toBe(2000);
    expect(pendingExpired(1000, 1000 + PENDING_SCROLL_MS - 1)).toBe(false);
    expect(pendingExpired(1000, 1000 + PENDING_SCROLL_MS)).toBe(true);
  });
});

describe("the rows of the virtual list", () => {
  const msgs = (n: number, tie = 1) => makeConversation(n, tie);
  const kinds = (rows: Row[]) => rows.map((r) => r.type);

  it("one row per message, a day row where a new day starts, and keys that are the message ids", () => {
    const base = msgs(3);
    const day2 = base.map((m, i) => (i === 2 ? { ...m, createdAt: "2026-11-02T09:00:00.000Z" } : m));
    const rows = buildRows(day2, {});
    expect(kinds(rows)).toEqual(["day", "message", "message", "day", "message"]);
    expect(rows.filter((r) => r.type === "message").map((r) => r.key)).toEqual(day2.map((m) => m.id));
    expect(rows[0]).toMatchObject({ type: "day", key: `day:${day2[0]!.id}`, at: day2[0]!.createdAt });
    expect(rows[3]).toMatchObject({ type: "day", key: `day:${day2[2]!.id}` });
  });

  it("the unread row sits right above the first unread message (below its day row); absent when that message is not in the window", () => {
    const m = msgs(4);
    expect(kinds(buildRows(m, { unreadBeforeId: m[2]!.id }))).toEqual(["day", "message", "message", "unread", "message", "message"]);
    expect(buildRows(m, { unreadBeforeId: m[0]!.id }).slice(0, 3).map((r) => r.type)).toEqual(["day", "unread", "message"]);
    expect(kinds(buildRows(m, { unreadBeforeId: "not-here" }))).toEqual(["day", "message", "message", "message", "message"]);
    expect(buildRows(m, { unreadBeforeId: m[2]!.id }).find((r) => r.type === "unread")!.key).toBe("unread");
  });

  it("prepending an older page does not change the key of any row that was there, except the day row that no longer opens a day", () => {
    const all = msgs(120, 1);
    const newer = all.slice(60);
    const older = all.slice(0, 60);
    const before = buildRows(newer, {});
    const after = buildRows([...older, ...newer], {});
    const keysAfter = new Set(after.map((r) => r.key));
    const lost = before.filter((r) => !keysAfter.has(r.key));
    expect(lost.map((r) => r.key)).toEqual([`day:${newer[0]!.id}`]); // the same day: the older page opens it now
    expect(after.filter((r) => r.type === "day")).toHaveLength(1);
    // message rows keep their keys and their order
    expect(after.filter((r) => r.type === "message").slice(60).map((r) => r.key)).toEqual(before.filter((r) => r.type === "message").map((r) => r.key));
  });

  it("finds the row of a message", () => {
    const m = msgs(5);
    const rows = buildRows(m, { unreadBeforeId: m[3]!.id });
    expect(rowIndexOfMessage(rows, m[3]!.id)).toBe(rows.findIndex((r) => r.type === "message" && r.key === m[3]!.id));
    expect(rowIndexOfMessage(rows, "no")).toBe(-1);
  });

  it("scrolling to the message the unread line sits above goes to the LINE (aligned to the top), so the line is what the person sees", () => {
    const m = msgs(5);
    const rows = buildRows(m, { unreadBeforeId: m[3]!.id });
    const line = rows.findIndex((r) => r.type === "unread");
    expect(scrollRowIndex(rows, m[3]!.id, "start")).toBe(line);
    expect(scrollRowIndex(rows, m[3]!.id, "center")).toBe(rowIndexOfMessage(rows, m[3]!.id)); // a jump centres the message itself
    expect(scrollRowIndex(rows, m[2]!.id, "start")).toBe(rowIndexOfMessage(rows, m[2]!.id)); // no line above it: the message
    expect(scrollRowIndex(rows, "no", "start")).toBe(-1);
  });

  it("a message row carries its message, and the index the group / run rules need (`runFlags` works on the messages)", () => {
    const m = msgs(3);
    const rows = buildRows(m, {});
    const row = rows.find((r) => r.type === "message" && r.message.id === m[1]!.id)!;
    expect(row.type === "message" && row.index).toBe(1);
    expect(row.type === "message" && row.message).toBe(m[1]);
  });
});
