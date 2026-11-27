import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1/info",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { InfoPanel } from "@/components/chat/v2/info/info-panel";
import { InfoTabs } from "@/components/chat/v2/info/info-tabs";
import { counterKeyOf, orderTabs, phoneActiveTabOf, swipeTabOf, tabsOf, type InfoTab } from "@/lib/chat/v2/info/info-tabs";
import { groupLinksByMonth } from "@/lib/chat/v2/info/link-list";
import { canLeaveOf, infoActionsOf, shareAddressOf } from "@/lib/chat/v2/info/info-model";
import { mediaCountsKey, mediaPagesKey, workKey } from "@/lib/chat/v2/info/use-info-tabs";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import type { ConversationHeaderDto, MemberDto } from "@/server/chat/dto";
import type { LinkItemDto, MediaCountsDto, MediaItemDto, MediaPageDto } from "@/server/chat/media";
import { makeHeader } from "./chat-v2-pane-fixtures.test";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (node: React.ReactElement, client = new QueryClient()) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, node)));

const counts: MediaCountsDto["counts"] = { IMAGE: 2, VIDEO: 1, FILE: 4, LINK: 85, AUDIO: 1 };
const tabs = (members: number | null): InfoTab[] => tabsOf({ counts, work: null, pinned: 0, members });
const people = (names: string[]): MemberDto[] => names.map((name, i) => ({ id: `u${i + 1}`, name, online: i === 0 }));
const dm = (over: Parameters<typeof makeHeader>[0] = {}) => makeHeader({ kind: "DM", space: null, title: "سلمى", emoji: null, audience: { type: "PAIR", count: 2 }, memberCount: 2, peer: { id: "u2", name: "سلمى", avatarUrl: null }, ...over });

describe("the pill tabs of the phone", () => {
  it("put the members first; the other order stays as it was", () => {
    expect(orderTabs(tabs(7), true).map((t) => t.id)).toEqual(["members", "media", "files", "links", "voice"]);
    expect(orderTabs(tabs(7), false).map((t) => t.id)).toEqual(["media", "files", "links", "voice", "members"]);
    expect(orderTabs(tabs(null), true).map((t) => t.id)).toEqual(["media", "files", "links", "voice"]);
  });
  it("open on the members where there are people, otherwise on the first tab that holds something", () => {
    expect(phoneActiveTabOf(orderTabs(tabs(7), true), null)).toBe("members");
    expect(phoneActiveTabOf(orderTabs(tabs(7), true), "links")).toBe("links");
    expect(phoneActiveTabOf(orderTabs(tabsOf({ counts: { ...counts, IMAGE: 0, VIDEO: 0 }, work: null, pinned: 0, members: null }), true), null)).toBe("files");
  });
  it("a sideways swipe moves to the neighbour, right-to-left: a finger moving right brings the next one", () => {
    const list = orderTabs(tabs(7), true);
    const far = TG_MOTION.infoSwipePx + 10;
    expect(swipeTabOf(list, "members", far, 0, true)).toBe("media");
    expect(swipeTabOf(list, "media", -far, 0, true)).toBe("members");
    expect(swipeTabOf(list, "media", -far, 0, false)).toBe("files");
    expect(swipeTabOf(list, "members", -far, 0, true)).toBeNull();
    expect(swipeTabOf(list, "voice", far, 0, true)).toBeNull();
    expect(swipeTabOf(list, "media", 20, 0, true)).toBeNull();
    // a scroll up or down is never a change of tab
    expect(swipeTabOf(list, "media", far, far, true)).toBeNull();
  });
  it("the header's counter follows the active tab, in the Arabic number", () => {
    expect(counterKeyOf("members", 1)).toBe("tgsheets.count.members.one");
    expect(counterKeyOf("links", 85)).toBe("tgsheets.count.links.many");
    expect(counterKeyOf("files", 3)).toBe("tgsheets.count.files.few");
    expect(counterKeyOf("voice", 2)).toBe("tgsheets.count.voice.two");
    expect(counterKeyOf("media", 0)).toBe("tgsheets.count.media.zero");
    for (const tab of ["members", "media", "files", "links", "voice", "work", "pinned"] as const) {
      for (const n of [0, 1, 2, 5, 20]) expect(AR[counterKeyOf(tab, n)], `${tab} ${n}`).toMatch(/[؀-ۿ]/);
    }
    expect(AR["tgsheets.count.links.many"]).toBe("{n} رابطًا");
  });
});

describe("links by month", () => {
  const link = (id: string, at: string): LinkItemDto => ({ id, messageId: id, at, authorName: "a", url: `https://x.example/${id}`, host: "x.example", title: null, description: null, siteName: null, image: null });
  it("one heading per month, newest first, the year said only when it is not this one", () => {
    const groups = groupLinksByMonth([link("a", "2026-11-20T10:00:00"), link("b", "2026-11-01T10:00:00"), link("c", "2026-10-05T10:00:00"), link("d", "2025-10-05T10:00:00")], new Date("2026-11-27T10:00:00"));
    expect(groups.map((g) => [g.key, g.links.map((l) => l.id)])).toEqual([["2026-11", ["a", "b"]], ["2026-10", ["c"]], ["2025-10", ["d"]]]);
    expect(groups[1]!.label).not.toContain("2026");
    expect(groups[2]!.label).toContain("2025");
  });
});

describe("the action cards: only what really exists", () => {
  it("message, mute, search, call, share and leave, each only where it works", () => {
    expect(infoActionsOf({ mute: "presets", canCall: true, canShare: true, canLeave: true })).toEqual(["message", "mute", "search", "call", "share", "leave"]);
    expect(infoActionsOf({ mute: "lift", canCall: false, canShare: false, canLeave: false })).toEqual(["message", "unmute", "search"]);
    expect(infoActionsOf({ mute: null, canCall: false, canShare: true, canLeave: false })).toEqual(["message", "search", "share"]);
  });
  it("leave: only my own membership of a group or of a topic made for named people", () => {
    const member = { members: people(["أنا"]) };
    const me = { id: "u1" };
    expect(canLeaveOf(makeHeader({ kind: "GROUP", me }), member)).toBe(true);
    expect(canLeaveOf(makeHeader({ restricted: true, me }), member)).toBe(true);
    expect(canLeaveOf(makeHeader({ me }), member)).toBe(false);
    expect(canLeaveOf(dm({ me }), member)).toBe(false);
    expect(canLeaveOf(makeHeader({ kind: "GROUP", me }), { members: [] })).toBe(false);
    expect(canLeaveOf(makeHeader({ kind: "GROUP", me: { ...me, oversight: true } }), member)).toBe(false);
  });
  it("share: the person's profile in a private chat, the conversation otherwise, nothing for the saved messages", () => {
    expect(shareAddressOf(dm(), "https://w.example", false)).toBe("https://w.example/u/u2");
    expect(shareAddressOf(makeHeader(), "https://w.example/", false)).toBe("https://w.example/chat/c1");
    expect(shareAddressOf(dm(), "https://w.example", true)).toBeNull();
  });
});

function seeded(pages: Partial<Record<"links" | "voice", MediaPageDto>> = {}): QueryClient {
  const client = new QueryClient();
  client.setQueryData(mediaCountsKey("c1"), counts);
  client.setQueryData(workKey("c1"), { tasks: [], tickets: [] });
  for (const [tab, page] of Object.entries(pages)) client.setQueryData(mediaPagesKey("c1", tab as "links"), { pages: [page], pageParams: [null] });
  return client;
}
const panel = (header: ConversationHeaderDto, phone: boolean, names = ["أحمد", "سلمى"]) =>
  render(createElement(InfoPanel, { header, people: { members: people(names), mentionables: people(names) }, onSearch: () => {}, onTopic: () => {}, ...(phone ? { phone: true, onMessage: () => {} } : {}) }), seeded());

describe("the phone's info page", () => {
  it("a big picture, the action cards, and the members tab first and open", () => {
    const html = panel(makeHeader(), true);
    expect(html).toContain("size-28");
    expect(html).toContain("data-info-actions");
    for (const id of ["message", "search", "share"]) expect(html).toContain(`data-info-action="${id}"`);
    expect(html).not.toContain('data-info-action="leave"');
    expect(html).not.toContain("data-info-mute-preset");
    expect(html.indexOf('data-info-tab="members"')).toBeLessThan(html.indexOf('data-info-tab="media"'));
    expect(html).toContain('data-info-tab-panel="members"');
    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain("flex-wrap gap-1 rounded-full");
    expect(html).toContain("متصل");
  });

  it("a computer and the switch off draw the panel of before", () => {
    const html = panel(makeHeader(), false);
    expect(html).not.toContain("data-info-actions");
    expect(html).not.toContain("size-28");
    expect(html.indexOf('data-info-tab="media"')).toBeLessThan(html.indexOf('data-info-tab="members"'));
    expect(html).toContain('data-info-button="search"');
  });

  it("«إضافة أعضاء» only for a moderator of a topic made for named people", () => {
    expect(panel(makeHeader({ restricted: true, me: { canModerate: true } }), true)).toContain("data-info-add-members");
    expect(panel(makeHeader({ me: { canModerate: true } }), true)).not.toContain("data-info-add-members");
    expect(panel(makeHeader({ restricted: true }), true)).not.toContain("data-info-add-members");
  });

  it("links under their month, with a letter tile", () => {
    const link: LinkItemDto = { id: "m1:0", messageId: "m1", at: "2026-10-05T10:00:00", authorName: "سلمى", url: "https://github.com/x", host: "github.com", title: "مشروع", description: "وصف الصفحة", siteName: null, image: null };
    const client = seeded({ links: { items: [], links: [link], next: null } });
    const html = render(createElement(InfoTabs, { header: makeHeader(), initialTab: "links", phone: true }), client);
    expect(html).toContain('data-info-month="2026-10"');
    expect(html).toContain("data-info-link-letter");
    expect(html).toContain("وصف الصفحة");
  });

  it("voice messages use the app's own player on a phone, the browser's controls as before elsewhere", () => {
    const item: MediaItemDto = { id: "a1", messageId: "m1", at: "2026-10-05T10:00:00", position: 0, authorName: "سلمى", caption: null, attachment: { id: "a1", kind: "AUDIO", name: "v.webm", mime: "audio/webm", size: 10, url: "/api/chat/attachments/a1", durationMs: 11000, peaks: [10, 50, 90] } as MediaItemDto["attachment"] };
    const draw = (phone: boolean) => render(createElement(InfoTabs, { header: makeHeader(), initialTab: "voice", phone }), seeded({ voice: { items: [item], links: [], next: null } }));
    expect(draw(true)).toContain("data-voice");
    expect(draw(true)).not.toContain("<audio controls");
    expect(draw(false)).toContain("<audio controls");
  });

  it("the screen hands the panel the phone's look and shows the counter in its bar", () => {
    const screen = read("src/components/chat/v2/phone/info-screen.tsx");
    expect(screen).toContain("useTgPhone()");
    expect(screen).toContain("onCounter");
    expect(screen).toContain('aria-live="polite"');
  });

  it("the sliding of a tab obeys «الانتقالات السلسة»", () => {
    const css = read("src/components/chat/v2/tg-sheets.css");
    expect(css).toContain('html:not([data-fx-off~="transitions"]) .tg-tab-in');
    expect(css).toContain("var(--tg-tab-switch-ms");
  });
});
