import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
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

import { ConversationSearch } from "@/components/chat/conversation/conversation-search";
import { InfoPanel } from "@/components/chat/v2/info/info-panel";
import { ListSearchResults } from "@/components/chat/v2/info/list-search-results";
import { ListHeader } from "@/components/chat/v2/list/list-header";
import { PhoneListBar } from "@/components/chat/v2/phone/list-bar";
import { peerProfileKey } from "@/lib/chat/v2/info/use-info-data";
import { mediaCountsKey, mediaPagesKey, workKey } from "@/lib/chat/v2/info/use-info-tabs";
import type { ChatListSearchDto } from "@/server/chat/search";
import type { ConversationWorkDto, LinkItemDto, MediaCountsDto, MediaItemDto, MediaPageDto } from "@/server/chat/media";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import type { ConversationHeaderDto, MemberDto } from "@/server/chat/dto";
import { makeHeader } from "./chat-v2-pane-fixtures.test";
import { classTokens } from "./ui-render";

/**
 * C2.7 — the info panel, drawn on the server: one component (`InfoPanel`) that the computer's side panel, the tablet's sheet and C2.8's phone route all mount.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const noop = () => undefined;
const people = (names: string[]): MemberDto[] => names.map((name, i) => ({ id: `u${i + 1}`, name, online: false }));

function draw(header: ConversationHeaderDto, over: { people?: { members?: MemberDto[]; mentionables?: MemberDto[] } | null; onClose?: () => void; client?: QueryClient } = {}): string {
  const client = over.client ?? new QueryClient();
  return renderToStaticMarkup(
    createElement(
      Translations,
      { initial: "ar" },
      createElement(Queries, { client }, createElement(InfoPanel, { header, people: over.people ?? null, onSearch: noop, onTopic: noop, ...(over.onClose ? { onClose: over.onClose } : {}) })),
    ),
  );
}
const dmHeader = (over: Parameters<typeof makeHeader>[0] = {}) => makeHeader({ kind: "DM", space: null, title: "سلمى", emoji: null, audience: { type: "PAIR", count: 2 }, memberCount: 2, peer: { id: "u2", name: "سلمى", avatarUrl: null }, ...over });

describe("a private chat", () => {
  it("shows the big picture, the title and the buttons «🔍 بحث» and the call button", () => {
    const html = draw(dmHeader());
    expect(html).toContain("data-info-panel");
    expect(html).toContain("data-info-hero");
    expect(html).toContain("سلمى");
    expect(html).toContain('data-info-button="search"');
    expect(html).toContain(AR["chatui.info.search"]!);
    // the call button is the existing one (the menu to start a call, or «انضم للمكالمة»)
    expect(html).toContain(AR["calls.menu_label"]!);
  });

  it("has no call button when the person may not call here", () => {
    expect(draw(dmHeader({ me: { canCall: false } }))).not.toContain(AR["calls.menu_label"]!);
  });

  it("has NO «🔔 الإشعارات» (no per-person mute door), NO audience block and NO moderator button", () => {
    const html = draw(dmHeader({ me: { canModerate: true } }), { people: { members: people(["أحمد", "سلمى"]) } });
    expect(html).not.toContain("🔔");
    expect(html).not.toContain("الإشعارات");
    expect(html).not.toContain("data-info-audience");
    expect(html).not.toContain("data-info-moderator");
  });

  it("the profile lines and «افتح الملف الشخصي» appear only when the existing profile door answered (the job title, the bio, the link to /u/<id>)", () => {
    const client = new QueryClient();
    expect(draw(dmHeader())).not.toContain("data-info-profile");
    client.setQueryData(peerProfileKey("c1", "u2"), { jobTitle: "مسؤولة مبيعات", bio: "بتحب القهوة" });
    const html = draw(dmHeader(), { client });
    expect(html).toContain("مسؤولة مبيعات");
    expect(html).toContain("بتحب القهوة");
    expect(html).toContain(`href="/u/u2"`);
    expect(html).toContain(AR["chatui.info.open_profile"]!);
  });

  it("a profile that came back empty draws no empty lines", () => {
    const client = new QueryClient();
    client.setQueryData(peerProfileKey("c1", "u2"), { jobTitle: null, bio: null });
    const html = draw(dmHeader(), { client });
    expect(html).not.toContain(AR["chatui.info.job"]!);
    expect(html).not.toContain(AR["chatui.info.bio"]!);
    expect(html).toContain(`href="/u/u2"`);
  });
});

describe("a topic", () => {
  it("an open topic: the space and «كل أعضاء المساحة (42)», no names, no moderator button for a member", () => {
    const html = draw(makeHeader(), { people: { members: people(["أحمد"]), mentionables: people(["أحمد", "سلمى"]) } });
    expect(html).toContain("المبيعات");
    expect(html).toContain("كل أعضاء المساحة (42)");
    expect(html).not.toContain("data-info-names");
    expect(html).not.toContain("أحمد");
    expect(html).not.toContain("data-info-moderator");
  });

  it("a topic of a section says «المقطع: …» and lists nobody", () => {
    const client = new QueryClient();
    const html = draw(makeHeader({ teamId: "t1", audience: { type: "TEAM", count: 7 }, memberCount: 7 }), { client, people: { members: people(["أحمد"]), mentionables: people(["أحمد"]) } });
    expect(html).toContain("data-info-audience");
    expect(html).toContain("المقطع:");
    expect(html).not.toContain("data-info-names");
    expect(html).not.toContain("أحمد");
  });

  it("a restricted topic says «🔒 خاص — 3 أشخاص» and, when the door gave the people, lists them", () => {
    const header = makeHeader({ restricted: true, audience: { type: "PEOPLE", count: 3 }, memberCount: 3 });
    const html = draw(header, { people: { members: people(["أحمد", "سلمى", "ليلى"]) } });
    expect(html).toContain("🔒 خاص — 3 أشخاص");
    expect(html).toContain("data-info-names");
    for (const name of ["أحمد", "سلمى", "ليلى"]) expect(html).toContain(name);
  });

  it("P0.4: …and says so WITHOUT any name to a person who was not given the people", () => {
    const header = makeHeader({ restricted: true, audience: { type: "PEOPLE", count: 3 }, memberCount: 3 });
    for (const given of [null, {}, { members: [] as MemberDto[] }, { mentionables: people(["أحمد", "سلمى"]) }]) {
      const html = draw(header, { people: given });
      expect(html).toContain("🔒 خاص — 3 أشخاص");
      expect(html).not.toContain("data-info-names");
      expect(html).not.toContain("أحمد");
      expect(html).not.toContain("سلمى");
    }
  });

  it("the owner's silent reading is said on a private topic (the server's flag), never on an open one", () => {
    expect(draw(makeHeader({ restricted: true, oversightNotice: true }))).toContain(AR["chatp.sheet.oversight"]!);
    expect(draw(makeHeader({ oversightNotice: true }))).not.toContain(AR["chatp.sheet.oversight"]!);
  });

  it("a moderator gets «إعدادات الموضوع», close and archive (the old words for the same actions); a starter topic's settings only", () => {
    const html = draw(makeHeader({ me: { canModerate: true } }));
    expect(html).toContain('data-info-moderator="settings"');
    expect(html).toContain('data-info-moderator="close"');
    expect(html).toContain('data-info-moderator="archive"');
    expect(html).toContain(AR["chatc.topic.settings"]!);
    expect(html).toContain(AR["chatc.topic.close"]!);
    expect(html).toContain(AR["chatc.topic.archive"]!);
    expect(draw(makeHeader({ me: { canModerate: true }, closed: true }))).toContain('data-info-moderator="reopen"');
  });
});

describe("what is not drawn", () => {
  it("with nothing known, none of the six tabs of C3d (they draw only what has data: see below), and no empty placeholder for them", () => {
    const html = draw(makeHeader({ me: { canModerate: true } }));
    for (const word of ["الوسائط", "الملفات", "الروابط", "الصوتيات", "الشغل", "المثبّتة"]) expect(html).not.toContain(word);
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("data-info-tabs");
  });
});

describe("the frame", () => {
  it("shows its own header with a close button only when it is docked (the sheet has its own title and corner button)", () => {
    expect(draw(makeHeader(), { onClose: noop })).toContain("data-info-close");
    expect(draw(makeHeader())).not.toContain("data-info-close");
  });

  it("uses theme tokens and logical sides only, with 44 px targets for the buttons", () => {
    const html = draw(makeHeader({ me: { canModerate: true } }), { onClose: noop });
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-(?:white|black)\b/);
    const physical = /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-|$)/;
    expect(classTokens(html).filter((t) => physical.test(t))).toEqual([]);
    expect(classTokens(html)).toContain("min-h-11");
  });
});

describe("where the panel is drawn (read from the source: there is no browser here)", () => {
  const host = read("src/components/chat/v2/pane/seams/info-host.tsx");
  const shell = read("src/components/chat/v2/shell/chat-shell.tsx");

  it("the info host draws nothing while `infoOpen` is false, reads only the pane's actions and the header, and toggles nothing itself", () => {
    expect(host).toMatch(/export function InfoHost\(\{ header \}: \{ header: ConversationHeaderDto \}\)/);
    expect(host).toContain("if (!a.infoOpen) return null");
    expect(host).toContain("<InfoPanel");
    expect(host).not.toMatch(/fetch\(/);
  });

  it("from 1024 px the panel is a 360 px column beside the pane (a portal into the shell's slot); below it an overlay sheet from the END side", () => {
    expect(host).toContain("createPortal(");
    expect(host).toContain('side="end"');
    expect(host).toContain("<Sheet ");
    expect(read("src/lib/chat/v2/info/use-wide.ts")).toContain("(min-width: 1024px)");
    expect(read("src/components/chat/v2/info/info-frame.tsx")).toContain("w-[22.5rem]");
    expect(shell).toContain("data-chat-info-slot");
    expect(shell).toContain("InfoSlotContext.Provider");
  });

  it("the search button opens the pane's search, and on the sheet closes the sheet first so the search is not hidden behind it", () => {
    expect(host).toContain("a.openSearch()");
    expect(host).toMatch(/if \(!docked\) a\.closeInfo\(\)/);
  });

  it("a topic change goes through the pane's `call` with the topics door, then the header is asked for again", () => {
    expect(host).toContain("doors.topic(header.id, patch)");
    expect(host).toContain("chatKeys.header(header.id)");
  });

  it("the panel body is ONE component the phone's route can mount (it imports nothing of the pane's provider)", () => {
    const panel = read("src/components/chat/v2/info/info-panel.tsx");
    expect(panel).not.toContain("pane-actions");
    expect(panel).not.toContain("usePaneActions");
    expect(panel).toContain("export function InfoPanel(");
  });

  it("the profile and the section name come from doors that already exist (the profile route, the space's sections); no new route", () => {
    const data = read("src/lib/chat/v2/info/use-info-data.ts");
    expect(data).toContain("/api/users/");
    expect(data).toContain("/teams");
  });

  it("no per-person mute is drawn: no «اكتم الإشعارات», no bell", () => {
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const file of ["src/components/chat/v2/info/info-panel.tsx", "src/components/chat/v2/pane/seams/info-host.tsx", "src/lib/chat/v2/info/info-model.ts"]) {
      expect(code(read(file)), file).not.toMatch(/🔔|اكتم الإشعارات|["'`]mute["'`]|menu\.mute/);
    }
  });
});

// ───────────────────────────── C3d: the tabs, the in-chat search and the list's results ─────────────────────────────
const media = (over: Partial<MediaItemDto> & { id: string; kind?: "IMAGE" | "VIDEO" | "FILE" | "AUDIO"; name?: string; url?: string }): MediaItemDto => ({
  id: over.id,
  messageId: over.messageId ?? `m-${over.id}`,
  at: over.at ?? "2026-11-02T09:00:00.000Z",
  position: 0,
  authorName: over.authorName ?? "سلمى",
  caption: over.caption ?? null,
  attachment: {
    id: over.id,
    kind: over.kind ?? "IMAGE",
    name: over.name ?? `${over.id}.png`,
    mime: over.kind === "VIDEO" ? "video/mp4" : over.kind === "FILE" ? "application/pdf" : over.kind === "AUDIO" ? "audio/ogg" : "image/png",
    size: 2048,
    url: over.url ?? `/api/chat/attachments/${over.id}`,
  },
});
const page = (items: MediaItemDto[], links: LinkItemDto[] = []): MediaPageDto => ({ items, links, next: null });
const counts = (over: Partial<MediaCountsDto["counts"]> = {}): MediaCountsDto["counts"] => ({ IMAGE: 0, VIDEO: 0, FILE: 0, AUDIO: 0, LINK: 0, ...over });

/** a client that already holds what the tabs ask for (the render is synchronous: nothing is fetched) */
function seeded(parts: { counts?: MediaCountsDto["counts"]; work?: ConversationWorkDto; pages?: Partial<Record<"media" | "files" | "links" | "voice", MediaPageDto>> }): QueryClient {
  const client = new QueryClient();
  if (parts.counts) client.setQueryData(mediaCountsKey("c1"), parts.counts);
  if (parts.work) client.setQueryData(workKey("c1"), parts.work);
  for (const [tab, data] of Object.entries(parts.pages ?? {})) client.setQueryData(mediaPagesKey("c1", tab as "media"), { pages: [data], pageParams: [null] });
  return client;
}
const tabWords = ["الوسائط", "الملفات", "الروابط", "الصوتيات", "الشغل", "المثبّتة"] as const;
const tabIds = (html: string) => [...html.matchAll(/data-info-tab="([a-z]+)"/g)].map((m) => m[1]);

describe("C3d — the tabs draw only what has data", () => {
  it("nothing known, nothing drawn: no tab list, no placeholder (the cache holds no counts yet)", () => {
    const html = draw(makeHeader());
    expect(html).not.toContain("data-info-tabs");
    for (const word of tabWords) expect(html).not.toContain(word);
  });

  it("counts of zero and an empty work list draw nothing either", () => {
    const html = draw(makeHeader(), { client: seeded({ counts: counts(), work: { tasks: [], tickets: [] } }) });
    expect(html).not.toContain("data-info-tabs");
  });

  it("only the tabs that have data: pictures and videos count together in «الوسائط»; the rest follow in the plan's order", () => {
    const header = makeHeader({ pinnedMessages: [{ id: "p1", authorName: "ليلى", preview: "اجتماع الخميس" }] });
    const work: ConversationWorkDto = { tasks: [{ id: "t1", key: "ZK-12", title: "جهّزي العرض", done: false, assigneeName: "ليلى", messageId: "m1" }], tickets: [] };
    const html = draw(header, { client: seeded({ counts: counts({ IMAGE: 2, VIDEO: 1, AUDIO: 4 }), work, pages: { media: page([media({ id: "a" })]) } }) });
    expect(tabIds(html)).toEqual(["media", "voice", "work", "pinned"]);
    for (const word of ["الوسائط", "الصوتيات", "الشغل", "المثبّتة"]) expect(html).toContain(word);
    for (const word of ["الملفات", "الروابط"]) expect(html).not.toContain(word);
    // the number beside «الوسائط» is 2 + 1
    expect(html).toMatch(/data-info-tab="media"[^>]*>.*?<span class="flex-1">الوسائط<\/span><span aria-hidden="true" class="[^"]*">3<\/span>/);
  });

  it("is a real tab list: the first tab is selected, the others are out of the tab order, the panel is labelled by its tab", () => {
    const html = draw(makeHeader({ pinnedMessages: [{ id: "p1", authorName: "ليلى", preview: "نص" }] }), { client: seeded({ counts: counts({ FILE: 1 }), pages: { files: page([media({ id: "f", kind: "FILE", name: "تقرير.pdf" })]) } }) });
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/role="tab"[^>]*id="info-tab-files"[^>]*aria-selected="true"/);
    expect(html).toMatch(/role="tab"[^>]*id="info-tab-pinned"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(html).toContain('role="tabpanel" id="info-panel-files" aria-labelledby="info-tab-files"');
  });

  it("«الوسائط»: a tile per picture or video, a video marked by its name, an address that is not ours is never drawn", () => {
    const pages = page([media({ id: "a", name: "صورة.png" }), media({ id: "v", kind: "VIDEO", name: "فيديو.mp4" }), media({ id: "bad", url: "https://elsewhere.example/a.png" })]);
    const html = draw(makeHeader(), { client: seeded({ counts: counts({ IMAGE: 2, VIDEO: 1 }), pages: { media: pages } }) });
    expect(html).toContain('data-info-media-item="a"');
    expect(html).toContain('data-info-media-item="v"');
    expect(html).not.toContain('data-info-media-item="bad"');
    expect(html).not.toContain("elsewhere.example");
    expect(html).toContain(AR["chatinfo.media.video"]!.replace("{name}", "فيديو.mp4"));
    expect(html).toContain('src="/api/chat/attachments/a"');
  });

  it("«الملفات»: the name, the size and the author, a download link on our own address, and «اعرض بالمحادثة»", () => {
    const html = draw(makeHeader(), { client: seeded({ counts: counts({ FILE: 1 }), pages: { files: page([media({ id: "f", kind: "FILE", name: "تقرير.pdf", authorName: "ليلى" })]) } }) });
    expect(html).toContain("تقرير.pdf");
    expect(html).toContain('href="/api/chat/attachments/f"');
    expect(html).toContain("download=");
    expect(html).toContain("ليلى");
    expect(html).toContain('data-info-show="m-f"');
    expect(html).toContain(AR["chatinfo.show"]!);
  });

  it("«الصوتيات»: a player per recording that loads nothing until it is played", () => {
    const html = draw(makeHeader(), { client: seeded({ counts: counts({ AUDIO: 1 }), pages: { voice: page([media({ id: "n", kind: "AUDIO", name: "voice.ogg" })]) } }) });
    expect(html).toMatch(/<audio [^>]*preload="none"[^>]*src="\/api\/chat\/attachments\/n"/);
  });

  it("«الروابط»: the title and the site, opened in a new tab with no referrer; a link that is not http(s) is shown but never made a link", () => {
    const link = (id: string, url: string): LinkItemDto => ({ id, messageId: id, at: "2026-11-02T09:00:00.000Z", authorName: "سلمى", url, title: `عنوان ${id}`, description: null, siteName: "example.com", image: null });
    const html = draw(makeHeader(), { client: seeded({ counts: counts({ LINK: 2 }), pages: { links: page([], [link("l1", "https://example.com/a"), link("l2", "javascript:alert(1)")]) } }) });
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain("عنوان l2");
    expect(html).not.toContain("javascript:alert");
  });

  it("«الشغل»: tasks (a done one marked) and tickets (with their state), each with «اعرض بالمحادثة»", () => {
    const work: ConversationWorkDto = {
      tasks: [
        { id: "t1", key: "ZK-12", title: "جهّزي العرض", done: false, assigneeName: "ليلى", messageId: "m1" },
        { id: "t2", key: "ZK-13", title: "راجعي العقد", done: true, assigneeName: null, messageId: "m2" },
      ],
      tickets: [{ id: "k1", key: "ZK-T4", title: "الطلب متأخر", status: "IN_PROGRESS", assigneeName: "سامر", messageId: "m3" }],
    };
    const html = draw(makeHeader(), { client: seeded({ work }) });
    expect(tabIds(html)).toEqual(["work"]);
    expect(html).toContain('href="/tasks/t1"');
    expect(html).toContain("ZK-12");
    expect(html).toContain(AR["chatinfo.work.done"]!);
    expect(html).toContain('data-info-ticket="k1"');
    expect(html).toContain("ZK-T4");
    expect(html).toContain(AR["tickets.chip.in_progress"]!);
    for (const m of ["m1", "m2", "m3"]) expect(html).toContain(`data-info-show="${m}"`);
  });

  it("«المثبّتة»: the header's pinned messages, nothing asked of the server for them", () => {
    const html = draw(makeHeader({ pinnedMessages: [{ id: "p1", authorName: "ليلى", preview: "اجتماع الخميس" }, { id: "p2", authorName: "سامر", preview: null }] }));
    expect(tabIds(html)).toEqual(["pinned"]);
    expect(html).toContain('data-info-pinned="p1"');
    expect(html).toContain("اجتماع الخميس");
    expect(html).toContain(AR["chatinfo.pinned.empty_preview"]!);
  });

  it("uses theme tokens and logical sides only, with 44 px targets, and no Latin word on screen", () => {
    const work: ConversationWorkDto = { tasks: [{ id: "t1", key: "ZK-12", title: "مهمة", done: true, assigneeName: null, messageId: "m1" }], tickets: [] };
    const html = draw(makeHeader({ pinnedMessages: [{ id: "p1", authorName: "ليلى", preview: "نص" }] }), { client: seeded({ counts: counts({ IMAGE: 1, FILE: 1 }), work, pages: { media: page([media({ id: "a" })]) } }) });
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-(?:white|black)\b/);
    const physical = /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-|$)/;
    expect(classTokens(html).filter((t) => physical.test(t))).toEqual([]);
    expect(classTokens(html)).toContain("min-h-11");
    for (const word of ["Media", "Files", "Links", "Voice", "Work", "Pinned", "undefined", "chatinfo."]) expect(html).not.toContain(word);
  });
});

describe("C3d — the in-chat search", () => {
  const search = (props: Partial<React.ComponentProps<typeof ConversationSearch>> = {}) =>
    renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(ConversationSearch, { conversationId: "c1", onPick: noop, onClose: noop, ...props })));

  it("the OLD screen's search is exactly as it was: the field and «سكّر», nothing of the new controls", () => {
    const html = search();
    expect(html).toContain('type="search"');
    expect(html).not.toContain("data-conversation-search-tools");
    expect(html).not.toContain("data-search-from");
    expect(html).not.toContain("data-search-date");
    expect(html).not.toContain("data-search-step");
    // …even when it is handed the new props without `enhanced`
    expect(search({ people: [{ id: "u1", name: "أحمد" }], onJump: noop })).not.toContain("data-conversation-search-tools");
  });

  it("the new screen's search has «من:» with the people, a date, and the two step buttons (disabled before there is a hit)", () => {
    const html = search({ enhanced: true, people: [{ id: "u1", name: "أحمد" }, { id: "u2", name: "سلمى" }], onJump: noop });
    expect(html).toContain("data-conversation-search-tools");
    expect(html).toContain(AR["chatcs.from"]!);
    expect(html).toMatch(/<select[^>]*data-search-from[^>]*>/);
    expect(html).toMatch(new RegExp(`<option value=""[^>]*>${AR["chatcs.from_all"]!}</option>`));
    expect(html).toContain('<option value="u1">أحمد</option>');
    expect(html).toContain('type="date"');
    expect(html).toMatch(/data-search-step="older"[^>]*disabled/);
    expect(html).toMatch(/data-search-step="newer"[^>]*disabled/);
    expect(html).toContain(AR["chatcs.prev"]!);
    expect(html).toContain(AR["chatcs.next"]!);
  });

  it("no people, no «من:»; the date and the steps stay", () => {
    const html = search({ enhanced: true });
    expect(html).not.toContain("data-search-from");
    expect(html).toContain("data-search-date");
  });

  it("the pane asks for the new search with the conversation's people and keeps it open on a jump (read from the source)", () => {
    const pane = read("src/components/chat/v2/pane/conversation-pane.tsx");
    expect(pane).toMatch(/<ConversationSearch[\s\S]*?enhanced[\s\S]*?people=\{members\}[\s\S]*?onJump=\{a\.jumpTo\}/);
    // the old screen does not pass it
    expect(read("src/components/chat/conversation/conversation-screen.tsx")).not.toContain("enhanced");
  });
});

describe("C3d — the list's search results", () => {
  const results = (data: ChatListSearchDto) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(ListSearchResults, { data, onPick: noop })));
  const data: ChatListSearchDto = {
    chats: [
      { id: "c9", kind: "TOPIC", title: "طلبات اليوم", emoji: "📦", context: "المبيعات" },
      { id: "d1", kind: "DM", title: "سلمى", emoji: null, context: null },
      { id: "s1", kind: "SPACE", title: "المبيعات", emoji: null, context: null },
    ],
    people: [
      { id: "u1", name: "أحمد", avatarUrl: null, jobTitle: "مدير", dmId: "d7" },
      { id: "u2", name: "ليلى", avatarUrl: null, jobTitle: null, dmId: null },
    ],
    messages: [{ id: "m1", conversationId: "c9", conversationTitle: "طلبات اليوم", authorName: "سامر", at: "2026-11-02T09:00:00.000Z", snippet: "وصلت الشحنة" }],
  };

  it("three sections, each link where it should go: a topic and a private chat to their conversation, a space to its forum, a message around itself", () => {
    const html = results(data);
    for (const key of ["chatls.chats", "chatls.people", "chatls.messages"]) expect(html).toContain(AR[key]!);
    expect(html).toContain('href="/chat/c9"');
    expect(html).toContain('href="/chat/d1"');
    expect(html).toContain('href="/chat/s/s1"');
    expect(html).toContain('href="/chat/c9?m=m1"');
    expect(html).toContain("وصلت الشحنة");
    expect(html).toContain(AR["chatls.space"]!);
  });

  it("a person with a private chat open is a link to it; one without is a button that opens it; a guest's row (the name only) is neither", () => {
    const html = results({ ...data, people: [...data.people, { id: "g1", name: "ضيف" }] });
    expect(html).toContain('href="/chat/d7"');
    expect(html).toMatch(/<button[^>]*data-list-search-person="u2"/);
    expect(html).toMatch(/<li data-list-search-person="g1"/);
    expect(html).not.toMatch(/<(?:a|button)[^>]*data-list-search-person="g1"/);
    expect(html).toContain("مدير");
  });

  it("a section with nothing in it is not drawn", () => {
    const html = results({ chats: [], people: [], messages: data.messages });
    expect(html).toContain(AR["chatls.messages"]!);
    expect(html).not.toContain(AR["chatls.chats"]!);
    expect(html).not.toContain(AR["chatls.people"]!);
  });

  it("the headers draw no panel and no wrapper change while nothing is typed (the old screens' markup is the same)", () => {
    const header = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(ListHeader, { query: "", onQuery: noop, searchId: "s" })));
    expect(header).not.toContain("data-list-search-panel");
    const typed = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(ListHeader, { query: "طلب", onQuery: noop, searchId: "s" })));
    // asked for after a pause, in an effect: the first paint has no panel
    expect(typed).not.toContain("data-list-search-panel");
    const bar = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(PhoneListBar, { title: "زاكي", query: "طلب", onQuery: noop, searchId: "s" })));
    expect(bar).toContain("data-chat-phone-search=\"open\"");
    expect(bar).not.toContain("data-list-search-panel");
  });

  it("the headers mount the panel (read from the source), and the results use theme tokens only", () => {
    expect(read("src/components/chat/v2/list/list-header.tsx")).toContain("<ListSearchPanel query={query}");
    expect(read("src/components/chat/v2/phone/list-bar.tsx")).toContain("<ListSearchPanel query={query} onPick={fold} />");
    const html = results(data);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-(?:white|black)\b/);
    const physical = /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-|$)/;
    expect(classTokens(html).filter((t) => physical.test(t))).toEqual([]);
  });
});

describe("C3d — where it is wired (read from the source: there is no browser here)", () => {
  it("the pane wraps its messages in the media viewer's provider with the conversation id (so the viewer reads `GET …/media`) and gives the info panel its jump", () => {
    const pane = read("src/components/chat/v2/pane/conversation-pane.tsx");
    expect(pane).toContain("<MediaViewerProvider messages={history.messages} conversationId={header.id} onShowInChat={commands.jumpTo}>");
    expect(pane).toContain("InfoJumpContext.Provider");
    // the sheet covers the conversation: it is closed before the jump; the docked column stays
    expect(pane).toMatch(/if \(!docked\) commands\.closeInfo\(\)/);
  });

  it("the panel mounts the tabs and still imports nothing of the pane's provider", () => {
    const panel = read("src/components/chat/v2/info/info-panel.tsx");
    expect(panel).toContain("<InfoTabs header={header} />");
    for (const file of ["info-panel.tsx", "info-tabs.tsx", "info-jump.tsx", "list-search-results.tsx"]) {
      expect(read(`src/components/chat/v2/info/${file}`), file).not.toContain("pane-actions");
    }
  });

  it("the tabs ask only the two doors of the media route and never filter a privacy rule themselves", () => {
    const hooks = read("src/lib/chat/v2/info/use-info-tabs.ts");
    expect(hooks).toContain("mediaCountsUrl");
    expect(hooks).toContain("workUrl");
    expect(read("src/lib/chat/v2/info/info-tabs.ts")).toContain("/media/work");
    expect(read("src/components/chat/v2/media-viewer.tsx")).toContain('mediaPageUrl(conversationId, "MEDIA", before)');
  });
});

describe("C3d — the review's fixes (read from the source: there is no browser here)", () => {
  it("the open tabs ask again when a message arrives or is deleted: the panel subscribes to the chat cache and marks the counts, the work and the lists stale", () => {
    const hooks = read("src/lib/chat/v2/info/use-info-tabs.ts");
    expect(hooks).toContain("getQueryCache().subscribe(");
    expect(hooks).toContain("invalidateQueries");
    expect(read("src/components/chat/v2/info/info-tabs.tsx")).toContain("useRefreshOnMessages(header.id)");
  });

  it("the viewer forgets what an earlier opening fetched before it fetches again", () => {
    expect(read("src/components/chat/v2/media-viewer.tsx")).toMatch(/if \(!open \|\| !conversationId\) return;[\s\S]*?setFetched\(null\);[\s\S]*?new AbortController\(\)/);
  });

  it("clearing the in-chat search takes the failure line away with the hits", () => {
    expect(read("src/components/chat/conversation/conversation-search.tsx")).toMatch(/if \(!asked\) \{\s*setHits\(null\);\s*setActive\(null\);\s*setFailed\(false\);/);
  });
});
