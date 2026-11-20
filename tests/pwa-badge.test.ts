import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { applyAppBadge, badgeCount, BADGE_MAX, cachedUnreadTotal } from "@/lib/pwa/badge";
import { chatKeys } from "@/lib/chat/cache/keys";
import type { ChatListDto, ChatRowDto } from "@/lib/chat/cache/types";

/**
 * M1a — the number on the installed app's icon. It comes from the C1 cache's list (what the sidebar's own count stands in for until the list is cached), counts
 * what the person did not mute, and is taken off when nothing waits.
 */
const row = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto =>
  ({ id, kind: "DM", title: id, emoji: null, space: null, lastMessage: null, unread: 0, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, markedUnread: false, restricted: false, ...over }) as ChatRowDto;

describe("the count the badge shows", () => {
  it("a whole number from 1, capped; nothing for zero, negatives and junk", () => {
    expect(badgeCount(3)).toBe(3);
    expect(badgeCount(2.9)).toBe(2);
    expect(badgeCount(BADGE_MAX + 1000)).toBe(BADGE_MAX);
    for (const none of [0, -4, Number.NaN, Infinity, "5", null, undefined, {}]) expect(badgeCount(none), String(none)).toBe(0);
  });
});

describe("applying it to the icon", () => {
  it("sets the number while something waits and clears it when nothing does", async () => {
    const api = { setAppBadge: vi.fn(async () => undefined), clearAppBadge: vi.fn(async () => undefined) };
    expect(await applyAppBadge(4, api)).toBe("set");
    expect(api.setAppBadge).toHaveBeenCalledWith(4);
    expect(await applyAppBadge(0, api)).toBe("cleared");
    expect(api.clearAppBadge).toHaveBeenCalledTimes(1);
  });

  it("a browser with only setAppBadge clears with a zero; one with neither does nothing; a refusal never throws", async () => {
    const only = { setAppBadge: vi.fn(async () => undefined) };
    expect(await applyAppBadge(0, only)).toBe("cleared");
    expect(only.setAppBadge).toHaveBeenCalledWith(0);
    expect(await applyAppBadge(5, {})).toBe("unsupported");
    expect(await applyAppBadge(0, {})).toBe("unsupported");
    expect(await applyAppBadge(5, null)).toBe("unsupported");
    const refusing = { setAppBadge: vi.fn(async () => { throw new Error("denied"); }), clearAppBadge: vi.fn(async () => { throw new Error("denied"); }) };
    expect(await applyAppBadge(5, refusing)).toBe("unsupported");
    expect(await applyAppBadge(0, refusing)).toBe("unsupported");
  });
});

describe("where the number comes from: the C1 cache", () => {
  const holds = (rows: ChatRowDto[]) => {
    const client = new QueryClient();
    client.setQueryData<ChatListDto>(chatKeys.list(), { scope: "all", spaceId: null, rows, canOversee: false });
    return client;
  };

  it("null while the list is not in the cache (the sidebar's server count stands in)", () => {
    expect(cachedUnreadTotal(new QueryClient())).toBeNull();
  });

  it("the unread messages of the rows; a muted chat and an archived one do not count; a chat marked unread by hand counts one", () => {
    const client = holds([
      row("a", { unread: 3 }),
      row("b", { unread: 2, kind: "TOPIC" }),
      row("muted", { unread: 9, muted: true }),
      row("old", { unread: 7, archivedByMe: true }),
      row("hand", { markedUnread: true }),
      row("read"),
    ]);
    expect(cachedUnreadTotal(client)).toBe(3 + 2 + 1);
  });

  it("a list with nothing unread is 0, which clears the badge", () => {
    expect(cachedUnreadTotal(holds([row("a")]))).toBe(0);
  });
});

describe("where it is wired", () => {
  it("the shell's own unread hook sets it (it runs for everybody who has the chat) and nothing else writes the cache", () => {
    const hook = readFileSync(path.resolve(__dirname, "..", "src/lib/chat/use-chat-unread.ts"), "utf8");
    expect(hook).toContain("useAppBadge(enabled ? (query.data?.total ?? cached ?? 0) : 0)");
    const badge = readFileSync(path.resolve(__dirname, "..", "src/lib/pwa/badge.ts"), "utf8");
    expect(badge).not.toMatch(/setQueryData|setQueriesData/);
  });
});
