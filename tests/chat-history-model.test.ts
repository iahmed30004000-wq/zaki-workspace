import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { memoryStartStore } from "@/lib/chat/cache/device-store";
import { installChatRuntime } from "@/lib/chat/cache/runtime";
import type { MessageDto, MessagesPageDto, MessagesParam } from "@/lib/chat/cache/types";

/**
 * C1.6 / C1.7 test helper — a PURE MODEL of the server's message windows, written from `conversationMessages` in
 * `src/server/chat/topics.ts`: the order and the cursor are `(createdAt, id)`; `latest` is the newest `limit`; `before` the `limit`
 * messages right before the anchor; `after` the `limit` right after it; `around` the anchor, older ones (the larger half) and newer
 * ones. The suites import it (it is named `.test.` only so that it stays among the test files, with a test of its own).
 */

const BASE = Date.parse("2026-11-01T08:00:00.000Z");

/**
 * `count` messages, oldest first. Every `tie` of them share one instant (`tie: 1` = all different); ids are zero-padded so the
 * order by id inside one instant is the order they were made in, as the server's `id` tie-break gives.
 */
export function makeConversation(count: number, tie = 1, over: (i: number) => Partial<MessageDto> = () => ({})): MessageDto[] {
  return Array.from({ length: count }, (_, i): MessageDto => ({
    id: `m${String(i).padStart(6, "0")}`,
    kind: "TEXT",
    body: `رسالة ${i}`,
    deleted: false,
    edited: false,
    pinned: false,
    mine: false,
    authorId: "u2",
    authorName: "سلمى",
    createdAt: new Date(BASE + Math.floor(i / tie) * 60_000).toISOString(),
    clientId: null,
    mentions: [],
    attachments: [],
    reactions: [],
    ...over(i),
  }));
}

export class AnchorNotFound extends Error {}

export function serve(all: MessageDto[], param: MessagesParam, limit = 50, firstUnreadId: string | null = null): MessagesPageDto {
  const at = (id: string): number => {
    const i = all.findIndex((m) => m.id === id);
    if (i < 0) throw new AnchorNotFound(id);
    return i;
  };
  const page = (from: number, to: number, hasOlder: boolean, hasNewer: boolean): MessagesPageDto => ({ messages: all.slice(from, to), hasOlder, hasNewer, firstUnreadId, readers: [] });
  const n = all.length;
  switch (param.kind) {
    case "latest":
      return page(Math.max(0, n - limit), n, n > limit, false);
    case "before": {
      const i = at(param.id);
      return page(Math.max(0, i - limit), i, i > limit, true);
    }
    case "after": {
      const i = at(param.id);
      return page(i + 1, Math.min(n, i + 1 + limit), true, i + 1 + limit < n);
    }
    case "around": {
      const i = at(param.id);
      const half = Math.floor(limit / 2);
      const olderLimit = limit - half;
      const from = Math.max(0, i + 1 - olderLimit);
      const to = Math.min(n, i + 1 + half);
      return page(from, to, from > 0, to < n);
    }
  }
}

describe("the model of the server's windows", () => {
  it("orders like the server: oldest first, and all of one instant by id; `before` is the messages right before the anchor", () => {
    const all = makeConversation(20, 5);
    expect(all.map((m) => m.id)).toEqual([...all.map((m) => m.id)].sort());
    expect(all[0]!.createdAt).toBe(all[4]!.createdAt);
    expect(all[4]!.createdAt).not.toBe(all[5]!.createdAt);
    expect(serve(all, { kind: "before", id: all[10]!.id }, 3).messages.map((m) => m.id)).toEqual(all.slice(7, 10).map((m) => m.id));
    expect(serve(all, { kind: "around", id: all[10]!.id }, 4).messages.map((m) => m.id)).toEqual(all.slice(9, 13).map((m) => m.id));
  });
});

/**
 * The page's `fetch` answers like the server for ONE conversation: the sync feed says where «now» is (the cache runtime asks first),
 * the messages route serves windows from `all`, and a cursor that is not in the conversation is a 404. Every address asked is kept.
 */
export function stubServer(all: () => MessageDto[], opts: { conversationId?: string; firstUnreadId?: () => string | null; limit?: number } = {}) {
  const id = opts.conversationId ?? "c1";
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.startsWith("/api/chat/sync")) return json({ cursor: "10", messages: [], reads: [], delivered: [], rows: [], removed: [] });
      asked.push(url);
      const u = new URL(url, "http://localhost");
      if (u.pathname !== `/api/chat/conversations/${id}/messages`) return json({ error: "x" }, 404);
      const limit = Number(u.searchParams.get("limit") ?? 50);
      const param: MessagesParam = u.searchParams.get("before")
        ? { kind: "before", id: u.searchParams.get("before")! }
        : u.searchParams.get("after")
          ? { kind: "after", id: u.searchParams.get("after")! }
          : u.searchParams.get("around")
            ? { kind: "around", id: u.searchParams.get("around")! }
            : { kind: "latest" };
      try {
        return json(serve(all(), param, limit, opts.firstUnreadId?.() ?? null));
      } catch (e) {
        if (e instanceof AnchorNotFound) return json({ error: "chat.e.not_found" }, 404);
        throw e;
      }
    }),
  );
  return asked;
}

/** A client with a fake runtime (nobody's device, the feed answers from the stub above). */
export function clientWithRuntime(): QueryClient {
  const qc = new QueryClient();
  installChatRuntime(qc, {
    me: async () => ({ status: "ok", userId: "u1" }),
    external: async () => false,
    storeFor: () => memoryStartStore(),
    holdsDeviceCache: async () => false,
    owners: async () => ({ owners: new Set<string>() }),
  });
  return qc;
}
