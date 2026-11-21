import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

/**
 * F1.3 — THE SHELL LOADS LESS. `livekit-client` (the calls library, the heaviest thing every signed-in page used to ship) is
 * fetched only when a call starts or rings; the quick chat and the owner's guide are their own chunks. No behaviour changes:
 * a call still rings and still connects.
 */

const calls = vi.hoisted(() => ({
  /** how many times the calls library was evaluated (the mock's factory runs on the first `import()`, never before) */
  loads: 0,
  rooms: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    prepareConnection: ReturnType<typeof vi.fn>;
    localParticipant: { setMicrophoneEnabled: ReturnType<typeof vi.fn>; setCameraEnabled: ReturnType<typeof vi.fn> };
  }>,
  ring: null as null | ((event: { kind: string; callId?: string }) => void),
  api: [] as string[],
}));

vi.mock("livekit-client", () => {
  calls.loads += 1;
  class Room {
    connect = vi.fn(async () => undefined);
    disconnect = vi.fn(async () => undefined);
    prepareConnection = vi.fn(async () => undefined);
    canPlaybackAudio = true;
    state = "connected";
    remoteParticipants = new Map();
    localParticipant = {
      setMicrophoneEnabled: vi.fn(async () => undefined),
      setCameraEnabled: vi.fn(async () => undefined),
      getTrackPublication: () => undefined,
      publishData: vi.fn(async () => undefined),
      isMicrophoneEnabled: true,
      isCameraEnabled: false,
    };
    constructor(public options: unknown) {
      calls.rooms.push(this);
    }
    on() {
      return this;
    }
  }
  const named = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, k]));
  return {
    Room,
    RoomEvent: new Proxy({}, { get: (_t, key) => String(key) }),
    Track: { Source: named("Microphone", "Camera", "ScreenShare", "ScreenShareAudio"), Kind: { Audio: "audio", Video: "video" } },
    ConnectionQuality: named("Excellent", "Good", "Poor", "Lost"),
    VideoPresets: { h720: { resolution: {} }, h180: {}, h360: {} },
    ScreenSharePresets: { h1080fps15: { encoding: {} } },
    AudioPresets: { speech: {} },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("@/lib/realtime/use-realtime", () => ({
  useRealtime: (handler: (event: { kind: string; callId?: string }) => void) => {
    calls.ring = handler;
  },
}));
vi.mock("@/components/calls/push-client", () => ({ ensurePush: async () => undefined }));
vi.mock("@/components/calls/call-api", () => ({
  callErrorText: (key: unknown) => String(key),
  callApi: async (apiPath: string) => {
    calls.api.push(apiPath);
    if (apiPath.endsWith("/token")) return { url: "wss://calls.example.test", token: "pass-1" };
    return { id: "c1", endedAt: null, video: false, title: "", conversationTitle: "", startedBy: { id: "u1", name: "سامر", avatarUrl: null } };
  },
}));

import { CallRing } from "@/components/calls/call-ring";
import { CallProvider, useCall, type CallApi } from "@/components/calls/call-provider";

// what the module graph held the moment the two files above were imported, before any component rendered
const loadsAfterImport = calls.loads;

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function mount(...children: ReactNode[]): CallApi {
  let api: CallApi | null = null;
  function Probe() {
    api = useCall();
    return null;
  }
  renderToStaticMarkup(createElement(CallProvider, null, createElement(Probe), ...children));
  if (!api) throw new Error("the provider gave no api");
  return api;
}

describe("the calls library is loaded when a call starts or rings, not with the page", () => {
  it("importing the call keeper and the ring loads no calls library", () => {
    expect(loadsAfterImport).toBe(0);
  });

  it("drawing the keeper and the ring (every signed-in page does) loads nothing either", () => {
    mount(createElement(CallRing));
    expect(calls.loads).toBe(0);
    expect(calls.rooms).toHaveLength(0);
  });

  it("a call that RINGS still warms its connection: the library arrives with the ring, then the line is prepared", async () => {
    mount(createElement(CallRing));
    expect(calls.ring, "the ring listens to the live line").toBeTypeOf("function");
    calls.ring?.({ kind: "call.ring", callId: "c1" });
    await vi.waitFor(() => expect(calls.rooms.length).toBe(1));
    expect(calls.loads).toBe(1);
    await vi.waitFor(() => expect(calls.rooms[0]?.prepareConnection).toHaveBeenCalledWith("wss://calls.example.test", "pass-1"));
    expect(calls.api).toEqual(expect.arrayContaining(["/api/calls/c1", "/api/calls/c1/token"]));
  });

  it("«ردّ» (join) still connects with the pass and opens the microphone, the camera only for a video call", async () => {
    const api = mount();
    const before = calls.rooms.length;
    await api.join("c1", false);
    const room = calls.rooms[before];
    expect(room, "a room was made").toBeDefined();
    expect(room?.connect).toHaveBeenCalledWith("wss://calls.example.test", "pass-1");
    expect(room?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(room?.localParticipant.setCameraEnabled).not.toHaveBeenCalled();

    const next = calls.rooms.length;
    await mount().join("c2", true);
    expect(calls.rooms[next]?.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
  });

  it("a joiner of a topic's call enters muted: with `mic: false` neither the microphone nor the camera is opened", async () => {
    const before = calls.rooms.length;
    await mount().join("c3", true, { mic: false });
    const room = calls.rooms[before];
    expect(room, "a room was made").toBeDefined();
    expect(room?.connect).toHaveBeenCalled();
    expect(room?.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(room?.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  });

  it("the library is evaluated once: a second call reuses it", () => {
    expect(calls.loads).toBe(1);
  });
});

// ─────────────────────────────── what the page ships ───────────────────────────────

/** The files a file loads at once: static `import … from` and `export … from`, never `import type`, never `import()`. */
function staticImports(file: string): string[] {
  const text = code(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)) out.push(m[1] as string);
  return out;
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Everything a page loads at once, starting from one file. Returns the files and the packages they import. */
function reach(entry: string): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const todo = [entry];
  while (todo.length > 0) {
    const file = todo.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of staticImports(file)) {
      const next = resolve(file, spec);
      if (next) todo.push(next);
      else if (!spec.startsWith(".") && !spec.startsWith("@/")) packages.set(spec, path.relative(ROOT, file).replace(/\\/g, "/"));
    }
  }
  return { files, packages };
}

describe("what every signed-in page loads at once", () => {
  const layout = path.join(SRC, "app", "(app)", "layout.tsx");
  const { files, packages } = reach(layout);
  const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

  it("the walk really walks (the layout reaches the shell, the keeper and the ring)", () => {
    const names = [...files].map(rel);
    for (const name of ["src/components/app-shell.tsx", "src/components/calls/call-provider.tsx", "src/components/calls/call-ring.tsx", "src/components/shell/sidebar.tsx"]) {
      expect(names, name).toContain(name);
    }
  });

  it("livekit-client is not among it (and neither is the calls screen's picture code that imports it)", () => {
    expect([...packages.keys()].filter((p) => p === "livekit-client"), `imported statically by ${packages.get("livekit-client")}`).toEqual([]);
    const names = [...files].map(rel);
    expect(names).not.toContain("src/components/calls/call-media.tsx");
    expect(names).not.toContain("src/components/calls/call-room.tsx");
  });

  it("the quick chat and the guide are not among it", () => {
    const names = [...files].map(rel);
    expect(names).not.toContain("src/components/shell/quick-chat.tsx");
    expect(names).not.toContain("src/components/site-guide/site-guide.tsx");
  });

  it("what must be there at the first paint still is: the people row and the places", () => {
    const names = [...files].map(rel);
    for (const name of ["src/components/shell/people-dock.tsx", "src/components/shell/bottom-nav.tsx", "src/components/shell/top-bar.tsx"]) {
      expect(names, name).toContain(name);
    }
  });
});

describe("the shell's own source", () => {
  const shell = code(read("src", "components", "app-shell.tsx"));
  const keeper = code(read("src", "components", "calls", "call-provider.tsx"));

  it("QuickChat and SiteGuide come through next/dynamic, client only, drawing nothing while they load", () => {
    expect(shell).toContain('import dynamic from "next/dynamic"');
    expect(shell).not.toMatch(/import\s*\{[^}]*\bQuickChat\b[^}]*\}\s*from/);
    expect(shell).not.toMatch(/import\s*\{[^}]*\bSiteGuide\b[^}]*\}\s*from/);
    expect(shell).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\("@\/components\/shell\/quick-chat"\)[\s\S]*?ssr:\s*false/);
    expect(shell).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\("@\/components\/site-guide\/site-guide"\)[\s\S]*?ssr:\s*false/);
  });

  it("the guide's chunk is asked for only by somebody who has the guide; the quick chat's only by somebody who may have it", () => {
    expect(shell).toContain("{!isGuest && siteGuide ? <SiteGuide enabled={!isGuest && siteGuide} /> : null}");
    expect(shell).toContain('{!isGuest && quickChat ? <QuickChat enabled={!isGuest && quickChat && place?.key !== "chat"} /> : null}');
  });

  it("the people row stays in the first paint, and «مظهر المفتاح»'s provider stays a plain provider (its effect code is already lazy)", () => {
    expect(shell).toMatch(/import \{ PeopleDock \} from/);
    expect(shell).toMatch(/import \{ SwitchFxProvider \} from/);
    const toggle = code(read("src", "components", "theme", "theme-switch.tsx"));
    expect(toggle).toMatch(/dynamic\(\(\) => import\("\.\/switch-fx\/fx-control"\)/);
    expect(toggle).toMatch(/dynamic\(\(\) => import\("\.\/switch-fx\/plain-scrub"\)/);
    expect(read("src", "components", "theme", "switch-fx-provider.tsx")).not.toMatch(/from "\.\/switch-fx\/(fx-control|plain-scrub)"/);
  });

  it("the keeper imports livekit-client for its types only and loads the library and the picture code with import()", () => {
    expect(keeper).not.toMatch(/^\s*import\s+(?!type\b)[^;]*from\s+["']livekit-client["']/m);
    expect(keeper).not.toMatch(/^\s*import\s+(?!type\b)[^;]*from\s+["']\.\/call-media["']/m);
    expect(keeper).toContain('import("livekit-client")');
    expect(keeper).toContain('import("./call-media")');
  });
});
