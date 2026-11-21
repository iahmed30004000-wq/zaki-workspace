import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachReplySwipe, commitsReply, hapticTick, replyPullOf, REPLY_COMMIT_PX, REPLY_MAX_PX, type ReplyBox, type ReplyEnv } from "@/lib/chat/v2/phone/swipe-reply";
import { attachRowSwipe, rowSwipeActionsOf, rowSwipeChange, ROW_ACTION_PX, type RowSwipeBox, type RowSwipeEnv } from "@/lib/chat/v2/phone/row-swipe";

/**
 * S5.7 (b) swipe a message to reply, (e) swipe a row of the list: the REAL controllers driven with a plain event target standing in for the box, no browser
 * (a finger on a real phone is the owner's check; this proves the rules: where a swipe may begin, which way it goes, what it never fights).
 */
class FakeBox extends EventTarget {
  captured: number[] = [];
  setPointerCapture(id: number) {
    this.captured.push(id);
  }
  releasePointerCapture() {}
  fire(type: string, fields: Partial<{ pointerId: number; pointerType: string; isPrimary: boolean; clientX: number; clientY: number; timeStamp: number; target: unknown }> = {}) {
    const event = new Event(type);
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 200, clientY: 300, timeStamp: 0, ...fields })) Object.defineProperty(event, key, { value });
    this.dispatchEvent(event);
  }
}

const WIDTH = 375;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the rules of the reply swipe", () => {
  it("pulls with a little resistance past the trigger and never past the cap", () => {
    expect(replyPullOf(-20)).toBe(0);
    expect(replyPullOf(30)).toBe(30);
    expect(replyPullOf(REPLY_COMMIT_PX)).toBe(REPLY_COMMIT_PX);
    expect(replyPullOf(REPLY_COMMIT_PX + 40)).toBeLessThan(REPLY_COMMIT_PX + 40);
    expect(replyPullOf(REPLY_COMMIT_PX + 40)).toBeGreaterThan(REPLY_COMMIT_PX);
    expect(replyPullOf(2000)).toBe(REPLY_MAX_PX);
  });

  it("commits on a long straight pull only: not a short one, not a diagonal one, not one the wrong way", () => {
    expect(commitsReply({ inward: REPLY_COMMIT_PX, dy: 4 })).toBe(true);
    expect(commitsReply({ inward: REPLY_COMMIT_PX - 1, dy: 0 })).toBe(false);
    expect(commitsReply({ inward: 90, dy: 80 })).toBe(false);
    expect(commitsReply({ inward: -90, dy: 0 })).toBe(false);
  });

  it("the haptic tick is feature-detected: it vibrates where it can and is silent where there is no vibrate", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    expect(hapticTick()).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
    vi.stubGlobal("navigator", {});
    expect(hapticTick()).toBe(false);
    vi.stubGlobal("navigator", { vibrate: () => { throw new Error("blocked"); } });
    expect(hapticTick()).toBe(false);
    vi.unstubAllGlobals();
  });
});

function replyRig(over: Partial<ReplyEnv> = {}) {
  const box = new FakeBox();
  const pulls: number[] = [];
  const env: ReplyEnv = {
    rtl: () => true,
    width: () => WIDTH,
    enabled: () => true,
    hasSelection: () => false,
    onPull: (px) => void pulls.push(px),
    onReply: vi.fn(),
    haptic: vi.fn(),
    ...over,
  };
  const detach = attachReplySwipe(box as unknown as ReplyBox, env);
  return { box, env, pulls, detach };
}

describe("swipe a message to reply (a finger, right to left)", () => {
  it("goes from the start side toward the end (leftwards here): follows the finger, buzzes once at the trigger, replies on release", () => {
    const r = replyRig();
    r.box.fire("pointerdown", { clientX: 250, clientY: 300, timeStamp: 0 });
    r.box.fire("pointermove", { clientX: 245, clientY: 302, timeStamp: 20 }); // 5 px: undecided
    expect(r.pulls).toEqual([]);
    r.box.fire("pointermove", { clientX: 225, clientY: 302, timeStamp: 40 }); // 25 px: a swipe
    expect(r.pulls.at(-1)).toBeGreaterThan(0);
    expect(r.env.haptic).not.toHaveBeenCalled();
    r.box.fire("pointermove", { clientX: 170, clientY: 303, timeStamp: 80 }); // 80 px: past the trigger
    expect(r.env.haptic).toHaveBeenCalledTimes(1);
    r.box.fire("pointermove", { clientX: 160, clientY: 303, timeStamp: 100 });
    expect(r.env.haptic).toHaveBeenCalledTimes(1); // once, not at every move
    r.box.fire("pointerup", { clientX: 160, clientY: 303, timeStamp: 120 });
    expect(r.env.onReply).toHaveBeenCalledTimes(1);
    expect(r.pulls.at(-1)).toBe(0); // the bubble settles back
    expect(r.box.captured).toEqual([1]);
  });

  it("in a left-to-right page the direction mirrors: rightwards replies, leftwards does nothing", () => {
    const ltr = replyRig({ rtl: () => false });
    ltr.box.fire("pointerdown", { clientX: 100 });
    ltr.box.fire("pointermove", { clientX: 190 });
    ltr.box.fire("pointerup", { clientX: 190 });
    expect(ltr.env.onReply).toHaveBeenCalledTimes(1);
    const wrong = replyRig({ rtl: () => false });
    wrong.box.fire("pointerdown", { clientX: 200 });
    wrong.box.fire("pointermove", { clientX: 100 });
    wrong.box.fire("pointerup", { clientX: 100 });
    expect(wrong.env.onReply).not.toHaveBeenCalled();
    expect(wrong.pulls).toEqual([]);
  });

  it("a short pull settles back and replies to nothing (the cancel)", () => {
    const r = replyRig();
    r.box.fire("pointerdown", { clientX: 250 });
    r.box.fire("pointermove", { clientX: 215 });
    r.box.fire("pointerup", { clientX: 215 });
    expect(r.env.onReply).not.toHaveBeenCalled();
    expect(r.env.haptic).not.toHaveBeenCalled();
    expect(r.pulls.at(-1)).toBe(0);
  });

  it("pulling past the trigger and coming back before lifting cancels it too", () => {
    const r = replyRig();
    r.box.fire("pointerdown", { clientX: 250 });
    r.box.fire("pointermove", { clientX: 160 });
    r.box.fire("pointermove", { clientX: 235 });
    r.box.fire("pointerup", { clientX: 235 });
    expect(r.env.onReply).not.toHaveBeenCalled();
  });

  it("never fights the scroll: a mostly vertical move is the page's, even if the finger drifts sideways afterwards", () => {
    const r = replyRig();
    r.box.fire("pointerdown", { clientX: 250, clientY: 300 });
    r.box.fire("pointermove", { clientX: 246, clientY: 340 });
    r.box.fire("pointermove", { clientX: 120, clientY: 345 });
    r.box.fire("pointerup", { clientX: 120, clientY: 345 });
    expect(r.env.onReply).not.toHaveBeenCalled();
    expect(r.pulls).toEqual([]);
    expect(r.box.captured).toEqual([]);
  });

  it("a diagonal pull is not a swipe", () => {
    const r = replyRig();
    r.box.fire("pointerdown", { clientX: 250, clientY: 300 });
    r.box.fire("pointermove", { clientX: 200, clientY: 340 });
    r.box.fire("pointerup", { clientX: 160, clientY: 345 });
    expect(r.env.onReply).not.toHaveBeenCalled();
  });

  it("a cancelled pointer (the browser took the gesture) replies to nothing and settles", () => {
    const r = replyRig();
    r.box.fire("pointerdown", { clientX: 250 });
    r.box.fire("pointermove", { clientX: 150 });
    r.box.fire("pointercancel", { clientX: 150 });
    expect(r.env.onReply).not.toHaveBeenCalled();
    expect(r.pulls.at(-1)).toBe(0);
  });

  it("a mouse, a pen, a second finger never swipe", () => {
    for (const fields of [{ pointerType: "mouse" }, { pointerType: "pen" }, { isPrimary: false }]) {
      const r = replyRig();
      r.box.fire("pointerdown", { clientX: 250, ...fields });
      r.box.fire("pointermove", { clientX: 150, ...fields });
      r.box.fire("pointerup", { clientX: 150, ...fields });
      expect(r.env.onReply, JSON.stringify(fields)).not.toHaveBeenCalled();
    }
  });

  it("does not start inside the strip along the start edge (that is the swipe back), nor on something that does its own thing", () => {
    const edge = replyRig();
    edge.box.fire("pointerdown", { clientX: WIDTH - 10 });
    edge.box.fire("pointermove", { clientX: 100 });
    edge.box.fire("pointerup", { clientX: 100 });
    expect(edge.env.onReply).not.toHaveBeenCalled();
    for (const selector of ["a", "button", "input", "video", "audio", "[data-no-reply]"]) {
      const r = replyRig();
      const target = { closest: (s: string) => (s.split(",").includes(selector) ? {} : null) };
      r.box.fire("pointerdown", { clientX: 250, target });
      r.box.fire("pointermove", { clientX: 150, target });
      r.box.fire("pointerup", { clientX: 150, target });
      expect(r.env.onReply, selector).not.toHaveBeenCalled();
    }
  });

  it("is off while selecting messages, and while text is selected", () => {
    const selecting = replyRig({ enabled: () => false });
    selecting.box.fire("pointerdown", { clientX: 250 });
    selecting.box.fire("pointermove", { clientX: 150 });
    selecting.box.fire("pointerup", { clientX: 150 });
    expect(selecting.env.onReply).not.toHaveBeenCalled();
    const text = replyRig({ hasSelection: () => true });
    text.box.fire("pointerdown", { clientX: 250 });
    text.box.fire("pointermove", { clientX: 150 });
    text.box.fire("pointerup", { clientX: 150 });
    expect(text.env.onReply).not.toHaveBeenCalled();
  });

  it("detaching removes every listener", () => {
    const r = replyRig();
    r.detach();
    r.box.fire("pointerdown", { clientX: 250 });
    r.box.fire("pointermove", { clientX: 150 });
    r.box.fire("pointerup", { clientX: 150 });
    expect(r.env.onReply).not.toHaveBeenCalled();
  });
});

describe("what a swipe on a row of the list offers", () => {
  const row = (over: Record<string, unknown> = {}) => ({ kind: "TOPIC" as const, pinnedByMe: false, archivedByMe: false, muted: false, ...over });

  it("pin, mute and archive, in that order; each says which way it goes from the row", () => {
    expect(rowSwipeActionsOf(row()).map((a) => a.id)).toEqual(["pin", "mute", "archive"]);
    expect(rowSwipeActionsOf(row({ pinnedByMe: true, muted: true, archivedByMe: true })).map((a) => a.id)).toEqual(["unpin", "unmute", "unarchive"]);
  });

  it("is the SAME personal door as the row menu: a pin, an archive, a mute with a time or none", () => {
    const now = new Date("2026-11-21T10:00:00.000Z");
    expect(rowSwipeChange("pin", now)).toEqual({ pinned: true });
    expect(rowSwipeChange("unpin", now)).toEqual({ pinned: false });
    expect(rowSwipeChange("archive", now)).toEqual({ archived: true });
    expect(rowSwipeChange("unarchive", now)).toEqual({ archived: false });
    expect(rowSwipeChange("unmute", now)).toEqual({ mutedUntil: null });
    const mute = rowSwipeChange("mute", now) as { mutedUntil: string };
    expect(Date.parse(mute.mutedUntil)).toBeGreaterThan(now.getTime() + 24 * 3_600_000);
  });

  it("a space row (a forum) and a company with the personal items off have nothing to swipe", () => {
    expect(rowSwipeActionsOf(row({ kind: "SPACE" }))).toEqual([]);
    expect(rowSwipeActionsOf(row(), { personal: false })).toEqual([]);
  });

  it("every label is a dictionary key in Arabic (the personal items' own words are reused)", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    for (const a of rowSwipeActionsOf(row())) expect(AR[a.labelKey as keyof typeof AR], a.labelKey).toBeTruthy();
    for (const a of rowSwipeActionsOf(row({ pinnedByMe: true, muted: true, archivedByMe: true }))) expect(AR[a.labelKey as keyof typeof AR], a.labelKey).toBeTruthy();
  });
});

function rowRig(over: Partial<RowSwipeEnv> = {}) {
  const box = new FakeBox();
  const offsets: number[] = [];
  const opened: boolean[] = [];
  const env: RowSwipeEnv = {
    rtl: () => true,
    width: () => WIDTH,
    reveal: () => ROW_ACTION_PX * 3,
    enabled: () => true,
    onOffset: (px) => void offsets.push(px),
    onOpenChange: (open) => void opened.push(open),
    ...over,
  };
  const swipe = attachRowSwipe(box as unknown as RowSwipeBox, env);
  return { box, env, offsets, opened, swipe };
}

describe("swipe a row of the phone's list", () => {
  it("toward the START edge (rightwards here, away from the swipe back) reveals the actions and settles open past half", () => {
    const r = rowRig();
    r.box.fire("pointerdown", { clientX: 100, clientY: 400, timeStamp: 0 });
    r.box.fire("pointermove", { clientX: 130, clientY: 402, timeStamp: 30 });
    r.box.fire("pointermove", { clientX: 230, clientY: 402, timeStamp: 80 });
    expect(Math.max(...r.offsets)).toBeGreaterThan(100);
    r.box.fire("pointerup", { clientX: 230, clientY: 402, timeStamp: 120 });
    expect(r.opened).toEqual([true]);
    expect(r.offsets.at(-1)).toBe(ROW_ACTION_PX * 3);
  });

  it("never reveals more than the actions' width", () => {
    const r = rowRig();
    r.box.fire("pointerdown", { clientX: 20, clientY: 400 });
    r.box.fire("pointermove", { clientX: 360, clientY: 401 });
    expect(Math.max(...r.offsets)).toBe(ROW_ACTION_PX * 3);
  });

  it("a short pull snaps closed; a quick flick opens", () => {
    const slow = rowRig();
    slow.box.fire("pointerdown", { clientX: 100, clientY: 400, timeStamp: 0 });
    slow.box.fire("pointermove", { clientX: 150, clientY: 400, timeStamp: 400 });
    slow.box.fire("pointerup", { clientX: 150, clientY: 400, timeStamp: 500 });
    expect(slow.opened).toEqual([]);
    expect(slow.offsets.at(-1)).toBe(0);
    const flick = rowRig();
    flick.box.fire("pointerdown", { clientX: 100, clientY: 400, timeStamp: 0 });
    flick.box.fire("pointermove", { clientX: 145, clientY: 400, timeStamp: 40 });
    flick.box.fire("pointerup", { clientX: 145, clientY: 400, timeStamp: 60 });
    expect(flick.opened).toEqual([true]);
  });

  it("the other way does nothing while closed", () => {
    const r = rowRig();
    r.box.fire("pointerdown", { clientX: 200, clientY: 400 });
    r.box.fire("pointermove", { clientX: 100, clientY: 400 });
    r.box.fire("pointerup", { clientX: 100, clientY: 400 });
    expect(r.offsets).toEqual([]);
    expect(r.opened).toEqual([]);
  });

  it("an open row closes by a swipe back, and by close()", () => {
    const r = rowRig();
    r.box.fire("pointerdown", { clientX: 100, clientY: 400, timeStamp: 0 });
    r.box.fire("pointermove", { clientX: 260, clientY: 400, timeStamp: 60 });
    r.box.fire("pointerup", { clientX: 260, clientY: 400, timeStamp: 80 });
    expect(r.opened).toEqual([true]);
    r.box.fire("pointerdown", { clientX: 300, clientY: 400, timeStamp: 1000 });
    r.box.fire("pointermove", { clientX: 200, clientY: 400, timeStamp: 1050 });
    r.box.fire("pointermove", { clientX: 100, clientY: 400, timeStamp: 1100 });
    r.box.fire("pointerup", { clientX: 100, clientY: 400, timeStamp: 1120 });
    expect(r.opened).toEqual([true, false]);
    // open again, then close by hand (a tap elsewhere, another row opening)
    r.box.fire("pointerdown", { clientX: 100, clientY: 400, timeStamp: 2000 });
    r.box.fire("pointermove", { clientX: 260, clientY: 400, timeStamp: 2050 });
    r.box.fire("pointerup", { clientX: 260, clientY: 400, timeStamp: 2060 });
    r.swipe.close();
    expect(r.opened).toEqual([true, false, true, false]);
    expect(r.offsets.at(-1)).toBe(0);
  });

  it("never fights the vertical scroll, the swipe back's edge strip, a mouse or a disabled list", () => {
    const scroll = rowRig();
    scroll.box.fire("pointerdown", { clientX: 100, clientY: 400 });
    scroll.box.fire("pointermove", { clientX: 108, clientY: 450 });
    scroll.box.fire("pointermove", { clientX: 260, clientY: 455 });
    scroll.box.fire("pointerup", { clientX: 260, clientY: 455 });
    expect(scroll.offsets).toEqual([]);
    const edge = rowRig();
    edge.box.fire("pointerdown", { clientX: WIDTH - 8, clientY: 400 });
    edge.box.fire("pointermove", { clientX: 150, clientY: 400 });
    edge.box.fire("pointerup", { clientX: 150, clientY: 400 });
    expect(edge.offsets).toEqual([]);
    const mouse = rowRig();
    mouse.box.fire("pointerdown", { clientX: 100, clientY: 400, pointerType: "mouse" });
    mouse.box.fire("pointermove", { clientX: 260, clientY: 400, pointerType: "mouse" });
    expect(mouse.offsets).toEqual([]);
    const off = rowRig({ enabled: () => false });
    off.box.fire("pointerdown", { clientX: 100, clientY: 400 });
    off.box.fire("pointermove", { clientX: 260, clientY: 400 });
    expect(off.offsets).toEqual([]);
  });

  it("mirrors in a left-to-right page", () => {
    const r = rowRig({ rtl: () => false });
    r.box.fire("pointerdown", { clientX: 250, clientY: 400, timeStamp: 0 });
    r.box.fire("pointermove", { clientX: 90, clientY: 400, timeStamp: 60 });
    r.box.fire("pointerup", { clientX: 90, clientY: 400, timeStamp: 80 });
    expect(r.opened).toEqual([true]);
  });
});
