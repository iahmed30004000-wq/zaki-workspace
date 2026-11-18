import { describe, expect, it } from "vitest";
import { buildRows, rowIndexOfMessage, scrollRowIndex } from "@/lib/chat/viewport/rows";
import { estimateRowHeight, CALLS_ROW_PX } from "@/lib/chat/viewport/sizes";
import { FOLD_MIN_LINES, callCount, callRuns, isCallLine } from "@/lib/chat/viewport/calls";
import type { MessageDto } from "@/lib/chat/cache/types";
import { makeConversation } from "./chat-history-model.test";

/**
 * C2.4 — «a run of call lines folds into ONE chip»: the pure half. A dozen «بلّش مكالمة» / «خلصت المكالمة» lines in a row (seen live) are one row
 * of the virtual list that says how many calls they were; the rows of everything else are exactly what C1.7 made (the fold is opt-in).
 */
const call = (i: number, k: "call_started" | "call_ended" | "call_missed", at?: string): Partial<MessageDto> => ({ kind: "SYSTEM", body: null, authorName: "سلمى", system: { k }, ...(at ? { createdAt: at } : {}) });

/** `text` messages with a stretch of call lines in the middle: 6 calls = 12 lines. */
function withCalls(lines: Array<"call_started" | "call_ended" | "call_missed">, before = 3, after = 3): MessageDto[] {
  const total = before + lines.length + after;
  return makeConversation(total, 1, (i) => (i >= before && i < before + lines.length ? call(i, lines[i - before]!) : {}));
}
const six = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? ("call_started" as const) : ("call_ended" as const)));

describe("which lines are call lines", () => {
  it("only a SYSTEM line whose key is one of the three call keys", () => {
    const [text, started, ended, missed, join] = makeConversation(5, 1, (i) => (i === 1 ? call(i, "call_started") : i === 2 ? call(i, "call_ended") : i === 3 ? call(i, "call_missed") : i === 4 ? { kind: "SYSTEM", body: null, system: { k: "join" } } : {}));
    expect(isCallLine(text!)).toBe(false);
    expect(isCallLine(started!)).toBe(true);
    expect(isCallLine(ended!)).toBe(true);
    expect(isCallLine(missed!)).toBe(true);
    expect(isCallLine(join!)).toBe(false);
    // a text message that merely carries a system-looking body is not a call line
    expect(isCallLine({ kind: "TEXT", system: { k: "call_started" } } as MessageDto)).toBe(false);
  });
});

describe("the runs that fold", () => {
  it("a dozen lines in a row are one run; the messages around them are not in it", () => {
    const messages = withCalls(six);
    expect(callRuns(messages)).toEqual([{ from: 3, to: 15 }]);
  });

  it("one call (a start and its end) stays as two quiet lines: a run folds from FOLD_MIN_LINES lines on", () => {
    expect(FOLD_MIN_LINES).toBe(3);
    expect(callRuns(withCalls(["call_started", "call_ended"]))).toEqual([]);
    expect(callRuns(withCalls(["call_started", "call_ended", "call_started"]))).toEqual([{ from: 3, to: 6 }]);
  });

  it("a text message in the middle splits the run; two runs of three each fold on their own", () => {
    const lines = ["call_started", "call_ended", "call_started"] as const;
    const messages = makeConversation(10, 1, (i) => (i >= 1 && i <= 3 ? call(i, lines[i - 1]!) : i >= 5 && i <= 7 ? call(i, lines[i - 5]!) : {}));
    expect(callRuns(messages)).toEqual([{ from: 1, to: 4 }, { from: 5, to: 8 }]);
  });

  it("a run never crosses midnight: the day row between its lines keeps its place", () => {
    const messages = makeConversation(8, 1, (i) => (i >= 2 && i <= 5 ? call(i, i % 2 === 0 ? "call_started" : "call_ended", i < 4 ? "2026-11-01T22:00:00.000Z" : "2026-11-02T22:00:00.000Z") : {}));
    // the first two lines are one day (below the minimum), the last two another (below the minimum): nothing folds
    expect(callRuns(messages)).toEqual([]);
    // and four lines on one side of midnight and two on the other: the first four fold, the others stay lines
    const longer = makeConversation(9, 1, (i) => (i >= 1 && i <= 6 ? call(i, i % 2 === 1 ? "call_started" : "call_ended", i <= 4 ? "2026-11-01T22:00:00.000Z" : "2026-11-02T22:00:00.000Z") : {}));
    expect(callRuns(longer)).toEqual([{ from: 1, to: 5 }]);
  });

  it("the caller may break a run (the «رسائل غير مقروءة» line goes between two of its lines)", () => {
    const messages = withCalls(six);
    const runs = callRuns(messages, { breakBefore: (i) => i === 9 });
    expect(runs).toEqual([{ from: 3, to: 9 }, { from: 9, to: 15 }]);
  });
});

describe("how many calls a run holds", () => {
  const lines = (ks: Array<"call_started" | "call_ended" | "call_missed">) => ks.map((k, i) => makeConversation(1, 1, () => call(i, k))[0]!);
  it("six starts and six ends are six calls", () => expect(callCount(lines(six))).toBe(6));
  it("a missed call is a call; an end whose start is above the window still counts", () => {
    expect(callCount(lines(["call_started", "call_missed", "call_started"]))).toBe(3);
    expect(callCount(lines(["call_ended", "call_ended", "call_ended"]))).toBe(3);
    expect(callCount(lines(["call_ended", "call_started", "call_ended"]))).toBe(2);
  });
});

describe("the rows of the virtual list", () => {
  it("OFF by default: one row per message, exactly as C1.7 made them", () => {
    const messages = withCalls(six);
    const rows = buildRows(messages);
    expect(rows.filter((r) => r.type === "message")).toHaveLength(messages.length);
    expect(rows.some((r) => r.type === "calls")).toBe(false);
  });

  it("with foldCalls the dozen lines are ONE row between the messages, keyed by the first line", () => {
    const messages = withCalls(six);
    const rows = buildRows(messages, { foldCalls: true });
    const calls = rows.filter((r) => r.type === "calls");
    expect(calls).toHaveLength(1);
    const chip = calls[0] as Extract<(typeof rows)[number], { type: "calls" }>;
    // keyed by its LAST line: an older page that grows the run upward must not change the key of a row that is on screen
    expect(chip.key).toBe(`calls:${messages[14]!.id}`);
    expect(chip.messages).toHaveLength(12);
    expect(chip.index).toBe(3);
    expect(rows.filter((r) => r.type === "message")).toHaveLength(6);
    // order is kept: three messages, the chip, three messages (a day row opens the log)
    expect(rows.map((r) => r.type)).toEqual(["day", "message", "message", "message", "calls", "message", "message", "message"]);
  });

  it("the unread line splits a run, so it always has a row to stand above", () => {
    const messages = withCalls(six);
    const rows = buildRows(messages, { foldCalls: true, unreadBeforeId: messages[9]!.id });
    expect(rows.filter((r) => r.type === "calls")).toHaveLength(2);
    const at = rows.findIndex((r) => r.type === "unread");
    expect(rows[at + 1]!.type).toBe("calls");
    expect((rows[at + 1] as { key: string }).key).toBe(`calls:${messages[14]!.id}`);
  });

  it("a message inside a folded run is found at the chip's row (a jump to it scrolls to the chip)", () => {
    const messages = withCalls(six);
    const rows = buildRows(messages, { foldCalls: true });
    const chipAt = rows.findIndex((r) => r.type === "calls");
    expect(rowIndexOfMessage(rows, messages[8]!.id)).toBe(chipAt);
    expect(scrollRowIndex(rows, messages[8]!.id, "center")).toBe(chipAt);
    expect(rowIndexOfMessage(rows, "missing")).toBe(-1);
  });

  it("the key of the chip survives an older page: call lines put ABOVE a run leave its key (and so its measured height and the scroll anchor) alone", () => {
    const lines = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? ("call_started" as const) : ("call_ended" as const)));
    const all = withCalls(lines, 6, 3);
    // the window that was loaded first: the first lines of the run were cut off by its boundary
    const young = buildRows(all.slice(10), { foldCalls: true }).find((r) => r.type === "calls")!;
    const older = buildRows(all.slice(4), { foldCalls: true }).find((r) => r.type === "calls")!;
    expect(older.key).toBe(young.key);
  });

  it("the hook may anchor on a chip as well as on a message (a chip is a row the person can be looking at)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/chat/viewport/use-message-viewport.ts", "utf8");
    expect(src).toMatch(/type === "message" \|\| old\[i\.index\]\?\.type === "calls"/);
  });

  it("the chip has a fixed height for the first paint", () => {
    const rows = buildRows(withCalls(six), { foldCalls: true });
    const chip = rows.find((r) => r.type === "calls")!;
    expect(estimateRowHeight(chip)).toBe(CALLS_ROW_PX);
  });
});
