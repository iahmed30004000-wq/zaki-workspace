import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const played = vi.hoisted(() => [] as { tone: string; volume: number; mention: boolean }[]);
vi.mock("@/lib/chat/chime/player", () => ({
  playChime: (o: { tone: string; volume: number; mention: boolean }) => {
    played.push(o);
    return true;
  },
  primeChime: () => undefined,
}));
vi.mock("@/lib/realtime/use-realtime", () => ({ subscribeRealtime: () => () => undefined }));

import { onFrame } from "@/components/chat/chime/chat-sounds-host";
import { CHAT_SOUND_KEY } from "@/lib/chat/chime/prefs";
import { SOUNDS_KEY } from "@/lib/chat/sounds";

/**
 * S5.1 — the listener end to end with a fake line and a fake server: which frames make a sound.
 */

type Conv = { kind: string; muted?: boolean; oversight?: boolean };
type Msg = { id: string; mine?: boolean; silent?: boolean; kind?: string; mentions?: string[]; ageMs?: number };

let store: Map<string, string>;
let pathname: string;
let visibility: string;
let convs: Record<string, Conv>;
let messages: Record<string, Msg[]>;
let calls: string[];

beforeEach(() => {
  played.length = 0;
  store = new Map();
  pathname = "/tasks";
  visibility = "visible";
  convs = {};
  messages = {};
  calls = [];
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal("window", { location: { get pathname() { return pathname; } }, localStorage });
  vi.stubGlobal("document", { get visibilityState() { return visibility; } });
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url === "/api/me") return json({ user: { id: "me" } });
    const header = /\/api\/chat\/conversations\/([^/]+)\/header$/.exec(url);
    if (header) {
      const c = convs[header[1]!]!;
      return json({ id: header[1], kind: c.kind, me: { muted: c.muted === true, oversight: c.oversight === true } });
    }
    const page = /\/api\/chat\/conversations\/([^/]+)\/messages\?limit=8$/.exec(url);
    if (page) {
      const list = (messages[page[1]!] ?? []).map((m) => ({
        id: m.id,
        kind: m.kind ?? "TEXT",
        body: "x",
        deleted: false,
        mine: m.mine === true,
        silent: m.silent === true ? true : undefined,
        mentions: m.mentions ?? [],
        createdAt: new Date(Date.now() - (m.ageMs ?? 0)).toISOString(),
      }));
      return json({ messages: list, hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [] });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
});
afterEach(() => vi.unstubAllGlobals());

let n = 0;
async function arrives(conv: string, msg: Msg): Promise<void> {
  const id = msg.id + "-" + ++n;
  messages[conv] = [{ ...msg, id }];
  await onFrame({ kind: "message.created", conversationId: conv, messageId: id });
}

describe("which frames make a sound (the owner: «بالسايات»)", () => {
  it("a message in a conversation that is NOT the open one sounds, with the chosen tone and volume", async () => {
    store.set(CHAT_SOUND_KEY, JSON.stringify({ tone: "bell", volume: 0.8 }));
    convs.c1 = { kind: "TOPIC" };
    pathname = "/chat/other";
    await arrives("c1", { id: "m" });
    expect(played).toEqual([{ tone: "bell", volume: 0.8, mention: false }]);
  });

  it("every private message sounds", async () => {
    convs.d1 = { kind: "DM" };
    await arrives("d1", { id: "m" });
    expect(played).toHaveLength(1);
  });

  it("not my own message, not a muted chat (a mention included), not «بدون صوت», not a system line", async () => {
    convs.c1 = { kind: "TOPIC" };
    await arrives("c1", { id: "a", mine: true });
    convs.c2 = { kind: "TOPIC", muted: true };
    await arrives("c2", { id: "b", mentions: ["me"] });
    await arrives("c1", { id: "c", silent: true });
    await arrives("c1", { id: "d", kind: "SYSTEM" });
    expect(played).toEqual([]);
  });

  it("not while the tab is hidden (the push is shown), and no request is made for it", async () => {
    convs.c1 = { kind: "TOPIC" };
    visibility = "hidden";
    await arrives("c1", { id: "m" });
    expect(played).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("not for the conversation that is open (it makes its own arrival sound)", async () => {
    convs.c1 = { kind: "TOPIC" };
    pathname = "/chat/c1";
    await arrives("c1", { id: "m" });
    expect(played).toEqual([]);
  });

  it("not with the master switch «أصوات الدردشة» off", async () => {
    convs.c1 = { kind: "TOPIC" };
    store.set(SOUNDS_KEY, "off");
    await arrives("c1", { id: "m" });
    expect(played).toEqual([]);
  });

  it("a topic on «الذكر بس» is silent except for a mention, which sounds as a mention; «@الكل» counts", async () => {
    convs.t1 = { kind: "TOPIC" };
    store.set(CHAT_SOUND_KEY, JSON.stringify({ topics: { t1: "mentions" } }));
    await arrives("t1", { id: "a" });
    expect(played).toEqual([]);
    await arrives("t1", { id: "b", mentions: ["me"] });
    expect(played).toHaveLength(1);
    expect(played[0]?.mention).toBe(true);
    await arrives("t1", { id: "c", mentions: ["*"] });
    expect(played).toHaveLength(2);
  });

  it("a private chat ignores the topic choice", async () => {
    convs.d1 = { kind: "DM" };
    store.set(CHAT_SOUND_KEY, JSON.stringify({ topics: { d1: "mentions" } }));
    await arrives("d1", { id: "m" });
    expect(played).toHaveLength(1);
  });

  it("an old message (a replay after a reconnect) and a synthetic frame make no sound", async () => {
    convs.c1 = { kind: "TOPIC" };
    await arrives("c1", { id: "old", ageMs: 120_000 });
    await onFrame({ kind: "message.created", conversationId: "c1", messageId: "x", synthetic: true });
    expect(played).toEqual([]);
  });

  it("the same message heard twice sounds once", async () => {
    convs.c1 = { kind: "TOPIC" };
    messages.c1 = [{ id: "same" }];
    await onFrame({ kind: "message.created", conversationId: "c1", messageId: "same" });
    await onFrame({ kind: "message.created", conversationId: "c1", messageId: "same" });
    expect(played).toHaveLength(1);
  });
});
