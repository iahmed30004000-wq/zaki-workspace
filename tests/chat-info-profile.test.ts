import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { InfoPanel } from "@/components/chat/v2/info/info-panel";
import { InfoTabs } from "@/components/chat/v2/info/info-tabs";
import { PaneActionsProvider } from "@/components/chat/v2/pane/pane-actions";
import { PaneHeader } from "@/components/chat/v2/pane/pane-header";
import { chatKeys } from "@/lib/chat/cache/keys";
import { activeTabOf, INFO_TAB_ORDER, tabAfterKey, tabsOf } from "@/lib/chat/v2/info/info-tabs";
import { durationLabel, membersTabOf, muteOffersOf } from "@/lib/chat/v2/info/info-model";
import { linkKeyOf, linksOfBody, mergeLinkPages } from "@/lib/chat/v2/info/link-list";
import { mediaCountsKey, mediaPagesKey } from "@/lib/chat/v2/info/use-info-tabs";
import { MUTE_PRESETS } from "@/lib/chat/row-preview";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import type { ChatRowDto, ConversationHeaderDto, MemberDto } from "@/server/chat/dto";
import type { LinkItemDto, MediaCountsDto, MediaItemDto, MediaPageDto } from "@/server/chat/media";
import { makeHeader } from "./chat-v2-pane-fixtures.test";
import { classTokens } from "./ui-render";

/**
 * S5.4 — THE CONVERSATION PROFILE: the header's whole identity block opens the info panel; the panel's tabs are ALWAYS there (media, files, links, voice, members)
 * each with its own empty state; «روابط» is every address found in the messages; the media grid shows a frame of a video; a mute row with the existing presets;
 * a members list that respects the privacy of a restricted topic.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Actions = PaneActionsProvider as unknown as FunctionComponent<{ conversationId: string; jumpTo: () => void; toNewest: () => void; children?: ReactNode }>;
const noop = () => undefined;
const person = (id: string, name: string, over: Partial<MemberDto> = {}): MemberDto => ({ id, name, online: false, ...over });
const people = (names: string[]): MemberDto[] => names.map((name, i) => person(`u${i + 1}`, name));
const counts = (over: Partial<MediaCountsDto["counts"]> = {}): MediaCountsDto["counts"] => ({ IMAGE: 0, VIDEO: 0, FILE: 0, AUDIO: 0, LINK: 0, ...over });
const tabIds = (html: string) => [...html.matchAll(/data-info-tab="([a-z]+)"/g)].map((m) => m[1]);

// ───────────────────────────── the header: the whole identity block is ONE button ─────────────────────────────
describe("the header: a tap on the picture, the name or the line under it opens the info", () => {
  const draw = (header: ConversationHeaderDto) =>
    renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Actions, { conversationId: header.id, jumpTo: noop, toNewest: noop }, createElement(PaneHeader, { header, people: null, watch: false, system: false })))));

  it("the identity block is one container holding the picture, the title and the line, and ONE button that covers all of it, named after the conversation", () => {
    const html = draw(makeHeader());
    const block = /<div[^>]*data-header-identity[^>]*>([\s\S]*?)<\/header>/.exec(html);
    expect(block).not.toBeNull();
    const inner = block![1]!;
    // the button covers the whole block (a stretched button) and says what it opens, with the conversation's name
    const button = /<button[^>]*data-header-title[^>]*>/.exec(html)![0];
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain(`aria-label="${AR["chatprof.header.open"]!.replace("{name}", "طلبات اليوم")}"`);
    expect(button).toMatch(/class="[^"]*\babsolute\b[^"]*\binset-0\b/);
    // the picture, the title and the line are inside the same block, and they let the tap through to the button
    expect(inner).toContain("📦");
    expect(inner).toMatch(/<h1[^>]*>طلبات اليوم<\/h1>/);
    expect(inner).toContain("data-header-subtitle");
    expect(inner).toMatch(/class="[^"]*pointer-events-none/);
    // the other actions are NOT inside the identity block: they keep their own buttons
    const identityEnd = html.indexOf("data-header-search");
    expect(html.indexOf("data-header-identity")).toBeLessThan(identityEnd);
    expect(html).toContain("data-header-menu");
    expect(html).toContain(AR["calls.menu_label"]!);
  });

  it("a private chat: the other person's picture is in the block too", () => {
    const html = draw(makeHeader({ kind: "DM", space: null, title: "سلمى", emoji: null, peer: { id: "u2", name: "سلمى", avatarUrl: null }, audience: { type: "PAIR", count: 2 }, memberCount: 2 }));
    const block = html.slice(html.indexOf("data-header-identity"), html.indexOf("data-header-search"));
    expect(block).toContain("سلمى");
    expect(block).toMatch(/<h1[^>]*>سلمى<\/h1>/);
  });

  it("the lock chip of a private topic stays its own button (its sheet), above the stretched button, and never inside another button", () => {
    const html = draw(makeHeader({ restricted: true, memberCount: 4, audience: { type: "PEOPLE", count: 4 } }));
    const chip = /<button[^>]*data-privacy[^>]*>/.exec(html)![0];
    for (const token of ["relative", "z-10", "pointer-events-auto"]) expect(chip.split(/[\s"]+/)).toContain(token);
    expect(html).toContain("🔒 خاص · 4 أشخاص");
    // no button holds another button (the stretched button is empty)
    expect(/<button\b(?:(?!<\/button>)[\s\S])*<button\b/.test(html)).toBe(false);
  });

  it("the whole block's target is at least 44 px high and it has a visible focus ring", () => {
    const html = draw(makeHeader());
    const button = /<button[^>]*data-header-title[^>]*>/.exec(html)![0];
    expect(button).toMatch(/focus-visible:outline/);
    expect(html).toMatch(/data-header-identity[^>]*class="[^"]*min-h-11/);
  });
});

// ───────────────────────────── the tabs are ALWAYS there ─────────────────────────────
describe("the tabs: media, files, links, voice and members are always there", () => {
  it("nothing known, nothing counted: the four content tabs are still there (with no count), and members only where the conversation has people", () => {
    expect(tabsOf({ counts: null, work: null, pinned: 0, members: null }).map((t) => t.id)).toEqual(["media", "files", "links", "voice"]);
    expect(tabsOf({ counts: null, work: null, pinned: 0, members: 0 }).map((t) => t.id)).toEqual(["media", "files", "links", "voice", "members"]);
    expect(tabsOf({ counts: counts(), work: { tasks: 0, tickets: 0 }, pinned: 0, members: 5 }).map((t) => t.id)).toEqual(["media", "files", "links", "voice", "members"]);
  });

  it("the plan's order; «الوسائط» counts the pictures and the videos together; the old «الشغل» and «المثبّتة» tabs stay, and only with data", () => {
    expect(INFO_TAB_ORDER).toEqual(["media", "files", "links", "voice", "members", "work", "pinned"]);
    const tabs = tabsOf({ counts: counts({ IMAGE: 2, VIDEO: 1, AUDIO: 3 }), work: { tasks: 1, tickets: 2 }, pinned: 4, members: 7 });
    expect(tabs.map((t) => [t.id, t.count])).toEqual([["media", 3], ["files", 0], ["links", 0], ["voice", 3], ["members", 7], ["work", 3], ["pinned", 4]]);
  });

  it("the tab shown is the chosen one; otherwise the first content tab that has something, otherwise «الوسائط» (an empty chat shows an empty state, not the people)", () => {
    const some = tabsOf({ counts: counts({ FILE: 1, LINK: 1 }), work: null, pinned: 0, members: 6 });
    expect(activeTabOf(some, null)).toBe("files");
    expect(activeTabOf(some, "links")).toBe("links");
    expect(activeTabOf(some, "voice")).toBe("voice");
    const empty = tabsOf({ counts: counts(), work: null, pinned: 0, members: 6 });
    expect(activeTabOf(empty, null)).toBe("media");
    expect(activeTabOf(tabsOf({ counts: null, work: null, pinned: 0, members: null }), null)).toBe("media");
    expect(activeTabOf([], "files")).toBeNull();
  });

  it("the arrow keys still walk the whole list the way a right-to-left row reads, and stop at the ends", () => {
    const tabs = tabsOf({ counts: counts(), work: null, pinned: 0, members: 3 });
    expect(tabAfterKey(tabs, "media", "ArrowLeft")).toBe("files");
    expect(tabAfterKey(tabs, "voice", "ArrowLeft")).toBe("members");
    expect(tabAfterKey(tabs, "members", "ArrowLeft")).toBe("members");
    expect(tabAfterKey(tabs, "files", "ArrowRight")).toBe("media");
    expect(tabAfterKey(tabs, "media", "End")).toBe("members");
  });
});

// ───────────────────────────── every address found in the messages ─────────────────────────────
describe("«روابط»: the addresses of a message", () => {
  it("every http(s) address of a text (a bare one, www., and the address inside [text](address)); never mailto, javascript or ftp", () => {
    const found = linksOfBody("أول https://one.example/a وتاني [عنوان](https://two.example/b?x=1) وثالث www.three.example/c ورابع mailto:a@b.example وخامس javascript:alert(1) وسادس ftp://f.example/x");
    expect(found.map((l) => l.url)).toEqual(["https://one.example/a", "https://two.example/b?x=1", "https://www.three.example/c"]);
    expect(found.map((l) => l.host)).toEqual(["one.example", "two.example", "three.example"]);
  });

  it("the same address twice in one text is one; a trailing slash, a #fragment and the case of the host do not make a new address", () => {
    const found = linksOfBody("https://Dup.example/page and https://dup.example/page/ and https://dup.example/page#top");
    expect(found).toHaveLength(1);
    expect(linkKeyOf("https://DUP.example/page/#a")).toBe(linkKeyOf("https://dup.example/page"));
    expect(linkKeyOf("https://dup.example/page?a=1")).not.toBe(linkKeyOf("https://dup.example/page"));
    expect(linkKeyOf("http://dup.example/page")).not.toBe(linkKeyOf("https://dup.example/page"));
  });

  it("a text with no address, or one the formatter would not link, gives nothing", () => {
    expect(linksOfBody("the http protocol is a word")).toEqual([]);
    expect(linksOfBody("https://user:pass@evil.example/x")).toEqual([]);
    expect(linksOfBody("")).toEqual([]);
  });

  it("the pages merge newest first with each address once — the first (newest) copy wins, a later page never repeats it", () => {
    const link = (id: string, url: string, at: string): LinkItemDto => ({ id, messageId: id.split(":")[0]!, at, authorName: "سلمى", url, host: "x.example", title: null, description: null, siteName: null, image: null });
    const merged = mergeLinkPages([
      [link("m5:0", "https://a.example/1", "2026-11-05T00:00:00Z"), link("m4:0", "https://b.example/2", "2026-11-04T00:00:00Z")],
      [link("m3:0", "https://a.example/1/", "2026-11-03T00:00:00Z"), link("m2:0", "https://c.example/3", "2026-11-02T00:00:00Z")],
    ]);
    expect(merged.map((l) => l.id)).toEqual(["m5:0", "m4:0", "m2:0"]);
  });

  it("the server builds the list from the SAME helper and never from the first card only (read from the source)", () => {
    const server = read("src/server/chat/media.ts");
    expect(server).toContain('from "@/lib/chat/v2/info/link-list"');
    expect(server).toContain("linksOfBody(");
    // the old rule «a message with a card» is gone from the list's query
    expect(server).not.toMatch(/previewId: \{ not: null \}, preview: \{ status: "OK" \}/);
  });
});

// ───────────────────────────── the members tab ─────────────────────────────
describe("the members tab", () => {
  it("none for a private chat (it has the profile instead)", () => {
    expect(membersTabOf(makeHeader({ kind: "DM", space: null, audience: { type: "PAIR", count: 2 }, memberCount: 2 }), { members: people(["أحمد", "سلمى"]) })).toBeNull();
  });

  it("an open topic lists the topic's whole audience as the door gave it (the assistant is not a person); the count is the list's", () => {
    const m = membersTabOf(makeHeader(), { members: people(["أحمد"]), mentionables: [...people(["أحمد", "سلمى", "ليلى"]), person("ai", "المساعد", { role: "AI" })] });
    expect(m).toMatchObject({ state: "open", total: 3 });
    expect(m!.names.map((n) => n.name)).toEqual(["أحمد", "سلمى", "ليلى"]);
  });

  it("an open topic whose people are not known yet still says how many (the header's own count) and lists nobody", () => {
    expect(membersTabOf(makeHeader(), null)).toMatchObject({ state: "open", total: 42, names: [] });
  });

  it("a restricted topic: names only from the door's own member list (a person who was not given it sees none, whatever else is in the cache)", () => {
    const header = makeHeader({ restricted: true, memberCount: 3, audience: { type: "PEOPLE", count: 3 } });
    expect(membersTabOf(header, { members: people(["أحمد", "سلمى", "ليلى"]) })).toMatchObject({ state: "restricted", total: 3 });
    expect(membersTabOf(header, { members: people(["أحمد", "سلمى", "ليلى"]) })!.names).toHaveLength(3);
    for (const given of [null, {}, { members: [] as MemberDto[] }, { mentionables: people(["أحمد", "سلمى"]) }]) {
      const m = membersTabOf(header, given);
      expect(m!.names, JSON.stringify(given)).toEqual([]);
      expect(m!.total).toBe(3);
    }
  });

  it("a topic of a section never hands the space's people over as its own: the count only", () => {
    const m = membersTabOf(makeHeader({ teamId: "t1", audience: { type: "TEAM", count: 7 }, memberCount: 7 }), { members: people(["أحمد"]), mentionables: people(["أحمد", "سلمى"]) });
    expect(m).toMatchObject({ state: "team", total: 7, names: [] });
  });

  it("a group lists the people of its own rows", () => {
    const m = membersTabOf(makeHeader({ kind: "GROUP", space: null, audience: { type: "GROUP", count: 3 }, memberCount: 3 }), { members: people(["أحمد", "سلمى", "ليلى"]) });
    expect(m).toMatchObject({ total: 3 });
    expect(m!.names).toHaveLength(3);
  });
});

// ───────────────────────────── the mute row ─────────────────────────────
describe("the mute row uses the existing presets", () => {
  it("offers the five presets of the chat list's menu (the same constant), or «رفع الكتم» while muted", () => {
    const on = muteOffersOf({ muted: false, personal: true, saved: false, oversight: false });
    expect(on).toEqual({ state: "presets", presets: MUTE_PRESETS });
    expect(MUTE_PRESETS.map((p) => p.key)).toEqual(["hour", "hours8", "day", "week", "forever"]);
    expect(muteOffersOf({ muted: true, personal: true, saved: false, oversight: false })).toEqual({ state: "lift", presets: MUTE_PRESETS });
  });

  it("nothing in «الرسائل المحفوظة», for a silent reader (nothing of theirs is written), or while the company's personal state is off", () => {
    expect(muteOffersOf({ muted: false, personal: true, saved: true, oversight: false })).toBeNull();
    expect(muteOffersOf({ muted: false, personal: true, saved: false, oversight: true })).toBeNull();
    expect(muteOffersOf({ muted: false, personal: false, saved: false, oversight: false })).toBeNull();
  });

  it("the panel's row talks to the person's own door (`PUT …/me`, through the row menu's hook) and never edits the row menu or the presets", () => {
    const mute = read("src/components/chat/v2/info/info-mute.tsx");
    expect(mute).toContain("MUTE_PRESETS");
    expect(mute).toContain("mutedUntilOf(");
    expect(mute).toContain("usePersonalCall");
    expect(mute).toContain("mutedUntil: null");
  });

  const row = (over: Partial<ChatRowDto> = {}): ChatRowDto => ({ id: "c1", kind: "TOPIC", title: "طلبات اليوم", unread: 0, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, ...over }) as ChatRowDto;
  void row;

  it("the panel draws the row with the five presets, and «رفع الكتم» when the header says the chat is muted", () => {
    const html = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(InfoPanel, { header: makeHeader(), people: null, onSearch: noop, onTopic: noop }))));
    expect(html).toContain("data-info-mute");
    for (const preset of MUTE_PRESETS) expect(html).toContain(AR[preset.labelKey]!);
    expect(html).not.toContain(AR["chatps.unmute"]!);
    const muted = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(InfoPanel, { header: makeHeader({ me: { muted: true } }), people: null, onSearch: noop, onTopic: noop }))));
    expect(muted).toContain(AR["chatps.unmute"]!);
    for (const preset of MUTE_PRESETS) expect(muted).not.toContain(`>${AR[preset.labelKey]!}<`);
    // a silent reader has no row
    const silent = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(InfoPanel, { header: makeHeader({ me: { oversight: true } }), people: null, onSearch: noop, onTopic: noop }))));
    expect(silent).not.toContain("data-info-mute");
  });
});

// ───────────────────────────── the panel's tabs, drawn ─────────────────────────────
const media = (id: string, kind: "IMAGE" | "VIDEO" | "FILE" | "AUDIO" = "IMAGE", extra: Partial<MediaItemDto["attachment"]> = {}): MediaItemDto => ({
  id,
  messageId: `m-${id}`,
  at: "2026-11-02T09:00:00.000Z",
  position: 0,
  authorName: "سلمى",
  caption: null,
  attachment: { id, kind, name: `${id}.bin`, mime: kind === "VIDEO" ? "video/mp4" : "image/png", size: 2048, url: `/api/chat/attachments/${id}`, ...extra },
});
const page = (items: MediaItemDto[], links: LinkItemDto[] = []): MediaPageDto => ({ items, links, next: null });

function seeded(parts: { counts?: MediaCountsDto["counts"]; pages?: Partial<Record<"media" | "files" | "links" | "voice", MediaPageDto>> }): QueryClient {
  const client = new QueryClient();
  if (parts.counts) client.setQueryData(mediaCountsKey("c1"), parts.counts);
  for (const [tab, data] of Object.entries(parts.pages ?? {})) client.setQueryData(mediaPagesKey("c1", tab as "media"), { pages: [data], pageParams: [null] });
  return client;
}
function tabs(header: ConversationHeaderDto, over: { client?: QueryClient; people?: { members?: MemberDto[]; mentionables?: MemberDto[] } | null; initialTab?: "media" | "files" | "links" | "voice" | "members" } = {}): string {
  return renderToStaticMarkup(
    createElement(
      Translations,
      { initial: "ar" },
      createElement(Queries, { client: over.client ?? new QueryClient() }, createElement(InfoTabs as unknown as FunctionComponent<Record<string, unknown>>, { header, people: over.people ?? null, ...(over.initialTab ? { initialTab: over.initialTab } : {}) })),
    ),
  );
}

describe("the tabs, drawn", () => {
  it("a topic with nothing in it still shows media, files, links, voice and members, and the selected tab says it is empty (never a blank)", () => {
    const html = tabs(makeHeader(), { client: seeded({ counts: counts() }), people: { mentionables: people(["أحمد", "سلمى"]) } });
    expect(tabIds(html)).toEqual(["media", "files", "links", "voice", "members"]);
    for (const word of ["الوسائط", "الملفات", "الروابط", "الصوتيات", "الأعضاء"]) expect(html).toContain(word);
    expect(html).toContain('data-info-tab-panel="media"');
    expect(html).toContain("data-info-empty=\"media\"");
    expect(html).toContain(AR["chatprof.empty.media"]!);
  });

  it("a private chat has no members tab", () => {
    const html = tabs(makeHeader({ kind: "DM", space: null, audience: { type: "PAIR", count: 2 }, memberCount: 2, peer: { id: "u2", name: "سلمى", avatarUrl: null } }), { client: seeded({ counts: counts() }) });
    expect(tabIds(html)).toEqual(["media", "files", "links", "voice"]);
  });

  it("each of the four content tabs has its own empty sentence", () => {
    for (const tab of ["media", "files", "links", "voice"] as const) {
      const html = tabs(makeHeader(), { client: seeded({ counts: counts(), pages: { [tab]: page([]) } }), initialTab: tab });
      expect(html, tab).toContain(`data-info-empty="${tab}"`);
      expect(html, tab).toContain(AR[`chatprof.empty.${tab}`]!);
    }
    const sentences = ["media", "files", "links", "voice", "members"].map((k) => AR[`chatprof.empty.${k}`]);
    expect(new Set(sentences).size).toBe(5);
  });

  it("a count of zero asks the server for nothing: the empty sentence is drawn at once", () => {
    const html = tabs(makeHeader(), { client: seeded({ counts: counts() }), initialTab: "links" });
    expect(html).toContain('data-info-empty="links"');
    expect(html).not.toContain(AR["chatinfo.loading"]!);
  });

  it("a tab that is not known yet says it is loading (nothing is claimed empty from a guess)", () => {
    const html = tabs(makeHeader(), { initialTab: "files" });
    expect(html).toContain(AR["chatinfo.loading"]!);
    expect(html).not.toContain("data-info-empty");
  });

  it("«الوسائط»: a grid of thumbnails; a picture is its own image, a VIDEO tile is a frame of the video with a play mark and its length — not a bare icon", () => {
    const pages = page([media("a"), media("v", "VIDEO", { name: "clip.mp4", durationMs: 75_000 })]);
    const html = tabs(makeHeader(), { client: seeded({ counts: counts({ IMAGE: 1, VIDEO: 1 }), pages: { media: pages } }) });
    expect(html).toMatch(/<ul[^>]*data-info-media-grid[^>]*class="[^"]*grid-cols-3/);
    expect(html).toMatch(/data-info-media-item="a"[\s\S]*?<img [^>]*src="\/api\/chat\/attachments\/a"/);
    const video = /data-info-media-item="v"[\s\S]*?<\/button>/.exec(html)![0];
    expect(video).toMatch(/<video [^>]*src="\/api\/chat\/attachments\/v#t=0\.1"[^>]*preload="metadata"/);
    expect(video).toContain("muted");
    expect(video).toContain("data-info-video-frame");
    expect(video).toContain("data-info-play");
    expect(video).toContain("1:15");
  });

  it("the video's frame is never a second download of the whole file (metadata only) and never autoplays", () => {
    const html = tabs(makeHeader(), { client: seeded({ counts: counts({ VIDEO: 1 }), pages: { media: page([media("v", "VIDEO")]) } }) });
    expect(html).not.toContain("autoplay");
    expect(html).not.toMatch(/<video [^>]*controls/);
    expect(html).toMatch(/<video [^>]*preload="metadata"/);
  });

  it("«الروابط»: every address with its host and the title when a card exists; a row without a card shows the address itself; opened in a new tab, never a javascript: one", () => {
    const link = (id: string, url: string, host: string, title: string | null): LinkItemDto => ({ id, messageId: id.split(":")[0]!, at: "2026-11-02T09:00:00.000Z", authorName: "سلمى", url, host, title, description: null, siteName: null, image: null });
    const html = tabs(makeHeader(), {
      client: seeded({ counts: counts({ LINK: 2 }), pages: { links: page([], [link("m1:0", "https://example.com/a", "example.com", "عنوان البطاقة"), link("m2:0", "https://plain.example/page", "plain.example", null), link("m3:0", "javascript:alert(1)", "", null)]) } }),
      initialTab: "links",
    });
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain("عنوان البطاقة");
    expect(html).toContain("example.com");
    expect(html).toContain('href="https://plain.example/page"');
    expect(html).toContain("plain.example");
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('data-info-show="m1"');
  });

  it("«الأعضاء» of an open topic: a row per person (picture and name) from the door's list; the count is on the tab", () => {
    const html = tabs(makeHeader(), { client: seeded({ counts: counts() }), people: { mentionables: people(["أحمد", "سلمى", "ليلى"]) }, initialTab: "members" });
    expect(html).toContain('data-info-tab-panel="members"');
    expect(html).toContain("data-info-members");
    for (const name of ["أحمد", "سلمى", "ليلى"]) expect(html).toContain(name);
    expect(html).toMatch(/data-info-tab="members"[\s\S]*?>3<\/span>/);
  });

  it("«الأعضاء» of a private topic: its people's names when the door gave them, otherwise only how many — never a name from the space's list", () => {
    const header = makeHeader({ restricted: true, memberCount: 3, audience: { type: "PEOPLE", count: 3 } });
    const given = tabs(header, { client: seeded({ counts: counts() }), people: { members: people(["أحمد", "سلمى", "ليلى"]) }, initialTab: "members" });
    for (const name of ["أحمد", "سلمى", "ليلى"]) expect(given).toContain(name);
    for (const none of [{}, { mentionables: people(["أحمد", "سلمى"]) }]) {
      const html = tabs(header, { client: seeded({ counts: counts() }), people: none, initialTab: "members" });
      expect(html, JSON.stringify(none)).not.toContain("data-info-members");
      expect(html).not.toContain("أحمد");
      expect(html).not.toContain("سلمى");
      expect(html).toContain("data-info-empty=\"members\"");
    }
  });

  it("«الأعضاء»: while the door's people have not come yet it says it is loading, never «nobody»", () => {
    const html = tabs(makeHeader(), { client: seeded({ counts: counts() }), people: null, initialTab: "members" });
    expect(html).toContain('data-info-loading="members"');
    expect(html).not.toContain("data-info-empty");
    const restricted = tabs(makeHeader({ restricted: true, memberCount: 3, audience: { type: "PEOPLE", count: 3 } }), { client: seeded({ counts: counts() }), people: null, initialTab: "members" });
    expect(restricted).not.toContain("data-info-members");
    expect(restricted).not.toContain("أحمد");
  });

  it("«الأعضاء» of a topic of a section: how many, and no name from the whole space", () => {
    const html = tabs(makeHeader({ teamId: "t1", audience: { type: "TEAM", count: 7 }, memberCount: 7 }), { client: seeded({ counts: counts() }), people: { members: people(["أحمد"]), mentionables: people(["أحمد", "سلمى"]) }, initialTab: "members" });
    expect(html).not.toContain("أحمد");
    expect(html).not.toContain("سلمى");
    expect(html).toContain("data-info-empty=\"members\"");
  });

  it("uses theme tokens and logical sides only, with 44 px targets, and no Latin word or key on screen", () => {
    const html = tabs(makeHeader(), { client: seeded({ counts: counts({ IMAGE: 1 }), pages: { media: page([media("a"), media("v", "VIDEO")]) } }), people: { mentionables: people(["أحمد"]) } });
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-(?:white|black)\b/);
    const physical = /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-|$)/;
    expect(classTokens(html).filter((t) => physical.test(t))).toEqual([]);
    expect(classTokens(html)).toContain("min-h-11");
    for (const word of ["undefined", "chatprof.", "chatinfo."]) expect(html).not.toContain(word);
  });
});

describe("the small pure helpers", () => {
  it("a video's length as minutes:seconds in Western digits; nothing when it is not known", () => {
    expect(durationLabel(75_000)).toBe("1:15");
    expect(durationLabel(9_000)).toBe("0:09");
    expect(durationLabel(3_725_000)).toBe("1:02:05");
    expect(durationLabel(undefined)).toBeNull();
    expect(durationLabel(0)).toBeNull();
  });
});

describe("where it is wired, and what is not touched (read from the source)", () => {
  it("the panel hands the people to the tabs and mounts the mute row", () => {
    const panel = read("src/components/chat/v2/info/info-panel.tsx");
    expect(panel).toContain("<InfoTabs header={header} people={people} />");
    expect(panel).toContain("<MuteRow");
    expect(panel).not.toContain("pane-actions");
  });

  it("the strings are in the new fragment, registered in the dictionary", () => {
    expect(read("src/lib/i18n/dict.ts")).toContain('import chatInfo from "./ar.chat-info.json"');
    expect(read("src/lib/i18n/dict.ts")).toContain("...chatInfo,");
    for (const key of ["chatprof.header.open", "chatprof.tab.members", "chatprof.empty.media", "chatprof.empty.files", "chatprof.empty.links", "chatprof.empty.voice", "chatprof.empty.members", "chatprof.mute.label"]) {
      expect(AR[key], key).toBeTruthy();
    }
    // the Arabic is Levantine UI text with Western digits and no Latin word (the dictionary's fragment is read whole)
    const fragment = JSON.parse(read("src/lib/i18n/ar.chat-info.json")) as Record<string, string>;
    for (const [key, text] of Object.entries(fragment)) {
      expect(text.replace(/\{[a-z]+\}/g, ""), key).not.toMatch(/[A-Za-z]{2,}/);
      expect(text, key).not.toMatch(/[٠-٩]/);
      expect(text, key).not.toMatch(/ً/);
    }
  });

  it("no other package's file is edited: the row menu and the presets are only imported", () => {
    const mute = read("src/components/chat/v2/info/info-mute.tsx");
    expect(mute).toContain('from "@/components/chat/v2/row-menu"');
    expect(mute).toContain('from "@/lib/chat/row-preview"');
  });

  it("the profile reads only doors that exist: the media route's counts and pages, the detail door's people, the personal door for the mute", () => {
    const hooks = read("src/lib/chat/v2/info/use-info-tabs.ts");
    expect(hooks).toContain("mediaCountsUrl");
    expect(hooks).toContain("mediaPageUrl");
    expect(chatKeys.header("c1")).toBeTruthy();
  });
});
