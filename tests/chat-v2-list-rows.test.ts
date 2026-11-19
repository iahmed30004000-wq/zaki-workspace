import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const where = vi.hoisted(() => ({ pathname: "/chat" }));
vi.mock("next/navigation", () => ({
  usePathname: () => where.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ChatListColumn } from "@/components/chat/v2/list/chat-list-column";
import { ChatRowItem, ROW_HEIGHT, ROW_HEIGHT_PHONE, RowView, rowHref } from "@/components/chat/v2/list/chat-row";
import { CompanyRowsView, companyTitle } from "@/components/chat/v2/list/company-rows";
import { FolderTabs } from "@/components/chat/v2/list/folder-tabs";
import { PersonalMenuItems, rowHasMenu } from "@/components/chat/v2/row-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { foldersOf } from "@/lib/chat/list-folders";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { ChatListDto, ChatRowDto } from "@/lib/chat/cache/types";
import { I18nProvider } from "@/lib/i18n";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";

/**
 * C2.2 — the rows of the list, the folder tabs and the whole column rendered on the server from a seeded cache: every kind of row of the spec
 * (a space with its chips, a private chat typing, a draft, muted, a mention), the privacy of the rows, and the shape of the column.
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (node: React.ReactElement, qc = new QueryClient()) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: qc }, node)));

const NOW = new Date("2026-11-17T15:00:00");
const iso = (hhmm: string) => new Date(`2026-11-17T${hhmm}:00`).toISOString();
const row = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto => ({
  id,
  kind: "DM",
  title: `محادثة ${id}`,
  emoji: null,
  space: null,
  lastMessage: null,
  unread: 0,
  mentionsUnread: 0,
  muted: false,
  pinnedByMe: false,
  archivedByMe: false,
  markedUnread: false,
  restricted: false,
  ...over,
});
const msg = (over: Record<string, unknown> = {}) => ({ id: "m1", authorName: "سلمى", preview: "وصلت الشحنة", kind: "TEXT" as const, at: iso("09:05"), mine: false, ...over });
const view = (r: ChatRowDto, extra: Partial<React.ComponentProps<typeof RowView>> = {}) => render(createElement(RowView, { row: r, selected: false, now: NOW, ...extra }));

describe("a space row (a forum): the owner's screenshot", () => {
  const space = row("sp1", {
    kind: "SPACE",
    title: "مبيعات",
    space: { id: "sp1", name: "مبيعات" },
    unread: 5,
    lastMessage: msg(),
    topicChips: [
      { id: "t1", title: "الطلبات", emoji: "📦", unread: 3 },
      { id: "t2", title: "الشحن", emoji: null, unread: 0 },
      { id: "t3", title: "عام", emoji: "💬", unread: 0 },
    ],
  });

  it("is ONE row: the name, the people icon, up to three topic chips (unread ones bold) and the newest message «فلان: …»", () => {
    const html = view(space);
    expect(html).toContain("<bdi>مبيعات</bdi>");
    expect(html).toContain('data-kind="SPACE"');
    expect(html).toContain('aria-label="مساحة"');
    expect(html.match(/href="\/chat\/t\d"/g)).toHaveLength(3);
    expect(html).toContain("<bdi>الطلبات</bdi>");
    expect(html).toContain("📦");
    expect(html).toContain("سلمى: ");
    expect(html).toContain("وصلت الشحنة");
    expect(html).toContain(">5<");
  });

  it("clicking the row opens the forum view; clicking a chip opens that topic", () => {
    const html = view(space);
    expect(rowHref(space)).toBe("/chat/s/sp1");
    expect(html).toContain('href="/chat/s/sp1"');
    expect(html).toContain('href="/chat/t1"');
    // the row's own link is not nested in another link: the chips are siblings of it, above it
    expect(html).not.toMatch(/<a[^>]*>(?:(?!<\/a>).)*<a /);
  });

  it("an unread chip is bold and in the accent; a read one is plain and quiet", () => {
    const html = view(space);
    const chip = (title: string) => html.match(new RegExp(`<a[^>]*class="([^"]*)"[^>]*><span aria-hidden="true">[^<]*</span><span class="truncate"><bdi>${title}</bdi>`))?.[1] ?? "";
    expect(chip("الطلبات")).toContain("font-semibold");
    expect(chip("الطلبات")).toContain("text-accent");
    expect(chip("الشحن")).toContain("font-normal");
  });

  it("a chip without an emoji gets the hash sign", () => {
    expect(view(space)).toContain("#</span>");
  });
});

describe("a private chat row", () => {
  it("the person's name, the preview plain (no author), the time, the ticks of my own last message", () => {
    const html = view(row("dm1", { title: "أحمد", lastMessage: msg({ mine: true, status: "read", preview: "تمام" }) }));
    expect(html).toContain("<bdi>أحمد</bdi>");
    expect(html).toContain("<bdi>تمام</bdi>");
    expect(html).not.toContain("أنت: ");
    expect(html).toContain('aria-label="انقرأت"');
    expect(html).toContain(">09:05<");
  });

  it("while the other person types the second line is «عم يكتب…» in the accent, instead of the message", () => {
    const html = view(row("dm1", { lastMessage: msg() }), { typingNames: ["سلمى"] });
    expect(html).toContain('data-row-preview="typing"');
    expect(html).toContain("عم يكتب…");
    expect(html).not.toContain("وصلت الشحنة");
    expect(html).toMatch(/data-row-preview="typing"/);
  });

  it("a local draft shows «مسودة:» in the danger colour and the draft's words", () => {
    const html = view(row("dm1", { lastMessage: msg() }), { draft: "بدي أسألك عن السعر" });
    expect(html).toContain('data-row-preview="draft"');
    expect(html).toContain("text-danger");
    expect(html).toContain("مسودة: ");
    expect(html).toContain("بدي أسألك عن السعر");
    expect(html).not.toContain("وصلت الشحنة");
  });

  it("typing wins over a draft", () => {
    expect(view(row("dm1", { lastMessage: msg() }), { typingNames: ["سلمى"], draft: "مسودة" })).toContain('data-row-preview="typing"');
  });

  it("a muted chat: the bell-off icon, and its unread pill is grey, not the accent", () => {
    const html = view(row("dm1", { muted: true, unread: 4, lastMessage: msg() }));
    expect(html).toContain('aria-label="مكتوم"');
    const pill = html.match(/data-unread-pill="" class="([^"]*)"/)?.[1] ?? "";
    expect(pill).toContain("bg-surface-2");
    expect(pill).not.toContain("bg-accent");
  });

  it("an unmuted unread chat has the accent pill and a heavier title", () => {
    const html = view(row("dm1", { unread: 4, lastMessage: msg() }));
    const pill = html.match(/data-unread-pill="" class="([^"]*)"/)?.[1] ?? "";
    expect(pill).toContain("bg-accent");
    expect(pill).toContain("text-accent-fg");
    expect(html).toContain("font-semibold");
  });

  it("a mention: the «@» badge beside the pill", () => {
    const html = view(row("dm1", { unread: 2, mentionsUnread: 1, lastMessage: msg() }));
    expect(html).toContain('aria-label="فيه رسالة بتذكرك"');
    expect(html).toMatch(/>@</);
  });

  it("nothing unread and pinned: the pin takes the pill's place; a read, unpinned chat has neither", () => {
    expect(view(row("t", { kind: "TOPIC", pinned: true, lastMessage: msg() }))).toContain('aria-label="مثبّت"');
    expect(view(row("t", { kind: "TOPIC", pinned: true, unread: 2, lastMessage: msg() }))).not.toContain('aria-label="مثبّت"');
    const plain = view(row("dm1", { lastMessage: msg() }));
    expect(plain).not.toContain("data-unread-pill");
    expect(plain).not.toContain('aria-label="مثبّت"');
  });

  it("marked unread by hand (C3a) with no count: a pill without a number", () => {
    const html = view(row("dm1", { markedUnread: true, lastMessage: msg() }));
    expect(html).toContain("data-unread-pill");
    expect(html).toContain("معلّمة غير مقروءة");
  });
});

describe("a topic row", () => {
  it("its emoji in a circle, the author in front of the preview, the lock and the word «خاص» for a private one — never who is in it", () => {
    const html = view(row("t1", { kind: "TOPIC", title: "سري", emoji: "🔒", restricted: true, lastMessage: msg() }));
    expect(html).toContain("🔒");
    expect(html).toContain('aria-label="خاص"');
    expect(html).toContain("سلمى: ");
    expect(html).toContain('href="/chat/t1"');
  });
  it("an announcements topic carries the megaphone, a closed one says so", () => {
    const html = view(row("t1", { kind: "TOPIC", topicType: "ANNOUNCEMENTS", closed: true, lastMessage: msg() }));
    expect(html).toContain('aria-label="تنبيهات"');
    expect(html).toContain('aria-label="مغلق"');
  });
  it("a deleted last message says «رسالة محذوفة» and shows no text", () => {
    const html = view(row("t1", { kind: "TOPIC", lastMessage: msg({ preview: null }) }));
    expect(html).toContain("رسالة محذوفة");
    expect(html).not.toContain("وصلت الشحنة");
  });
});

describe("the selected row and the heights", () => {
  it("the open conversation's row is the accent with the accent's own text colour, and is marked as the current page", () => {
    const html = view(row("dm1", { lastMessage: msg() }), { selected: true });
    expect(html).toContain('data-selected="true"');
    expect(html).toContain("bg-accent text-accent-fg");
    expect(html).toContain('aria-current="page"');
    expect(view(row("dm1"))).not.toContain("aria-current");
  });
  it("72 px on the computer, 76 px on the phone", () => {
    expect(ROW_HEIGHT).toBe(72);
    expect(ROW_HEIGHT_PHONE).toBe(76);
    expect(view(row("a"))).toContain("height:72px");
    expect(view(row("a"), { tall: true })).toContain("height:76px");
  });
  it("logical sides, theme tokens only", () => {
    const html = view(row("sp", { kind: "SPACE", unread: 1, mentionsUnread: 1, muted: true, lastMessage: msg({ mine: true }), topicChips: [{ id: "t", title: "ت", emoji: null, unread: 1 }] }), { typingNames: ["سلمى"], draft: "x" });
    const tokens = classTokens(html);
    expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t))).toEqual([]);
    expect(tokens.filter((t) => PALETTE_COLOUR.test(t))).toEqual([]);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe("a row subscribes to ITSELF (the structure that makes one new message re-render one row)", () => {
  const rowSrc = readFileSync(path.join(process.cwd(), "src/components/chat/v2/list/chat-row.tsx"), "utf8");
  const virtualSrc = readFileSync(path.join(process.cwd(), "src/components/chat/v2/list/virtual-rows.tsx"), "utf8");
  it("the connected row is memoized, reads itself by id, and takes the selection as a boolean", () => {
    expect((ChatRowItem as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
    expect(rowSrc).toContain("useChatRow(id)");
    expect(rowSrc).toMatch(/selected: boolean;/);
    expect(virtualSrc).toContain("selected={selectedId === item.id}");
  });
  it("virtual: @tanstack/react-virtual, 8 rows of overscan, 72 / 76 px", () => {
    expect(virtualSrc).toContain('from "@tanstack/react-virtual"');
    expect(virtualSrc).toContain("export const OVERSCAN = 8;");
    expect(virtualSrc).toContain("overscan: OVERSCAN");
    expect(virtualSrc).toContain("rowHeight = tall ? ROW_HEIGHT_PHONE : ROW_HEIGHT");
  });
});

describe("the folder tabs", () => {
  it("draw the folders in order with the badges, the active one selected", () => {
    const html = render(createElement(FolderTabs, { folders: foldersOf({ canOversee: false }), active: "unread", badges: { unread: 3, mentions: 120 }, onChange: () => {} }));
    expect(textOf(html)).toBe("الكل غير مقروء 3 خاص المساحات ذكروني 99+");
    expect(html).toContain('role="tablist"');
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*data-folder="unread"/);
  });
  it("«كل الشركة» only for an oversight holder", () => {
    const plain = render(createElement(FolderTabs, { folders: foldersOf({ canOversee: false }), active: "all", badges: {}, onChange: () => {} }));
    const holder = render(createElement(FolderTabs, { folders: foldersOf({ canOversee: true }), active: "all", badges: {}, onChange: () => {} }));
    expect(plain).not.toContain("كل الشركة");
    expect(holder).toContain("كل الشركة");
  });
});

describe("«كل الشركة»: today's rule — the rows say nothing about reading", () => {
  const items = [
    { id: "c1", kind: "DM" as const, title: "", emoji: null, spaceId: null, spaceName: null, membersCount: 2, lastMessageAt: iso("08:00"), names: ["سارة", "أحمد"] },
    { id: "c2", kind: "TOPIC" as const, title: "الطلبات", emoji: null, spaceId: "s", spaceName: "مبيعات", membersCount: 9, lastMessageAt: null },
  ];
  const html = render(createElement(CompanyRowsView, { items, more: true, loading: false, failed: false, onRetry: () => {}, selectedId: "c2" }));
  it("a private chat is «خاص: سارة وأحمد», a topic its title with its space and size; both open the conversation", () => {
    expect(companyTitle(items[0]!)).toBe("خاص: سارة وأحمد");
    expect(html).toContain("خاص: سارة وأحمد");
    expect(html).toContain("مبيعات · 9 مشاركين");
    expect(html).toContain('href="/chat/c1"');
    expect(html).toContain("توجد نتائج إضافية غير معروضة.");
  });
  it("no unread number, no tick, no pill, no «seen»: nothing of reading", () => {
    expect(html).not.toContain("data-unread-pill");
    expect(html).not.toContain("انقرأت");
    expect(html).not.toContain("غير مقروء");
    expect(html).not.toContain("<svg class=\"lucide lucide-check");
  });
  it("the screen says, once, that this reading is silent", () => {
    expect(html).toContain("قراءةً صامتة");
  });
});

describe("the whole column, from a seeded cache", () => {
  const dto = (rows: ChatRowDto[], canOversee = false): ChatListDto => ({ scope: "all", spaceId: null, canOversee, rows });
  const seeded = (list: ChatListDto) => {
    const qc = new QueryClient();
    installChatDefaults(qc);
    qc.setQueryData(chatKeys.list(), list);
    return qc;
  };
  const props = { variant: "column" as const, userId: "u1", guest: false, canMeet: false, rowMenu: true, canPurge: false };
  const rows = [
    row("sp1", { kind: "SPACE", title: "مبيعات", unread: 3, lastMessage: msg(), topicChips: [{ id: "t1", title: "الطلبات", emoji: "📦", unread: 3 }] }),
    row("dm1", { title: "أحمد", unread: 2, lastMessage: msg({ at: iso("08:00") }) }),
    row("dm2", { title: "سارة", lastMessage: msg({ at: iso("07:00") }) }),
  ];

  it("paints the rows from the cache at once: the search field, the folders with their badges, the rows in the server's order", () => {
    where.pathname = "/chat";
    const html = render(createElement(ChatListColumn, props), seeded(dto(rows)));
    expect(html).toContain('data-chat-list="column"');
    expect(html).toContain('type="search"');
    expect(html).toContain('placeholder="بحث"');
    expect(html.indexOf("مبيعات")).toBeLessThan(html.indexOf("أحمد"));
    expect(html.indexOf("أحمد")).toBeLessThan(html.indexOf("سارة"));
    expect(html).toContain('data-folder="unread"');
    expect(html).not.toContain("كل الشركة");
    expect(html).not.toContain("data-chat-loading");
  });

  it("the column has the resize handle (a separator between 300 and 480) on the computer, and none on the phone", () => {
    where.pathname = "/chat";
    const column = render(createElement(ChatListColumn, props), seeded(dto(rows)));
    expect(column).toContain('role="separator"');
    expect(column).toContain('aria-valuemin="300"');
    expect(column).toContain('aria-valuemax="480"');
    expect(column).toContain("width:360px");
    const phone = render(createElement(ChatListColumn, { ...props, variant: "screen" }), seeded(dto(rows)));
    expect(phone).not.toContain('role="separator"');
    expect(phone).toContain('data-chat-list="screen"');
    expect(phone).toContain("data-chat-fab");
    expect(phone).toContain("height:76px");
  });

  it("the new-message button is a round one at the bottom END on the phone and a pencil in the header on the computer (hidden by CSS from the other size)", () => {
    where.pathname = "/chat";
    const phone = render(createElement(ChatListColumn, { ...props, variant: "screen" }), seeded(dto(rows)));
    const fab = phone.match(/<button[^>]*data-chat-fab[^>]*>/)?.[0] ?? "";
    expect(fab).toContain("end-4");
    expect(fab).toContain("bottom-");
    expect(fab).toContain("md:hidden");
    expect(fab).not.toMatch(/\bleft-|\bright-/);
    const column = render(createElement(ChatListColumn, props), seeded(dto(rows)));
    expect(column).not.toContain("data-chat-fab");
    expect(column).toMatch(/<button[^>]*aria-label="رسالة جديدة"[^>]*md:grid/);
  });

  it("«كل الشركة» appears only when the SERVER's list says canOversee", () => {
    where.pathname = "/chat";
    expect(render(createElement(ChatListColumn, props), seeded(dto(rows, true)))).toContain("كل الشركة");
    expect(render(createElement(ChatListColumn, props), seeded(dto(rows, false)))).not.toContain("كل الشركة");
  });

  it("a guest: no «خاص» folder, no new-message button, no «كل الشركة»", () => {
    where.pathname = "/chat";
    const html = render(createElement(ChatListColumn, { ...props, guest: true, variant: "screen" }), seeded(dto([rows[0]!], true)));
    expect(html).not.toContain('data-folder="dm"');
    expect(html).not.toContain("كل الشركة");
    expect(html).not.toContain("data-chat-fab");
    expect(html).not.toContain('aria-label="رسالة جديدة"');
  });

  it("the open conversation's row is selected (the route decides)", () => {
    where.pathname = "/chat/dm2";
    const html = render(createElement(ChatListColumn, props), seeded(dto(rows)));
    expect(html.match(/data-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-row-id="dm2"[^>]*data-selected="true"|data-selected="true"[^>]*data-row-id="dm2"/);
    where.pathname = "/chat";
  });

  it("no data and no answer yet: a skeleton, never the empty sentence", () => {
    where.pathname = "/chat";
    const html = render(createElement(ChatListColumn, props), new QueryClient());
    expect(html).toContain("data-chat-loading");
    expect(html).not.toContain("لست في أي مساحة بعد");
  });

  it("an empty list says so", () => {
    where.pathname = "/chat";
    const html = render(createElement(ChatListColumn, props), seeded(dto([])));
    expect(html).toContain("لست في أي مساحة بعد.");
    expect(html).not.toContain("data-chat-loading");
  });

  it("a topic of the person's own is listed in the one-space shape too: the column draws whatever shape the server answered", () => {
    where.pathname = "/chat";
    const oneSpace: ChatListDto = { scope: "space", spaceId: "s1", canOversee: false, rows: [row("t1", { kind: "TOPIC", title: "عام", lastMessage: msg() }), row("dm1", { title: "أحمد" })] };
    const html = render(createElement(ChatListColumn, props), seeded(oneSpace));
    expect(html).toContain("<bdi>عام</bdi>");
    expect(html).toContain("<bdi>أحمد</bdi>");
    expect(html).toContain('href="/chat/t1"');
  });
});

describe("a refresh that failed while the list holds rows", () => {
  it("says so, with the way to try again, above the rows it still shows (a stale copy is never silent)", () => {
    where.pathname = "/chat";
    const qc = new QueryClient();
    installChatDefaults(qc);
    const rows = [row("dm1", { title: "أحمد", unread: 1, lastMessage: msg() })];
    qc.setQueryData(chatKeys.list(), { scope: "all", spaceId: null, canOversee: false, rows } satisfies ChatListDto);
    const props = { variant: "column" as const, userId: "u1", guest: false, canMeet: false, rowMenu: true, canPurge: false };
    expect(render(createElement(ChatListColumn, props), qc)).not.toContain('role="alert"');
    qc.getQueryCache().find({ queryKey: chatKeys.list() })!.setState({ status: "error", error: new Error("x"), errorUpdateCount: 1, errorUpdatedAt: Date.now(), fetchStatus: "idle" });
    const html = render(createElement(ChatListColumn, props), qc);
    expect(html).toContain('role="alert"');
    expect(html).toContain("تعذّر تحميل المحادثات.");
    expect(html).toContain("<bdi>أحمد</bdi>");
    expect(html.indexOf("تعذّر تحميل المحادثات.")).toBeLessThan(html.indexOf("<bdi>أحمد</bdi>"));
  });
});

// ───────────────────────────── C3a.1: my own pin, archive, mark unread and mute ─────────────────────────────
describe("C3a.1 — the personal items of the row menu", () => {
  const menuOf = (r: ChatRowDto) =>
    render(
      createElement(
        DropdownMenu,
        { open: true },
        createElement(DropdownMenuTrigger, null, "س"),
        createElement(DropdownMenuContent, { portal: false }, createElement(PersonalMenuItems, { row: r, call: async () => true })),
      ),
    );

  it("a chat that is none of pinned, archived, muted or unread offers: pin, archive, mark unread, and the mute presets (an hour, 8 hours, a day, a week, for good)", () => {
    const html = menuOf(row("dm1", { lastMessage: msg() }));
    const text = textOf(html);
    for (const word of ["تثبيت بقائمتي", "أرشفة", "علّم كغير مقروء", "كتم الإشعارات", "ساعة", "8 ساعات", "يوم", "أسبوع", "للأبد"]) expect(text, word).toContain(word);
    for (const word of ["إلغاء التثبيت", "إخراج من الأرشيف", "علّم كمقروء", "رفع الكتم"]) expect(text, word).not.toContain(word);
    expect(html.match(/role="menuitem"/g)).toHaveLength(8);
  });

  it("a pinned, archived, muted chat offers the way back instead: unpin, take out of the archive, lift the mute (and no presets)", () => {
    const text = textOf(menuOf(row("dm1", { pinnedByMe: true, archivedByMe: true, muted: true })));
    for (const word of ["إلغاء التثبيت", "إخراج من الأرشيف", "رفع الكتم"]) expect(text, word).toContain(word);
    for (const word of ["تثبيت بقائمتي", "أرشفة", "8 ساعات", "للأبد"]) expect(text, word).not.toContain(word);
  });

  it("a chat with something unread, or marked unread by hand, offers «علّم كمقروء» instead of «علّم كغير مقروء»", () => {
    expect(textOf(menuOf(row("dm1", { unread: 3 })))).toContain("علّم كمقروء");
    expect(textOf(menuOf(row("dm1", { markedUnread: true })))).toContain("علّم كمقروء");
    expect(textOf(menuOf(row("dm1", { unread: 3 })))).not.toContain("علّم كغير مقروء");
  });

  it("a space row is not a conversation: nothing personal for it", () => {
    expect(textOf(menuOf(row("sp1", { kind: "SPACE" })))).not.toContain("تثبيت");
  });

  it("no Latin letters on the screen", () => {
    expect(textOf(menuOf(row("dm1")))).not.toMatch(/[A-Za-z]/);
  });

  it("the menu exists for a chat on the personal switch alone; each switch has its own say", () => {
    const off = { enabled: false, canPurge: false, canModerate: false };
    expect(rowHasMenu(row("dm1"), off)).toBe(true);
    expect(rowHasMenu(row("dm1"), { ...off, personal: false })).toBe(false);
    expect(rowHasMenu(row("sp1", { kind: "SPACE" }), off)).toBe(false);
    // the managers' items still come from today's menu switch and rank, as before
    expect(rowHasMenu(row("t1", { kind: "TOPIC" }), { enabled: true, canPurge: false, canModerate: true, personal: false })).toBe(true);
    expect(rowHasMenu(row("t1", { kind: "TOPIC" }), { enabled: false, canPurge: false, canModerate: true, personal: false })).toBe(false);
  });

  it("a connected row draws the «⋮» for a chat when the list says the switch is on, and nothing when the list says it is off", () => {
    where.pathname = "/chat";
    const dm = row("dm1", { title: "أحمد", lastMessage: msg() });
    const menuCtx = { enabled: false, canPurge: false, canModerate: false };
    const draw = (personal: boolean | undefined) => {
      const qc = new QueryClient();
      installChatDefaults(qc);
      qc.setQueryData(chatKeys.list(), { scope: "all", spaceId: null, canOversee: false, rows: [dm], ...(personal === undefined ? {} : { personal }) } satisfies ChatListDto);
      return render(createElement(ChatRowItem, { id: "dm1", selected: false, tall: false, userId: "u1", menu: menuCtx, day: "2026-11-17" }), qc);
    };
    expect(draw(true)).toContain('aria-label="خيارات «أحمد»"');
    expect(draw(undefined)).toContain('aria-label="خيارات «أحمد»"'); // a copy saved before the switch existed reads as on
    expect(draw(false)).not.toContain("خيارات");
  });
});

describe("C3a.1 — the archived row and the «الأرشيف» tab", () => {
  it("an archived row carries the archive icon, with its spoken name", () => {
    const html = view(row("dm1", { archivedByMe: true, lastMessage: msg() }));
    expect(html).toContain('aria-label="مؤرشفة"');
    expect(view(row("dm1", { lastMessage: msg() }))).not.toContain("مؤرشفة");
  });

  it("a row marked unread by hand still draws its (empty) pill, with the sentence for the screen reader; a pinned one draws the pin when nothing is unread", () => {
    expect(view(row("dm1", { markedUnread: true, lastMessage: msg() }))).toContain("معلّمة غير مقروءة");
    expect(view(row("dm1", { pinnedByMe: true, lastMessage: msg() }))).toContain('aria-label="مثبّت"');
  });

  const dto = (rows: ChatRowDto[], over: Partial<ChatListDto> = {}): ChatListDto => ({ scope: "all", spaceId: null, canOversee: false, rows, ...over });
  const seeded = (list: ChatListDto) => {
    const qc = new QueryClient();
    installChatDefaults(qc);
    qc.setQueryData(chatKeys.list(), list);
    return qc;
  };
  const props = { variant: "column" as const, userId: "u1", guest: false, canMeet: false, rowMenu: true, canPurge: false };
  const rows = [row("dm1", { title: "أحمد", lastMessage: msg() }), row("dm2", { title: "سارة", archivedByMe: true, unread: 2, lastMessage: msg({ at: iso("07:00") }) })];

  it("an archived chat is out of the main list, and the column offers «الأرشيف» after the other tabs — only while there is one", () => {
    where.pathname = "/chat";
    const html = render(createElement(ChatListColumn, props), seeded(dto(rows)));
    expect(html).toContain('data-folder="archived"');
    expect(html).toContain("الأرشيف");
    expect(html).not.toContain("<bdi>سارة</bdi>");
    expect(html).toContain("<bdi>أحمد</bdi>");
    expect(html.indexOf('data-folder="mentions"')).toBeLessThan(html.indexOf('data-folder="archived"'));
    expect(render(createElement(ChatListColumn, props), seeded(dto([rows[0]!])))).not.toContain('data-folder="archived"');
  });

  it("switched off: no tab, and no archived chat is hidden (the server sends none as archived)", () => {
    where.pathname = "/chat";
    const html = render(createElement(ChatListColumn, props), seeded(dto(rows, { personal: false })));
    expect(html).not.toContain('data-folder="archived"');
  });

  it("the Q1 rows still draw: a card line, a poll, a deleted message, a mention", () => {
    const html = view(row("dm1", { mentionsUnread: 1, unread: 1, lastMessage: msg({ kind: "CARD", preview: "بطاقة المنتج" }) }));
    expect(html).toContain("🧾 بطاقة المنتج");
    expect(html).toContain('aria-label="فيه رسالة بتذكرك"');
  });
});
