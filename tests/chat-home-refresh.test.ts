import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { debounced } from "@/lib/chat/debounce";

/**
 * F0.6 — the chat list does not storm. It used to refetch the whole home on EVERY message event of the company (no debounce, no
 * abort): a busy minute meant dozens of overlapping requests, the slowest one winning. Now a burst of events is one refetch,
 * 300 ms after the last, and a newer request aborts the one still in flight.
 */
afterEach(() => vi.useRealTimers());

describe("debounced()", () => {
  it("turns a burst into ONE call, 300 ms after the last event", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounced(fn, 300);
    for (let i = 0; i < 20; i++) {
      d.call();
      vi.advanceTimersByTime(100);
    }
    expect(fn).not.toHaveBeenCalled();
    // 100 ms have passed since the last call already
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel() drops a pending call (the screen was left)", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounced(fn, 300);
    d.call();
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("the chat list screen", () => {
  const src = readFileSync(join(process.cwd(), "src/components/chat/home/chat-home-client.tsx"), "utf8");
  it("debounces its refresh and aborts the request it replaces", () => {
    expect(src).toContain("debounced(");
    expect(src).toContain("300");
    expect(src).toContain("new AbortController()");
    expect(src).toMatch(/signal:\s*\w*\.?signal|signal,/);
    expect(src).toContain(".abort()");
  });
});
