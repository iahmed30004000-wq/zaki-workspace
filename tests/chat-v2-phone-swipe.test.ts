import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachEdgeSwipe, type SwipeBox } from "@/lib/chat/v2/phone/edge-swipe-controller";

/**
 * C2.8 — the swipe from the start edge, driven end to end with a plain event target standing in for the screen's box: the real controller, the real rules,
 * no browser. (A finger on a real phone is the owner's check; this proves the logic: where a swipe may begin, what it follows, when it goes back.)
 */
class FakeBox extends EventTarget {
  style = { transform: "", transition: "" };
  captured: number[] = [];
  released: number[] = [];
  setPointerCapture(id: number) {
    this.captured.push(id);
  }
  releasePointerCapture(id: number) {
    this.released.push(id);
  }
  fire(type: string, fields: Partial<{ pointerId: number; pointerType: string; isPrimary: boolean; clientX: number; clientY: number; timeStamp: number }>) {
    const event = new Event(type);
    // `timeStamp` is a getter on a real event: define the pointer's fields on the instance
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 0, clientY: 300, timeStamp: 0, ...fields })) Object.defineProperty(event, key, { value });
    this.dispatchEvent(event);
  }
}

const WIDTH = 375;
function setup(over: { rtl?: boolean; reduced?: boolean } = {}) {
  const box = new FakeBox();
  const onBack = vi.fn();
  const detach = attachEdgeSwipe(box as unknown as SwipeBox, { rtl: () => over.rtl ?? true, width: () => WIDTH, reducedMotion: () => over.reduced ?? false, onBack });
  return { box, onBack, detach };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a swipe from the start edge (the right edge, right to left)", () => {
  it("begins at the edge, follows the finger toward the end (leftwards), and goes back when it was pulled far enough", () => {
    const { box, onBack } = setup();
    box.fire("pointerdown", { clientX: 372, timeStamp: 0 });
    box.fire("pointermove", { clientX: 340, clientY: 303, timeStamp: 40 });
    expect(box.captured).toEqual([1]);
    expect(box.style.transition).toBe("none");
    expect(box.style.transform).toBe("translateX(-32px)");
    box.fire("pointermove", { clientX: 280, clientY: 306, timeStamp: 120 });
    expect(box.style.transform).toBe("translateX(-92px)");
    box.fire("pointerup", { clientX: 280, clientY: 306, timeStamp: 130 });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(box.released).toEqual([1]);
    // the screen is hidden by the route change: nothing is left on the box
    expect(box.style.transform).toBe("");
    expect(box.style.transition).toBe("");
  });

  it("in a left-to-right page the same swipe starts at the LEFT edge and goes rightwards", () => {
    const { box, onBack } = setup({ rtl: false });
    box.fire("pointerdown", { clientX: 3 });
    box.fire("pointermove", { clientX: 40, clientY: 302, timeStamp: 30 });
    expect(box.style.transform).toBe("translateX(37px)");
    box.fire("pointermove", { clientX: 100, clientY: 304, timeStamp: 90 });
    box.fire("pointerup", { clientX: 100, clientY: 304, timeStamp: 100 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a short slow pull slides back to where it was in 200 ms and does NOT go back", () => {
    const { box, onBack } = setup();
    box.fire("pointerdown", { clientX: 372, timeStamp: 0 });
    box.fire("pointermove", { clientX: 340, clientY: 301, timeStamp: 300 });
    box.fire("pointerup", { clientX: 340, clientY: 301, timeStamp: 900 });
    expect(onBack).not.toHaveBeenCalled();
    expect(box.style.transition).toBe("transform 200ms ease-out");
    expect(box.style.transform).toBe("");
    vi.advanceTimersByTime(300);
    expect(box.style.transition).toBe("");
  });

  it("a short QUICK flick goes back", () => {
    const { box, onBack } = setup();
    box.fire("pointerdown", { clientX: 372, timeStamp: 0 });
    box.fire("pointermove", { clientX: 334, clientY: 301, timeStamp: 30 });
    box.fire("pointerup", { clientX: 334, clientY: 301, timeStamp: 50 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("under reduced motion the snap-back is instant (no transition at all)", () => {
    const { box } = setup({ reduced: true });
    box.fire("pointerdown", { clientX: 372, timeStamp: 0 });
    box.fire("pointermove", { clientX: 340, clientY: 301, timeStamp: 300 });
    box.fire("pointerup", { clientX: 340, clientY: 301, timeStamp: 900 });
    expect(box.style.transition).toBe("");
    expect(box.style.transform).toBe("");
  });

  it("a cancelled touch (the browser took the gesture) never goes back, however far it had come", () => {
    const { box, onBack } = setup();
    box.fire("pointerdown", { clientX: 372, timeStamp: 0 });
    box.fire("pointermove", { clientX: 250, clientY: 302, timeStamp: 100 });
    box.fire("pointercancel", { clientX: 250, clientY: 302, timeStamp: 110 });
    expect(onBack).not.toHaveBeenCalled();
    expect(box.style.transform).toBe("");
  });
});

describe("what is NOT a swipe back", () => {
  it("a touch that starts anywhere but the start-edge strip (a table or a picture scrolling sideways in the middle)", () => {
    const { box, onBack } = setup();
    box.fire("pointerdown", { clientX: 200, timeStamp: 0 });
    box.fire("pointermove", { clientX: 100, clientY: 301, timeStamp: 50 });
    box.fire("pointerup", { clientX: 100, clientY: 301, timeStamp: 60 });
    expect(onBack).not.toHaveBeenCalled();
    expect(box.captured).toEqual([]);
    expect(box.style.transform).toBe("");
    // the END edge is not the start edge
    box.fire("pointerdown", { clientX: 3, timeStamp: 0 });
    box.fire("pointermove", { clientX: 120, clientY: 301, timeStamp: 50 });
    expect(box.captured).toEqual([]);
  });

  it("a mouse never swipes, and neither does a second finger", () => {
    const { box, onBack } = setup();
    box.fire("pointerdown", { clientX: 372, pointerType: "mouse" });
    box.fire("pointermove", { clientX: 250, clientY: 301, timeStamp: 50, pointerType: "mouse" });
    box.fire("pointerup", { clientX: 250, clientY: 301, timeStamp: 60, pointerType: "mouse" });
    box.fire("pointerdown", { clientX: 372, isPrimary: false });
    box.fire("pointermove", { clientX: 250, clientY: 301, timeStamp: 50, isPrimary: false });
    box.fire("pointerup", { clientX: 250, clientY: 301, timeStamp: 60, isPrimary: false });
    expect(onBack).not.toHaveBeenCalled();
    expect(box.captured).toEqual([]);
  });

  it("a mostly vertical drag is the page's own scroll: it is let go at once and a later sideways wobble does nothing", () => {
    const { box, onBack } = setup();
    box.fire("pointerdown", { clientX: 372, timeStamp: 0 });
    box.fire("pointermove", { clientX: 370, clientY: 360, timeStamp: 40 });
    box.fire("pointermove", { clientX: 250, clientY: 362, timeStamp: 80 });
    box.fire("pointerup", { clientX: 250, clientY: 362, timeStamp: 90 });
    expect(onBack).not.toHaveBeenCalled();
    expect(box.captured).toEqual([]);
    expect(box.style.transform).toBe("");
  });

  it("a drag the wrong way (outward) is nothing, and the screen never moves outward", () => {
    const { box, onBack } = setup();
    box.fire("pointerdown", { clientX: 372, timeStamp: 0 });
    box.fire("pointermove", { clientX: 374, clientY: 300, timeStamp: 40 });
    box.fire("pointerup", { clientX: 374, clientY: 300, timeStamp: 60 });
    expect(onBack).not.toHaveBeenCalled();
    expect(box.style.transform).toBe("");
  });
});

describe("detaching", () => {
  it("removes every listener and leaves the box as it was", () => {
    const { box, onBack, detach } = setup();
    box.fire("pointerdown", { clientX: 372, timeStamp: 0 });
    box.fire("pointermove", { clientX: 300, clientY: 301, timeStamp: 40 });
    detach();
    expect(box.style.transform).toBe("");
    box.fire("pointerdown", { clientX: 372, timeStamp: 0 });
    box.fire("pointermove", { clientX: 250, clientY: 301, timeStamp: 40 });
    box.fire("pointerup", { clientX: 250, clientY: 301, timeStamp: 50 });
    expect(onBack).not.toHaveBeenCalled();
  });
});
