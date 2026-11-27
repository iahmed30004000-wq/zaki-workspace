import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

/**
 * The composer's engine and the microphone, run for real with a stand-in recorder and a stand-in pointer (`tgPhone` on a phone): a short tap records
 * nothing, a hold records after `micHoldMs`, a lift sends, a slide past 40% of the width throws the take away, a slide up (or a touch the browser takes
 * away) locks it. With the phone look off the old hold is the old one: it records the moment the finger lands.
 */
const world = vi.hoisted(() => ({ phone: true, made: [] as { calls: string[] }[], duration: 4000 }));

vi.mock("next/navigation", () => ({ usePathname: () => "/chat/c1", useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/shell/tg-phone", () => ({ useTgPhone: () => world.phone, useTgPhoneOn: () => world.phone }));
vi.mock("@/lib/realtime/use-realtime", () => ({ useTyping: () => ({ notifyTyping: () => {} }) }));
vi.mock("@/lib/chat/upload-with-progress", () => ({ uploadWithProgress: vi.fn(async () => ({ id: "f1" })) }));
vi.mock("@/lib/chat/voice-recorder", () => ({
  VoiceRecorder: class {
    calls: string[] = [];
    constructor() {
      world.made.push(this);
    }
    async start() {
      this.calls.push("start");
    }
    async stop() {
      this.calls.push("stop");
      return { blob: new Blob(["x"]), mime: "audio/webm", durationMs: world.duration, peaks: [1] };
    }
    cancel() {
      this.calls.push("cancel");
    }
  },
}));

import { uploadWithProgress } from "@/lib/chat/upload-with-progress";
import { useComposer, type ComposerEngine } from "@/lib/chat/v2/composer/use-composer";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { I18nProvider } from "@/lib/i18n";
import type { ConversationDto } from "@/server/chat/dto";

const detail = { id: "c1", kind: "TOPIC", title: "t", emoji: null, closed: false, me: { id: "u1", canPost: true, canModerate: false, muted: false, oversight: false, canJoin: false }, members: [], messages: [], readers: [] } as unknown as ConversationDto;

const listeners = new Map<string, Set<(e: unknown) => void>>();
const fire = (type: string, e: Record<string, unknown>) => {
  for (const fn of [...(listeners.get(type) ?? [])]) fn({ pointerId: 1, ...e });
};
const fetched: string[] = [];

function engine(): ComposerEngine {
  let held: ComposerEngine | null = null;
  const Probe = () => {
    held = useComposer({ conversationId: "c1", detail, onMessage: () => {}, reply: null, onCancelReply: () => {}, editing: null, onCancelEdit: () => {}, onEdited: () => {}, outbox: null, restore: null, onRestored: () => {}, optimistic: null });
    return null;
  };
  const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
  const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
  renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Probe))));
  return held!;
}

const released: number[] = [];
const down = (c: ComposerEngine, pointerType = "touch") =>
  c.onMicPointerDown({ pointerType, pointerId: 1, clientX: 40, clientY: 700, preventDefault: () => {}, currentTarget: { releasePointerCapture: (id: number) => released.push(id) } } as never);

beforeEach(() => {
  vi.useFakeTimers();
  world.phone = true;
  world.duration = 4000;
  world.made.length = 0;
  listeners.clear();
  fetched.length = 0;
  released.length = 0;
  vi.mocked(uploadWithProgress).mockClear();
  vi.stubGlobal("window", {
    innerWidth: 400,
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => void listeners.get(type)?.delete(fn),
  });
  vi.stubGlobal("document", { documentElement: { dir: "rtl", getAttribute: () => null, hasAttribute: () => false }, addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(url);
    return new Response(JSON.stringify({ message: { id: "m1" } }), { status: 201 });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a short tap on the microphone", () => {
  it("records nothing at all: no recorder, no upload", async () => {
    const c = engine();
    down(c);
    await vi.advanceTimersByTimeAsync(TG_MOTION.micHoldMs - 20);
    fire("pointerup", { clientX: 40, clientY: 700 });
    // the click that a tap also fires (at once) does not start one either
    c.onMicClick();
    await vi.advanceTimersByTimeAsync(1000);
    expect(world.made).toHaveLength(0);
    expect(uploadWithProgress).not.toHaveBeenCalled();
    expect(listeners.get("pointermove")?.size ?? 0).toBe(0);
  });

  it("a touch the browser takes away before the hold began records nothing", async () => {
    const c = engine();
    down(c);
    fire("pointercancel", {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(world.made).toHaveLength(0);
  });
});

describe("a hold", () => {
  it("starts recording after the delay, lets go of the browser's capture, and sends on lift", async () => {
    const c = engine();
    down(c);
    expect(released).toEqual([1]);
    expect(world.made).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(TG_MOTION.micHoldMs + 10);
    expect(world.made[0]!.calls).toEqual(["start"]);
    fire("pointerup", { clientX: 45, clientY: 700 });
    await vi.advanceTimersByTimeAsync(10);
    expect(world.made[0]!.calls).toEqual(["start", "stop"]);
    expect(uploadWithProgress).toHaveBeenCalledTimes(1);
  });

  it("a slide shorter than 40% of the width keeps recording and tells the bar where the finger is; past it the take is thrown away, never sent", async () => {
    const c = engine();
    down(c);
    await vi.advanceTimersByTimeAsync(TG_MOTION.micHoldMs + 10);
    const moves: number[] = [];
    c.tg!.drag.subscribe(() => moves.push(c.tg!.drag.get().dx));
    // the mic stands at the RIGHT end of its row (his pictures), so the finger goes left to cancel
    fire("pointermove", { clientX: 40 - 150, clientY: 700 });
    expect(world.made[0]!.calls).toEqual(["start"]);
    expect(moves).toEqual([-150]);
    fire("pointermove", { clientX: 40 - 160, clientY: 700 });
    await vi.advanceTimersByTimeAsync(10);
    expect(world.made[0]!.calls).toEqual(["start", "cancel"]);
    fire("pointerup", { clientX: 220, clientY: 700 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(uploadWithProgress).not.toHaveBeenCalled();
    expect(fetched.filter((u) => u.includes("/messages"))).toEqual([]);
  });

  it("a slide up locks: lifting the finger after it sends nothing", async () => {
    const c = engine();
    down(c);
    await vi.advanceTimersByTimeAsync(TG_MOTION.micHoldMs + 10);
    fire("pointermove", { clientX: 42, clientY: 600 });
    fire("pointerup", { clientX: 42, clientY: 600 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(world.made[0]!.calls).toEqual(["start"]);
    expect(uploadWithProgress).not.toHaveBeenCalled();
  });

  it("a touch the browser takes away in the middle of a take does not lose it (it locks)", async () => {
    const c = engine();
    down(c);
    await vi.advanceTimersByTimeAsync(TG_MOTION.micHoldMs + 10);
    fire("pointercancel", {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(world.made[0]!.calls).toEqual(["start"]);
  });
});

describe("with the phone look off the hold is the old one", () => {
  it("records the moment the finger lands, and an 80 px slide cancels", async () => {
    world.phone = false;
    const c = engine();
    expect(c.tg).toBeUndefined();
    down(c);
    await vi.advanceTimersByTimeAsync(1);
    expect(world.made[0]!.calls).toEqual(["start"]);
    fire("pointermove", { clientX: 40 + 90, clientY: 700 });
    await vi.advanceTimersByTimeAsync(1);
    expect(world.made[0]!.calls).toEqual(["start", "cancel"]);
  });

  it("a mouse still has no hold, phone or not", () => {
    const c = engine();
    down(c, "mouse");
    expect(listeners.get("pointerup")?.size ?? 0).toBe(0);
    expect(world.made).toHaveLength(0);
  });
});
