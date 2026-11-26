import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WHEEL_PREFS } from "@/lib/nav/tab-wheel";
import { useWheel } from "@/components/shell/place-tabs";

/**
 * The wheel changes the page only after the PERSON moved it. On a phone a page that has no tab of its own (a task, the time report) opened
 * itself away: the strip snaps when it first appears, that is a scroll nobody made, and the wheel answered it by opening the tab in the middle.
 *
 * `useWheel` is run as it is, with no browser: React's two hooks it uses are run on the spot, and the strip is a bare event target whose tabs
 * report where they are, so a test scrolls it by moving them.
 */
const cleanups: (() => void)[] = [];
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    useRef: (value: unknown) => ({ current: value }),
    useEffect: (run: () => void | (() => void)) => {
      const cleanup = run();
      if (cleanup) cleanups.push(cleanup);
    },
  };
});

const TABS = [
  { key: "my-work", href: "/my-work" },
  { key: "projects", href: "/projects" },
  { key: "goals", href: "/goals" },
];
const WIDTH = 300;
const STEP = 100;

const event = (type: string, props: Record<string, unknown> = {}) => Object.assign(new Event(type), props);

function strip(current: string | null, startAt = 0) {
  let offset = startAt * STEP;
  const nodes = TABS.map((_, i) => ({
    offsetWidth: STEP - 8,
    style: { opacity: "", transform: "" },
    setAttribute: () => {},
    removeAttribute: () => {},
    // the first tab starts in the middle of the strip; moving the strip brings the next ones there
    getBoundingClientRect: () => ({ left: WIDTH / 2 - STEP / 2 + i * STEP - offset, width: STEP }),
  }));
  const el = Object.assign(new EventTarget(), {
    querySelectorAll: () => nodes,
    getBoundingClientRect: () => ({ left: 0, width: WIDTH }),
  });
  const open = vi.fn<(href: string) => void>();
  useWheel({ current: el as unknown as HTMLUListElement }, true, { ...DEFAULT_WHEEL_PREFS, sound: false }, TABS, current, open);

  const fire = (type: string, props?: Record<string, unknown>) => el.dispatchEvent(event(type, props));
  /** The strip moves so that tab `i` is in the middle: one `scroll`, whoever caused it. */
  const scrollTo = (i: number) => {
    offset = i * STEP;
    fire("scroll");
  };
  const rest = (ms = 1000) => vi.advanceTimersByTime(ms);
  /** A finger on the strip that travels sideways, as the browser reports it. */
  const touch = {
    down: () => fire("touchstart", { touches: [{ clientX: 200, clientY: 20 }] }),
    move: (dx: number, dy = 0) => fire("touchmove", { touches: [{ clientX: 200 + dx, clientY: 20 + dy }] }),
    up: () => fire("touchend", { touches: [] }),
  };
  return { open, fire, scrollTo, rest, touch };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    }),
  );
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => setTimeout(run, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a scroll the person did not make never changes the page", () => {
  it("a page with no tab of its own (a task, the time report) stays when the strip snaps by itself as it appears", () => {
    const wheel = strip(null);
    wheel.scrollTo(0);
    wheel.rest();
    expect(wheel.open).not.toHaveBeenCalled();
  });

  it("nor does a page that has a tab, when the browser moves the strip (a turned phone, a late font)", () => {
    const wheel = strip("projects", 1);
    wheel.scrollTo(2);
    wheel.rest();
    expect(wheel.open).not.toHaveBeenCalled();
  });

  it("a tap is not a move: the tapped tab's own link opens it, and the glide to the middle opens nothing more", () => {
    const wheel = strip(null);
    wheel.touch.down();
    wheel.touch.move(2);
    wheel.touch.up();
    wheel.scrollTo(1);
    wheel.rest();
    expect(wheel.open).not.toHaveBeenCalled();
  });

  it("a finger that scrolls the PAGE up or down over the strip has not moved the wheel", () => {
    const wheel = strip(null);
    wheel.touch.down();
    wheel.touch.move(8, -90);
    wheel.touch.up();
    wheel.rest();
    wheel.scrollTo(0);
    wheel.rest();
    expect(wheel.open).not.toHaveBeenCalled();
  });

  it("pressing the mouse without dragging it, and keys that do not move a strip, are not moves", () => {
    const wheel = strip(null);
    wheel.fire("pointerdown", { pointerType: "mouse", button: 0, clientX: 200 });
    window.dispatchEvent(event("pointerup", { pointerType: "mouse" }));
    window.dispatchEvent(event("pointermove", { pointerType: "mouse", clientX: 40 }));
    wheel.fire("keydown", { key: "Tab" });
    wheel.scrollTo(1);
    wheel.rest();
    expect(wheel.open).not.toHaveBeenCalled();
  });

  it("a move is spent once it is answered: a later scroll by the browser opens nothing", () => {
    const wheel = strip("my-work");
    wheel.touch.down();
    wheel.touch.move(-120);
    wheel.scrollTo(1);
    wheel.touch.up();
    wheel.rest();
    expect(wheel.open.mock.calls).toEqual([["/projects"]]);
    wheel.scrollTo(2);
    wheel.rest();
    expect(wheel.open.mock.calls).toEqual([["/projects"]]);
  });

  it("a move that scrolled nothing (a pull at the strip's end) is forgotten too", () => {
    const wheel = strip(null);
    wheel.touch.down();
    wheel.touch.move(80);
    wheel.touch.up();
    wheel.rest();
    wheel.scrollTo(0);
    wheel.rest();
    expect(wheel.open).not.toHaveBeenCalled();
  });
});

describe("the wheel still turns like the alarm's picker when the person turns it", () => {
  it("a swipe: the page goes to the tab that stops in the middle, once, after the strip rests", () => {
    const wheel = strip("my-work");
    wheel.touch.down();
    wheel.touch.move(-40);
    wheel.scrollTo(1);
    wheel.rest(60);
    wheel.touch.up();
    wheel.scrollTo(2);
    expect(wheel.open).not.toHaveBeenCalled();
    wheel.rest();
    expect(wheel.open.mock.calls).toEqual([["/goals"]]);
  });

  it("on a page with no tab of its own too, even back to the first tab", () => {
    const wheel = strip(null);
    wheel.touch.down();
    wheel.touch.move(-40);
    wheel.scrollTo(1);
    wheel.scrollTo(0);
    wheel.touch.up();
    wheel.rest();
    expect(wheel.open.mock.calls).toEqual([["/my-work"]]);
  });

  it("a finger that pauses on the strip and then lets go: the snap after letting go still counts", () => {
    const wheel = strip("my-work");
    wheel.touch.down();
    wheel.touch.move(-60);
    wheel.scrollTo(0);
    wheel.rest(600);
    expect(wheel.open).not.toHaveBeenCalled();
    wheel.touch.up();
    wheel.scrollTo(1);
    wheel.rest();
    expect(wheel.open.mock.calls).toEqual([["/projects"]]);
  });

  it("a mouse wheel over the strip, a dragged mouse and the arrow keys are the person's moves too", () => {
    const turns: ((w: ReturnType<typeof strip>) => void)[] = [
      (w) => w.fire("wheel", { deltaX: 0, deltaY: 100, ctrlKey: false }),
      (w) => {
        w.fire("pointerdown", { pointerType: "mouse", button: 0, clientX: 200 });
        window.dispatchEvent(event("pointermove", { pointerType: "mouse", clientX: 90 }));
      },
      (w) => w.fire("keydown", { key: "ArrowLeft" }),
    ];
    for (const turn of turns) {
      const wheel = strip(null);
      turn(wheel);
      wheel.scrollTo(1);
      window.dispatchEvent(event("pointerup", { pointerType: "mouse" }));
      wheel.rest();
      expect(wheel.open.mock.calls).toEqual([["/projects"]]);
    }
  });

  it("zooming the page with the mouse wheel is not a turn", () => {
    const wheel = strip(null);
    wheel.fire("wheel", { deltaX: 0, deltaY: 100, ctrlKey: true });
    wheel.scrollTo(1);
    wheel.rest();
    expect(wheel.open).not.toHaveBeenCalled();
  });
});
