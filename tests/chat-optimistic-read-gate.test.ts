/**
 * C1.8 — read marks go out ONLY when the tab is visible and focused (F0.5) AND only when the newest message that was read CHANGED.
 * (`createReadMarker`, `src/lib/chat/read-gate.ts`: what the new screen uses; the old screen keeps its own refs.)
 */
import { describe, expect, it, vi } from "vitest";
import { canMarkReadNow, createReadMarker, PENDING_ID_PREFIX_FOR_READS } from "../src/lib/chat/read-gate";
import { PENDING_ID_PREFIX } from "../src/lib/chat/cache/pending";

function rig(state: { visible: boolean; focused: boolean } = { visible: true, focused: true }, answer: () => Promise<boolean> = async () => true) {
  const post = vi.fn((_c: string, _id: string) => answer());
  const onMarked = vi.fn();
  const marker = createReadMarker({ post, canMark: () => state.visible && state.focused, onMarked });
  return { marker, post, onMarked, state };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("C1.8: the read gate (visible AND focused)", () => {
  it("canMarkReadNow is unchanged: visible and focused, nothing else", () => {
    expect(canMarkReadNow({ visibilityState: "visible", hasFocus: () => true })).toBe(true);
    expect(canMarkReadNow({ visibilityState: "visible", hasFocus: () => false })).toBe(false);
    expect(canMarkReadNow({ visibilityState: "hidden", hasFocus: () => true })).toBe(false);
  });

  it("a hidden tab marks nothing; once it is visible and focused again the newest is marked ONCE", async () => {
    const r = rig({ visible: false, focused: true });
    r.marker.consider("c1", "m5");
    r.marker.consider("c1", "m6");
    await settle();
    expect(r.post).not.toHaveBeenCalled();
    r.state.visible = true;
    r.marker.resume();
    await settle();
    expect(r.post.mock.calls).toEqual([["c1", "m6"]]);
    r.marker.resume();
    await settle();
    expect(r.post).toHaveBeenCalledTimes(1);
  });

  it("a visible tab without focus (another window in front) marks nothing either", async () => {
    const r = rig({ visible: true, focused: false });
    r.marker.consider("c1", "m5");
    await settle();
    expect(r.post).not.toHaveBeenCalled();
    r.state.focused = true;
    r.marker.resume();
    await settle();
    expect(r.post).toHaveBeenCalledTimes(1);
  });
});

describe("C1.8: only when the newest read message changed", () => {
  it("the same newest message again (a refetch, a reaction, a re-render) sends nothing; a newer one sends one request", async () => {
    const r = rig();
    r.marker.consider("c1", "m5");
    await settle();
    r.marker.consider("c1", "m5");
    r.marker.consider("c1", "m5");
    await settle();
    expect(r.post).toHaveBeenCalledTimes(1);
    r.marker.consider("c1", "m6");
    await settle();
    expect(r.post.mock.calls).toEqual([["c1", "m5"], ["c1", "m6"]]);
    expect(r.onMarked).toHaveBeenCalledTimes(2);
  });

  it("two considerations of the same message while the first request is in flight make one request", async () => {
    let finish: (v: boolean) => void = () => undefined;
    const r = rig(undefined, () => new Promise<boolean>((res) => (finish = res)));
    r.marker.consider("c1", "m5");
    r.marker.consider("c1", "m5");
    expect(r.post).toHaveBeenCalledTimes(1);
    finish(true);
    await settle();
    expect(r.post).toHaveBeenCalledTimes(1);
  });

  it("each conversation has its own «last marked»", async () => {
    const r = rig();
    r.marker.consider("c1", "m5");
    r.marker.consider("c2", "m5");
    await settle();
    expect(r.post.mock.calls).toEqual([["c1", "m5"], ["c2", "m5"]]);
  });

  it("a request that failed is tried again by the next consideration of the same message", async () => {
    let ok = false;
    const r = rig(undefined, async () => ok);
    r.marker.consider("c1", "m5");
    await settle();
    expect(r.onMarked).not.toHaveBeenCalled();
    ok = true;
    r.marker.consider("c1", "m5");
    await settle();
    expect(r.post).toHaveBeenCalledTimes(2);
    expect(r.onMarked).toHaveBeenCalledTimes(1);
  });

  it("a request that throws is a failed request, never an unhandled rejection", async () => {
    const r = rig(undefined, async () => {
      throw new Error("network");
    });
    r.marker.consider("c1", "m5");
    await settle();
    expect(r.onMarked).not.toHaveBeenCalled();
  });
});

describe("C1.8: what is never marked", () => {
  it("the prefix that means «pending» is the cache's own", () => {
    expect(PENDING_ID_PREFIX_FOR_READS).toBe(PENDING_ID_PREFIX);
  });

  it("a pending message (an id the server has never seen) or an empty conversation", async () => {
    const r = rig();
    r.marker.consider("c1", "pending:k1");
    r.marker.consider("c1", null);
    await settle();
    expect(r.post).not.toHaveBeenCalled();
  });

  it("the owner's silent oversight: no request at all, not even later", async () => {
    const r = rig();
    r.marker.consider("c1", "m5", { silent: true });
    r.marker.resume();
    await settle();
    expect(r.post).not.toHaveBeenCalled();
  });

  it("older messages shown around a search hit (the newest are not on screen): no request, and nothing waits", async () => {
    const r = rig({ visible: false, focused: true });
    r.marker.consider("c1", "m2", { anchored: true });
    r.state.visible = true;
    r.marker.resume();
    await settle();
    expect(r.post).not.toHaveBeenCalled();
  });

  it("a mark that failed waits for the next return to the tab, and goes then", async () => {
    let ok = false;
    const r = rig(undefined, async () => ok);
    r.marker.consider("c1", "m5");
    await settle();
    expect(r.onMarked).not.toHaveBeenCalled();
    ok = true;
    r.marker.resume();
    await settle();
    expect(r.post).toHaveBeenCalledTimes(2);
    expect(r.onMarked).toHaveBeenCalledTimes(1);
  });

  it("forget() also forgets what was marked: a screen opened again marks once more (the person may have marked it unread meanwhile)", async () => {
    const r = rig();
    r.marker.consider("c1", "m5");
    await settle();
    r.marker.forget("c1");
    r.marker.consider("c1", "m5");
    await settle();
    expect(r.post).toHaveBeenCalledTimes(2);
  });

  it("forget() drops what waited (the screen was closed)", async () => {
    const r = rig({ visible: false, focused: true });
    r.marker.consider("c1", "m5");
    r.marker.forget("c1");
    r.state.visible = true;
    r.marker.resume();
    await settle();
    expect(r.post).not.toHaveBeenCalled();
  });
});
