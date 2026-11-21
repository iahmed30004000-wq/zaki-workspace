import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { conversationOfUrl } from "@/lib/pwa/notifications";

/**
 * M1a — the service worker (`public/sw.js`), run for real in a sandbox with an in-memory `caches`, a scripted `fetch` and a recording `registration`. It
 * must (1) never touch `/api/` or a non-GET or another site, (2) send a page navigation to the network and only on a network failure show the offline page,
 * never storing any page's HTML, (3) serve the build's hashed files cache-first from a cache named after the build and delete the caches of older builds,
 * (4) show a chat message as ONE notification per conversation (tag = the conversation's id, renotify, the last lines stacked), and (5) keep what it did before:
 * a ring, a note of another kind, the click.
 */

const ORIGIN = "https://zaki.test";
const SOURCE = readFileSync(path.resolve(__dirname, "..", "public", "sw.js"), "utf8");

type Handler = (event: Record<string, unknown>) => void;

interface FakeResponse {
  ok: boolean;
  type: string;
  redirected: boolean;
  body: string;
  url?: string;
  clone(): FakeResponse;
  text(): Promise<string>;
}
const reply = (body: string, extra: Partial<FakeResponse> = {}): FakeResponse => {
  const res: FakeResponse = { ok: true, type: "basic", redirected: false, body, clone: () => ({ ...res }), text: async () => body, ...extra };
  return res;
};

function world(opts: { network?: (url: string) => FakeResponse | Promise<FakeResponse> } = {}) {
  const handlers: Record<string, Handler[]> = {};
  const stores = new Map<string, Map<string, FakeResponse>>();
  const hrefOf = (input: unknown): string => new URL(typeof input === "string" ? input : (input as { url: string }).url, ORIGIN).href;
  const cacheNamed = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (input: unknown) => store.get(hrefOf(input)),
      put: async (input: unknown, res: FakeResponse) => void store.set(hrefOf(input), res),
    };
  };
  const caches = {
    open: async (name: string) => cacheNamed(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (input: unknown) => {
      for (const store of stores.values()) {
        const hit = store.get(hrefOf(input));
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const fetched: string[] = [];
  const network = opts.network ?? ((url: string) => reply(`network:${url}`));
  const fetchFn = async (input: unknown) => {
    const url = hrefOf(input);
    fetched.push(url);
    return network(url);
  };
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const windows: { url: string; visibilityState: string; focus: () => Promise<void>; navigate: (url: string) => Promise<void>; navigated: string[] }[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => void (handlers[type] = [...(handlers[type] ?? []), fn]),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => windows, openWindow: async (url: string) => void opened.push(url) },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        // a notification with the same tag replaces the one on screen, as the system does
        const at = shown.findIndex((n) => n.options["tag"] === options["tag"]);
        if (at >= 0) shown.splice(at, 1);
        shown.push({ title, options });
      },
      getNotifications: async (filter: { tag?: string } = {}) => shown.filter((n) => !filter.tag || n.options["tag"] === filter.tag).map((n) => ({ tag: n.options["tag"], data: n.options["data"] })),
    },
  };
  const context = vm.createContext({ self, caches, fetch: fetchFn, URL, Response, Promise, console });
  vm.runInContext(SOURCE, context);

  /** Fires an event; `respondWith` and `waitUntil` are recorded, then awaited. */
  async function fire(type: string, event: Record<string, unknown>) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<unknown> | null = null;
    const full = { ...event, waitUntil: (p: Promise<unknown>) => void waits.push(p), respondWith: (p: Promise<unknown>) => void (responded = p) };
    for (const handler of handlers[type] ?? []) handler(full);
    await Promise.all(waits);
    return { responded: responded as Promise<FakeResponse> | null, result: responded ? await (responded as Promise<FakeResponse>).catch((e: unknown) => e) : undefined };
  }
  const get = (url: string, mode = "cors", method = "GET") => fire("fetch", { request: { url: new URL(url, ORIGIN).href, method, mode } });
  const message = (data: unknown, sourceUrl = `${ORIGIN}/chat`) => fire("message", { data, source: { url: sourceUrl } });
  const push = (data: unknown) => fire("push", { data: { json: () => data } });
  return { fire, get, message, push, stores, fetched, shown, opened, windows, context, handlers };
}

const chatNote = (conversation: string, message: string, body: string) => ({
  kind: "note",
  title: "بسام",
  body,
  url: `/go?space=s1&next=${encodeURIComponent(`/chat/${conversation}?m=${message}`)}`,
  tag: `chat_message:/chat/${conversation}?m=${message}`,
});

describe("what the worker never touches", () => {
  it("answers no /api/ request at all, for any method, and no page of another site", async () => {
    const w = world();
    for (const url of ["/api/chat/list", "/api/chat/sync?after=1", "/api"]) {
      expect((await w.get(url)).responded, url).toBeNull();
      expect((await w.get(url, "navigate")).responded, `${url} as a navigation`).toBeNull();
    }
    expect((await w.get("/_next/static/chunks/a.js", "cors", "POST")).responded).toBeNull();
    expect((await w.get("https://other.test/_next/static/chunks/a.js")).responded).toBeNull();
    expect(w.fetched).toEqual([]);
  });

  it("leaves the router's own data requests and every other file alone", async () => {
    const w = world();
    for (const url of ["/chat?_rsc=abc", "/chat/c1?_rsc=zz", "/sounds/ring.mp3", "/brand/logo.svg", "/manifest.webmanifest", "/sw.js"]) expect((await w.get(url)).responded, url).toBeNull();
  });
});

describe("a page: the network first, the offline page only without a network, no page stored", () => {
  it("a page answers from the network and nothing of it is stored anywhere", async () => {
    const w = world();
    const { result } = await w.get("/chat", "navigate");
    expect((result as FakeResponse).body).toBe(`network:${ORIGIN}/chat`);
    expect(w.stores.size).toBe(0);
  });

  it("with no network it shows the offline page the shell cache holds", async () => {
    let online = true;
    const w = world({ network: (url) => (online || url.endsWith("/offline") ? reply(`<html>${url}</html>`) : (() => { throw new TypeError("offline"); })()) });
    await w.message({ type: "zaki-shell", build: "abc12345", files: [] });
    online = false;
    const { result } = await w.get("/chat/c1", "navigate");
    expect((result as FakeResponse).body).toBe(`<html>${ORIGIN}/offline</html>`);
  });

  it("with no network and no offline page cached yet (the person went offline at once, or their session had ended when it was fetched) the worker's own small page says the same sentence", async () => {
    const w = world({ network: () => { throw new TypeError("offline"); } });
    const { result } = await w.get("/chat", "navigate");
    const html = await (result as Response).text();
    expect(html).toContain("ما في نت — الرسائل اللي بتكتبها رح تنبعت لما يرجع");
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe("the shell: a cache named after the build, the build's hashed files cache-first", () => {
  it("fills «zaki-shell-<build>» with the offline page and the files the page loaded, and nothing else", async () => {
    const w = world();
    await w.message({ type: "zaki-shell", build: "abc12345", files: ["/_next/static/chunks/main-app-abc12345.js", "/fonts/reem-kufi-var.woff2", "/icons/icon-192.png", "/api/chat/list", "/chat", "https://x.test/_next/static/a.js"] });
    const kept = [...w.stores.get("zaki-shell-abc12345")!.keys()].map((href) => new URL(href).pathname).sort();
    expect(kept).toEqual(["/_next/static/chunks/main-app-abc12345.js", "/fonts/reem-kufi-var.woff2", "/icons/icon-192.png", "/offline"]);
    expect(w.fetched.some((url) => url.includes("/api/") || url.endsWith("/chat"))).toBe(false);
  });

  it("a newer build deletes the caches of the older ones; the current one is remembered", async () => {
    const w = world();
    await w.message({ type: "zaki-shell", build: "aaaa1111", files: ["/_next/static/chunks/a.js"] });
    await w.message({ type: "zaki-shell", build: "bbbb2222", files: ["/_next/static/chunks/b.js"] });
    expect([...w.stores.keys()].filter((name) => name.startsWith("zaki-shell-"))).toEqual(["zaki-shell-bbbb2222"]);
    expect(w.stores.has("zaki-meta")).toBe(true);
  });

  it("refuses a build id that is not a plain token, a message from another site, and other message types", async () => {
    const w = world();
    await w.message({ type: "zaki-shell", build: "../evil", files: [] });
    await w.message({ type: "zaki-shell", build: "x", files: [] });
    await w.message({ type: "zaki-shell", build: "abc12345", files: [] }, "https://evil.test/");
    await w.message({ type: "something-else", build: "abc12345", files: [] });
    expect(w.stores.size).toBe(0);
  });

  it("does not keep an offline page that was a redirect to the sign-in (a signed-out visit)", async () => {
    const w = world({ network: (url) => reply(`login for ${url}`, { redirected: true }) });
    await w.message({ type: "zaki-shell", build: "abc12345", files: ["/_next/static/chunks/a.js"] });
    expect(w.stores.get("zaki-shell-abc12345")!.size).toBe(0);
  });

  it("serves a hashed file from the cache without asking the network, and keeps one the network gave for next time", async () => {
    const w = world();
    await w.message({ type: "zaki-shell", build: "abc12345", files: ["/_next/static/chunks/a.js"] });
    w.fetched.length = 0;
    const hit = await w.get("/_next/static/chunks/a.js");
    expect((hit.result as FakeResponse).body).toBe(`network:${ORIGIN}/_next/static/chunks/a.js`);
    expect(w.fetched).toEqual([]);
    const fresh = await w.get("/_next/static/chunks/new.js");
    expect(w.fetched).toEqual([`${ORIGIN}/_next/static/chunks/new.js`]);
    expect((fresh.result as FakeResponse).body).toContain("new.js");
    expect([...w.stores.get("zaki-shell-abc12345")!.keys()].some((href) => href.endsWith("/chunks/new.js"))).toBe(true);
  });

  it("without a registered build nothing is stored, but the file still comes from the network", async () => {
    const w = world();
    const { result } = await w.get("/_next/static/chunks/a.js");
    expect((result as FakeResponse).body).toContain("a.js");
    expect([...w.stores.values()].reduce((sum, store) => sum + store.size, 0)).toBe(0);
  });
});

describe("a chat message is one notification per conversation", () => {
  it("the tag is the conversation's id and it alerts again (renotify), whatever the address's wrapping", async () => {
    const w = world();
    await w.push(chatNote("conv-1", "m1", "واحد"));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]!.options["tag"]).toBe("conv-1");
    expect(w.shown[0]!.options["renotify"]).toBe(true);
    expect(w.shown[0]!.title).toBe("بسام");
    expect(w.shown[0]!.options["body"]).toBe("واحد");
  });

  it("the next message replaces it and the last lines stack in the body (five at most)", async () => {
    const w = world();
    for (let i = 1; i <= 7; i++) await w.push(chatNote("conv-1", `m${i}`, `رسالة ${i}`));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]!.options["body"]).toBe(["رسالة 3", "رسالة 4", "رسالة 5", "رسالة 6", "رسالة 7"].join("\n"));
  });

  it("a topic where somebody mentioned me and somebody else replied: each line says who, and the title is the latest sender's", async () => {
    const w = world();
    await w.push({ ...chatNote("conv-1", "m1", "شوف هاد"), title: "أحمد ذكرك" });
    await w.push({ ...chatNote("conv-1", "m2", "تمام"), title: "سارة" });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]!.title).toBe("سارة");
    expect(w.shown[0]!.options["body"]).toBe("أحمد ذكرك: شوف هاد\nسارة: تمام");
  });

  it("a notification the first version of the worker left (bare lines) still stacks", async () => {
    const w = world();
    w.shown.push({ title: "بسام", options: { tag: "conv-1", body: "قديم", data: { url: "/chat/conv-1", lines: ["قديم"] } } });
    await w.push(chatNote("conv-1", "m1", "جديد"));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]!.options["body"]).toBe("قديم\nجديد");
  });

  it("two conversations are two notifications", async () => {
    const w = world();
    await w.push(chatNote("conv-1", "m1", "أ"));
    await w.push(chatNote("conv-2", "m2", "ب"));
    expect(w.shown.map((n) => n.options["tag"]).sort()).toEqual(["conv-1", "conv-2"]);
  });

  it("a person looking at the app (a visible window) gets no notification on top of it", async () => {
    const w = world();
    w.windows.push({ url: `${ORIGIN}/chat`, visibilityState: "visible", focus: async () => undefined, navigate: async () => undefined, navigated: [] });
    await w.push(chatNote("conv-1", "m1", "واحد"));
    expect(w.shown).toEqual([]);
  });

  it("the words are what the server sent: «رسالة جديدة» for a chat whose preview is off", async () => {
    const w = world();
    await w.push(chatNote("conv-1", "m1", "رسالة جديدة"));
    expect(w.shown[0]!.options["body"]).toBe("رسالة جديدة");
  });

  it("the worker's reading of an address and the app's (src/lib/pwa/notifications.ts) agree on every shape", () => {
    const w = world();
    const theirs = (url: unknown) => vm.runInContext(`conversationOfUrl(${JSON.stringify(url)})`, w.context) as string | null;
    const urls = [
      "/chat/c1",
      "/chat/c1?m=m1",
      "/chat/c%20x?m=m1",
      "/chat/s/space-1",
      "/chat",
      "/tasks/t1",
      `/go?space=s1&next=${encodeURIComponent("/chat/c2?m=m2")}`,
      "/go?space=s1",
      "/go?space=s1&next=%2Ftasks%2Ft1",
      "",
      null,
      "/chat/%E0%A4%A",
    ];
    for (const url of urls) expect(theirs(url), String(url)).toBe(conversationOfUrl(url as string | null, ORIGIN));
  });
});

describe("what it did before", () => {
  it("a ring keeps its own tag and stays on screen until answered; it is not a chat tag", async () => {
    const w = world();
    await w.push({ kind: "ring", title: "فلان عم يرنّ عليك", body: "", url: "/calls/abc", tag: "call:abc" });
    expect(w.shown[0]!.options["tag"]).toBe("call:abc");
    expect(w.shown[0]!.options["requireInteraction"]).toBe(true);
  });

  it("a note about something else keeps its tag; nothing without a title or an address is shown", async () => {
    const w = world();
    await w.push({ kind: "note", title: "مهمة جديدة", body: "x", url: "/tasks/t1", tag: "task_assigned:/tasks/t1" });
    expect(w.shown[0]!.options["tag"]).toBe("task_assigned:/tasks/t1");
    await w.push({ kind: "note", body: "no title", url: "/x" });
    await w.push({ kind: "note", title: "no url" });
    expect(w.shown).toHaveLength(1);
  });

  it("a tap opens the page, or moves the window that is open there", async () => {
    const closed: string[] = [];
    const none = world();
    await none.fire("notificationclick", { notification: { close: () => closed.push("x"), data: { url: "/chat/c1?m=m1" } } });
    expect(none.opened).toEqual(["/chat/c1?m=m1"]);
    expect(closed).toEqual(["x"]);

    const open = world();
    const win = { url: `${ORIGIN}/`, visibilityState: "hidden", focus: async () => undefined, navigated: [] as string[], navigate: async (u: string) => void win.navigated.push(u) };
    open.windows.push(win);
    await open.fire("notificationclick", { notification: { close: () => undefined, data: { url: "/chat/c2" } } });
    expect(win.navigated).toEqual(["/chat/c2"]);
    expect(open.opened).toEqual([]);
  });
});
