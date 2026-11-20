import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

// the policy module loads the DB client at import; these tests only use its pure functions
vi.mock("@/server/db", () => ({ db: {} }));
const where = vi.hoisted(() => ({ pathname: "/chat" }));
vi.mock("next/navigation", () => ({
  usePathname: () => where.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { canModerate, canPost, type ConversationFacts, type OrgFacts } from "@/server/policy/conversation";
import { menuFor, menuOpen, messageMenuItems, V2_MENU_ORDER, type MessageMenuContext, type MessageMenuId } from "@/components/chat/message/message-menu-registry";
import { ChatListColumn } from "@/components/chat/v2/list/chat-list-column";
import { RowView } from "@/components/chat/v2/list/chat-row";
import { MessageMenuV2 } from "@/components/chat/v2/menu/message-menu-v2";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { ChatListDto, ChatRowDto } from "@/lib/chat/cache/types";
import { isSavedHeader, isSavedRow, keepInSaved, menuContextV2, openSavedId, savedFlagsOf } from "@/lib/chat/v2/menu/menu-context";
import { openSavedChat, savedShortcutOf, shortcutOf, SHORTCUT_ROWS, SAVED_SHORTCUT, type KeyEventLike } from "@/lib/chat/shortcuts";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";

/**
 * C2.6 — the registry is still the ONE source of the menu, and it learned five ids for the new screen: «نسخ الرابط» (copyLink), «اقرأ النص» (readText),
 * «حوّل الصوت لنص» (transcribe), «مين شاف» (seen) and «اسألي مشرفتك» (ask). «حدّد» is C3b.5: it has no action yet, so its id is NOT added.
 *
 * The new ids are opt-in (`surface: "v2"`): the OLD screen (and the quick chat) has no handler for them, so an id it cannot run must never reach it.
 * Per permission, as in `chat-message-menu.test.ts`: a member, a moderator, a guest, the owner reading silently, a deleted message, a system line.
 */
const NEW_IDS: MessageMenuId[] = ["copyLink", "readText", "transcribe", "seen", "ask", "saved"];

type Who = { name: string; role: OrgFacts["role"]; spaceRole: ConversationFacts["viewerSpaceRole"]; member: boolean };
const WHO: Who[] = [
  { name: "member", role: "MEMBER", spaceRole: "MEMBER", member: true },
  { name: "moderator (space admin)", role: "MEMBER", spaceRole: "ADMIN", member: true },
  { name: "guest", role: "GUEST", spaceRole: "GUEST", member: true },
  { name: "owner, joined", role: "OWNER", spaceRole: null, member: true },
  { name: "owner, silent oversight", role: "OWNER", spaceRole: null, member: false },
];

const facts = (w: Who): ConversationFacts => ({
  kind: "TOPIC",
  orgId: "o1",
  spaceId: "s1",
  restricted: false,
  closedAt: null,
  postingPolicy: "ALL",
  teamId: null,
  viewerInTeam: false,
  topicType: "DISCUSSION",
  viewerIsMember: w.member,
  viewerGroupRole: null,
  viewerSpaceRole: w.spaceRole,
  mutedUntil: null,
  dmOtherActive: true,
  memberIds: [],
});

/** The v2 context of a person, with every switch of the new items on: what is left out is the registry's own rule. */
const ctx = (w: Who, over: Partial<MessageMenuContext> = {}): MessageMenuContext => {
  const f = facts(w);
  const org: OrgFacts = { orgId: "o1", role: w.role, status: "ACTIVE" };
  return {
    mine: false,
    deleted: false,
    kind: "TEXT",
    hasText: true,
    pinned: false,
    conversationKind: "TOPIC",
    canPost: canPost(f, org, { ownerJoined: f.viewerIsMember }),
    canModerate: canModerate(f, org),
    oversight: org.role === "OWNER" && !f.viewerIsMember,
    surface: "v2",
    canReadText: true,
    canTranscribe: true,
    readerCount: 3,
    canAsk: true,
    ...over,
  };
};
const ids = (c: MessageMenuContext): MessageMenuId[] => menuFor(c).map((i) => i.id);

describe("«نسخ الرابط» (copyLink): anybody who reads the message", () => {
  for (const w of WHO) {
    for (const mine of [true, false]) {
      it(`${w.name} · ${mine ? "own" : "someone else's"} message`, () => {
        const c = ctx(w, { mine });
        if (c.oversight) expect(ids(c)).toEqual([]);
        else expect(ids(c)).toContain("copyLink");
      });
    }
  }

  it("is offered on a message with no text (a picture, a voice note): the link points at the message, not at its words", () => {
    expect(ids(ctx(WHO[0]!, { kind: "VOICE", hasText: false }))).toContain("copyLink");
  });

  it("nothing at all on a deleted message or a system line", () => {
    expect(ids(ctx(WHO[0]!, { deleted: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "SYSTEM" }))).toEqual([]);
  });
});

describe("«اقرأ النص» (readText): a picture, where the server's reading-of-pictures switch says so", () => {
  it("is offered with the flag and never without it, for every person who reads", () => {
    for (const w of WHO.filter((x) => x.member)) {
      expect(ids(ctx(w, { canReadText: true })), w.name).toContain("readText");
      expect(ids(ctx(w, { canReadText: false })), w.name).not.toContain("readText");
      expect(ids(ctx(w, { canReadText: undefined })), w.name).not.toContain("readText");
    }
  });

  it("nothing for the owner reading silently, on a deleted message or a system line", () => {
    expect(ids(ctx(WHO[4]!))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { deleted: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "SYSTEM" }))).toEqual([]);
  });
});

describe("«حوّل الصوت لنص» (transcribe): a voice note, where the server's transcript switch says so", () => {
  it("is offered on a voice note with the flag, and on nothing else", () => {
    for (const w of WHO.filter((x) => x.member)) {
      expect(ids(ctx(w, { kind: "VOICE", hasText: false })), w.name).toContain("transcribe");
      expect(ids(ctx(w, { kind: "VOICE", hasText: false, canTranscribe: false })), w.name).not.toContain("transcribe");
      expect(ids(ctx(w, { kind: "TEXT" })), w.name).not.toContain("transcribe");
    }
  });

  it("nothing for the owner reading silently, on a deleted message or a system line", () => {
    expect(ids(ctx(WHO[4]!, { kind: "VOICE", hasText: false }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "VOICE", hasText: false, deleted: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "SYSTEM" }))).toEqual([]);
  });
});

describe("«مين شاف» (seen): a topic or a group, with today's reader list", () => {
  it("is offered where somebody has read up to this message", () => {
    for (const w of WHO.filter((x) => x.member)) {
      expect(ids(ctx(w, { readerCount: 2 })), w.name).toContain("seen");
      expect(ids(ctx(w, { readerCount: 0 })), w.name).not.toContain("seen");
      expect(ids(ctx(w, { readerCount: undefined })), w.name).not.toContain("seen");
    }
  });

  it("never in a private chat (it has ticks instead)", () => {
    expect(ids(ctx(WHO[0]!, { conversationKind: "DM", readerCount: 2 }))).not.toContain("seen");
    expect(ids(ctx(WHO[0]!, { conversationKind: "GROUP", readerCount: 2 }))).toContain("seen");
  });

  it("nothing for the owner reading silently, on a deleted message or a system line", () => {
    expect(ids(ctx(WHO[4]!))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { deleted: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "SYSTEM" }))).toEqual([]);
  });
});

describe("«اسألي مشرفتك» (ask): a text message, for staff who have the problem kinds", () => {
  it("is offered on a text message with the flag (it is the «🎫 مشكلة» door with the question kind)", () => {
    for (const w of WHO.filter((x) => x.member)) {
      expect(ids(ctx(w, { canAsk: true })), w.name).toContain("ask");
      expect(ids(ctx(w, { canAsk: false })), w.name).not.toContain("ask");
      expect(ids(ctx(w, { canAsk: undefined })), w.name).not.toContain("ask");
    }
    expect(ids(ctx(WHO[0]!, { canAsk: true, hasText: false, kind: "VOICE" }))).not.toContain("ask");
  });

  it("nothing for the owner reading silently, on a deleted message or a system line", () => {
    expect(ids(ctx(WHO[4]!))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { deleted: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "SYSTEM" }))).toEqual([]);
    expect(menuOpen(ctx(WHO[4]!))).toBe(false);
  });
});

describe("«حوّل للمحفوظة» (saved): the new screen only, where the person has a saved chat to receive it (C3a.3)", () => {
  it("is offered with the flag on a message anybody who posts here may keep; never without it, never on the old screen", () => {
    for (const w of WHO.filter((x) => x.member)) {
      expect(ids(ctx(w, { canSaved: true })), w.name).toContain("saved");
      expect(ids(ctx(w, { canSaved: false })), w.name).not.toContain("saved");
      expect(ids(ctx(w, { canSaved: undefined })), w.name).not.toContain("saved");
    }
    const { surface: _surface, ...old } = ctx(WHO[0]!, { canSaved: true });
    void _surface;
    expect(ids(old as MessageMenuContext)).not.toContain("saved");
  });

  it("is a forward: a message with no text (a picture, a voice note) can be kept, a poll cannot (forwardMessage refuses a poll)", () => {
    expect(ids(ctx(WHO[0]!, { canSaved: true, kind: "VOICE", hasText: false }))).toContain("saved");
    expect(ids(ctx(WHO[0]!, { canSaved: true, kind: "POLL", hasText: false }))).not.toContain("saved");
  });

  it("is not offered in the saved chat itself (a copy of a message into the same chat is nothing)", () => {
    expect(ids(ctx(WHO[0]!, { canSaved: true, inSaved: true }))).not.toContain("saved");
  });

  it("nothing for the owner reading silently, on a deleted message or a system line", () => {
    expect(ids(ctx(WHO[4]!, { canSaved: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { canSaved: true, deleted: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { canSaved: true, kind: "SYSTEM" }))).toEqual([]);
  });

  it("its words are «حوّل للمحفوظة», from the dictionary, and it sits right after «حوّل»", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    const item = messageMenuItems.find((i) => i.id === "saved")!;
    expect(AR[item.labelKey({ surface: "v2" } as MessageMenuContext)]).toBe("حوّل للمحفوظة");
    expect(V2_MENU_ORDER.indexOf("saved")).toBe(V2_MENU_ORDER.indexOf("forward") + 1);
  });
});

describe("the old screen never gets an id it has no handler for", () => {
  it("without `surface: \"v2\"` no new id is offered, whatever the flags say", () => {
    for (const w of WHO) {
      for (const mine of [true, false]) {
        const { surface: _surface, ...old } = ctx(w, { mine });
        void _surface;
        const offered = ids(old as MessageMenuContext);
        for (const id of NEW_IDS) expect(offered, `${w.name} ${id}`).not.toContain(id);
      }
    }
  });

  it("the old order is untouched: «حذف» is still the last item of the list", () => {
    const order = messageMenuItems.map((i) => i.id);
    expect(order[order.length - 1]).toBe("delete");
    const { surface: _surface, ...old } = ctx(WHO[1]!, { mine: true, canMakeWork: true, canRemind: true });
    void _surface;
    const offered = ids(old as MessageMenuContext);
    expect(offered[offered.length - 1]).toBe("delete");
  });
});

describe("the new screen's order is Telegram's, and ours after it", () => {
  const all = ctx(WHO[1]!, { mine: true, canMakeWork: true, canRemind: true, canProblem: true, canMustRead: true, canTranslate: true, pinned: false });

  it("reply, copy, copy link, pin, forward, edit, delete (danger) — then task, ticket, remind, note, translate, read text, transcribe, seen", () => {
    const order = (from: MessageMenuId, to: MessageMenuId) => expect(V2_MENU_ORDER.indexOf(from), `${from} before ${to}`).toBeLessThan(V2_MENU_ORDER.indexOf(to));
    const chain: MessageMenuId[] = ["reply", "copy", "copyLink", "pin", "forward", "saved", "edit", "delete", "task", "ticket", "remind", "note", "translate", "readText", "transcribe", "seen"];
    for (let i = 1; i < chain.length; i++) order(chain[i - 1]!, chain[i]!);
  });

  it("what a person is offered comes out in that order (the list is a subsequence of it)", () => {
    const offered = menuFor(all).map((i) => i.id);
    expect(offered.length).toBeGreaterThan(8);
    expect(offered).toEqual(V2_MENU_ORDER.filter((id) => offered.includes(id)));
    expect(offered.indexOf("delete")).toBeLessThan(offered.indexOf("task"));
    const voice = menuFor({ ...all, kind: "VOICE", hasText: false }).map((i) => i.id);
    expect(voice).toEqual(V2_MENU_ORDER.filter((id) => voice.includes(id)));
    expect(voice).toContain("transcribe");
  });

  it("every id of the registry has a place in the new order (a new id has to choose one)", () => {
    expect([...V2_MENU_ORDER].sort()).toEqual(messageMenuItems.map((i) => i.id).sort());
    expect(new Set(V2_MENU_ORDER).size).toBe(V2_MENU_ORDER.length);
  });

  it("«حدّد» is not in the registry: it has no action before C3b.5", () => {
    expect(messageMenuItems.map((i) => i.id as string)).not.toContain("select");
  });

  it("the dangerous item is the only one marked, and every label is Arabic and a dictionary key", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    expect(messageMenuItems.filter((i) => i.danger).map((i) => i.id)).toEqual(["delete"]);
    for (const item of messageMenuItems) {
      for (const pinned of [true, false]) {
        for (const surface of [undefined, "v2" as const]) {
          const key = item.labelKey({ pinned, surface } as MessageMenuContext);
          expect(AR[key], key).toMatch(/[؀-ۿ]/);
        }
      }
    }
  });

  it("the words are Telegram's: «ثبّت», «حوّل», «عدّل», «احذف», «نسخ الرابط» on the new screen; the old screen keeps its own words", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    const label = (id: MessageMenuId, c: Partial<MessageMenuContext>) => AR[messageMenuItems.find((i) => i.id === id)!.labelKey({ pinned: false, ...c } as MessageMenuContext)];
    expect(label("pin", { surface: "v2" })).toBe("ثبّت");
    expect(label("forward", { surface: "v2" })).toBe("حوّل");
    expect(label("edit", { surface: "v2" })).toBe("عدّل");
    expect(label("delete", { surface: "v2" })).toBe("احذف");
    expect(label("copyLink", { surface: "v2" })).toBe("نسخ الرابط");
    expect(label("seen", { surface: "v2" })).toBe("مين شاف");
    expect(label("ask", { surface: "v2" })).toBe("اسألي مشرفتك");
    expect(label("readText", { surface: "v2" })).toBe("اقرأ النص");
    expect(label("transcribe", { surface: "v2" })).toBe("حوّل الصوت لنص");
    // the old screen's wording is unchanged
    expect(label("pin", {})).toBe(AR["chatc.menu.pin"]);
    expect(label("delete", {})).toBe(AR["chatc.menu.delete"]);
  });
});

describe("Q1 carry-over: «🎫 مشكلة» and «اسألي مشرفتك» are items of the registry", () => {
  it("«🎫 مشكلة» is offered with `me.problemKinds` (canProblem) on a text message and not without", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    expect(ids(ctx(WHO[0]!, { canProblem: true }))).toContain("problem");
    expect(ids(ctx(WHO[0]!, { canProblem: false }))).not.toContain("problem");
    expect(AR["tickets.menu.problem"]).toContain("مشكلة");
  });
});

// ───────────────────────────── C3a.3: «الرسائل المحفوظة» on the screen ─────────────────────────────
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (node: React.ReactElement, qc = new QueryClient()) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: qc }, node)));
const dm = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto => ({ id, kind: "DM", title: `محادثة ${id}`, emoji: null, space: null, lastMessage: null, unread: 0, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, markedUnread: false, restricted: false, ...over });
const savedRow = (over: Partial<ChatRowDto> = {}) => dm("sv1", { title: "الرسائل المحفوظة", peerId: "u1", pinnedByMe: true, ...over });
const savedList = (rows: ChatRowDto[], saved?: boolean): ChatListDto & { saved?: boolean } => ({ scope: "all", spaceId: null, rows, canOversee: false, ...(saved !== undefined ? { saved } : {}) });
const seededWith = (l: ChatListDto & { saved?: boolean }) => {
  const qc = new QueryClient();
  installChatDefaults(qc);
  qc.setQueryData(chatKeys.list(), l);
  return qc;
};

describe("«المحفوظة» is a private chat whose other person is me (the screen knows it by that, never by its title)", () => {
  it("isSavedRow: a DM whose peer is the viewer; nothing else", () => {
    expect(isSavedRow(savedRow(), "u1")).toBe(true);
    expect(isSavedRow(savedRow(), "u2")).toBe(false);
    expect(isSavedRow(dm("d", { peerId: "u2" }), "u1")).toBe(false);
    expect(isSavedRow(dm("g", { kind: "TOPIC", peerId: "u1" }), "u1")).toBe(false);
    expect(isSavedRow(savedRow(), undefined)).toBe(false);
  });

  it("isSavedHeader (only when the list's row is not in the cache): a DM with the saved chat's title and no other person, or me as that person; an ordinary DM, an old DM that lost the other person's row, and a topic are not", () => {
    const me = { id: "u1" };
    const title = AR["chatsaved.title"]!;
    expect(isSavedHeader({ kind: "DM", me, title } as never)).toBe(true);
    expect(isSavedHeader({ kind: "DM", me, title, peer: { id: "u1", name: "أنا" } } as never)).toBe(true);
    expect(isSavedHeader({ kind: "DM", me, title, peer: { id: "u2", name: "سارة" } } as never)).toBe(false);
    expect(isSavedHeader({ kind: "DM", me, title: "" } as never)).toBe(false);
    expect(isSavedHeader({ kind: "TOPIC", me, title } as never)).toBe(false);
  });

  it("the row: a bookmark for a picture, the title, no ticks even if the last message says so, and the ordinary rows keep their picture", () => {
    const withTicks = savedRow({ lastMessage: { id: "m", authorName: "أنا", preview: "ملاحظة", kind: "TEXT", at: new Date("2026-11-17T09:05:00").toISOString(), mine: true, status: "read" } });
    const html = render(createElement(RowView, { row: withTicks, selected: false, saved: true }));
    expect(html).toContain("data-saved-avatar");
    expect(html).toContain("الرسائل المحفوظة");
    expect(html).not.toContain("lucide-check");
    const ordinary = render(createElement(RowView, { row: { ...withTicks, id: "d1", title: "سارة", peerId: "u2" }, selected: false }));
    expect(ordinary).not.toContain("data-saved-avatar");
    expect(ordinary).toContain("lucide-check");
  });
});

describe("the menu's «حوّل للمحفوظة»: from the cached list, only on the new screen, and it runs inside the menu", () => {
  it("savedFlagsOf: offered when the list holds the saved row or says the switch is on; not inside the saved chat; nothing without the list or the viewer", () => {
    expect(savedFlagsOf(savedList([savedRow()]), "u1", "/chat/other")).toEqual({ canSaved: true, inSaved: false, savedId: "sv1" });
    expect(savedFlagsOf(savedList([savedRow()]), "u1", "/chat/sv1")).toEqual({ canSaved: true, inSaved: true, savedId: "sv1" });
    expect(savedFlagsOf(savedList([], true), "u1", "/chat")).toEqual({ canSaved: true, inSaved: false, savedId: null });
    expect(savedFlagsOf(savedList([], false), "u1", "/chat").canSaved).toBe(false);
    expect(savedFlagsOf(savedList([dm("d", { peerId: "u2" })]), "u1", "/chat").canSaved).toBe(false);
    expect(savedFlagsOf(undefined, "u1", "/chat").canSaved).toBe(false);
    expect(savedFlagsOf(savedList([savedRow()]), undefined, "/chat").canSaved).toBe(false);
  });

  it("menuContextV2 carries the message and the viewer, and never the saved flags itself (the menu reads those from the cache)", () => {
    const header = makeHeader({});
    const message = makeMessage();
    const context = menuContextV2(message, bubbleFactsOf(header), { readerCount: 0, askKind: false });
    expect(context.messageId).toBe(message.id);
    expect(context.viewerId).toBe(header.me.id);
    expect(context.canSaved).toBeUndefined();
  });

  const draw = (context: MessageMenuContext, qc: QueryClient | null, open: boolean) => {
    const node = createElement(MessageMenuV2, { context, quick: ["👍"], onAction: () => undefined, onReact: () => undefined, sheetOpen: false, onSheetOpenChange: () => undefined, menuOpen: open, onMenuOpenChange: () => undefined, portal: false });
    return qc ? render(node, qc) : renderToStaticMarkup(createElement(Translations, { initial: "ar" }, node));
  };

  it("the open menu draws the item when the cached list has the saved chat; a menu on its own (no query client) and a closed menu draw none", () => {
    const context = { ...ctx(WHO[0]!), viewerId: "u1", messageId: "m1" };
    where.pathname = "/chat/c1";
    expect(draw(context, seededWith(savedList([savedRow()])), true)).toContain('data-menu-item="saved"');
    expect(draw(context, seededWith(savedList([], true)), true)).toContain('data-menu-item="saved"');
    expect(draw(context, seededWith(savedList([], false)), true)).not.toContain('data-menu-item="saved"');
    expect(draw(context, null, true)).not.toContain('data-menu-item="saved"');
    expect(draw(context, seededWith(savedList([savedRow()])), false)).not.toContain('data-menu-item="saved"');
    where.pathname = "/chat/sv1";
    expect(draw(context, seededWith(savedList([savedRow()])), true)).not.toContain('data-menu-item="saved"');
    where.pathname = "/chat";
  });

  it("the item's words are in the open menu, and the item sits right after «حوّل»", () => {
    where.pathname = "/chat/c1";
    const html = draw({ ...ctx(WHO[0]!), viewerId: "u1", messageId: "m1" }, seededWith(savedList([savedRow()])), true);
    expect(html).toContain("حوّل للمحفوظة");
    const items = [...html.matchAll(/data-menu-item="(\w+)"/g)].map((m) => m[1]!);
    expect(items.indexOf("saved")).toBe(items.indexOf("forward") + 1);
    where.pathname = "/chat";
  });

  it("keepInSaved: opens the saved chat through the dm door, then forwards INTO it; a refusal of either door is false and forwards nothing", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchOk = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return url === "/api/chat/dm" ? new Response(JSON.stringify({ id: "sv9", created: false }), { status: 200 }) : new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;
    expect(await keepInSaved("m 1", fetchOk)).toBe(true);
    expect(calls).toEqual([
      { url: "/api/chat/dm", body: { saved: true } },
      { url: "/api/chat/messages/m%201/forward", body: { conversationId: "sv9" } },
    ]);
    const off = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    expect(await keepInSaved("m1", off)).toBe(false);
    const noForward = (async (url: string) => (url === "/api/chat/dm" ? new Response(JSON.stringify({ id: "sv9" }), { status: 200 }) : new Response("{}", { status: 403 }))) as unknown as typeof fetch;
    expect(await keepInSaved("m1", noForward)).toBe(false);
    const broken = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await keepInSaved("m1", broken)).toBe(false);
  });
});

describe("the list column: «المحفوظة» before it exists, and never twice", () => {
  const props = { variant: "column" as const, userId: "u1", guest: false, canMeet: false, rowMenu: true, canPurge: false };

  it("the switch is on and there is no saved chat yet: one pinned entry on top that opens it (it reads the cache, so both shapes of D-N2 draw the same entry)", () => {
    where.pathname = "/chat";
    const html = render(createElement(ChatListColumn, props), seededWith(savedList([dm("d1", { title: "أحمد", peerId: "u2" })], true)));
    expect(html).toContain("data-saved-entry");
    expect(html).toContain("المحفوظة");
    expect(html.indexOf("data-saved-entry")).toBeLessThan(html.indexOf("أحمد"));
  });

  it("no entry when the chat already is a row of the list, when the switch is off, or when the list does not say", () => {
    where.pathname = "/chat";
    expect(render(createElement(ChatListColumn, props), seededWith(savedList([savedRow()], true)))).not.toContain("data-saved-entry");
    expect(render(createElement(ChatListColumn, props), seededWith(savedList([dm("d1", { peerId: "u2" })], false)))).not.toContain("data-saved-entry");
    expect(render(createElement(ChatListColumn, props), seededWith(savedList([dm("d1", { peerId: "u2" })])))).not.toContain("data-saved-entry");
  });
});

describe("Ctrl+0 opens «المحفوظة»: the registry's own function, by the physical key, with nothing else held", () => {
  const key = (over: Partial<KeyEventLike>): KeyEventLike => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over });

  it("Ctrl+0 (any layout, the numpad too) is the saved shortcut; with Alt, Shift or the command key, in a composition, or already handled, it is not", () => {
    expect(savedShortcutOf(key({ code: "Digit0", key: "0", ctrlKey: true }))).toBe(true);
    expect(savedShortcutOf(key({ code: "Digit0", key: "٠", ctrlKey: true }))).toBe(true);
    expect(savedShortcutOf(key({ code: "Numpad0", key: "0", ctrlKey: true }))).toBe(true);
    expect(savedShortcutOf(key({ code: "Digit0", key: "0" }))).toBe(false);
    expect(savedShortcutOf(key({ code: "Digit0", key: "0", ctrlKey: true, altKey: true }))).toBe(false);
    expect(savedShortcutOf(key({ code: "Digit0", key: "0", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(savedShortcutOf(key({ code: "Digit0", key: "0", metaKey: true }))).toBe(false);
    expect(savedShortcutOf(key({ code: "Digit0", key: "0", ctrlKey: true, isComposing: true }))).toBe(false);
    expect(savedShortcutOf(key({ code: "Digit0", key: "0", ctrlKey: true, defaultPrevented: true }))).toBe(false);
    expect(savedShortcutOf(key({ code: "Digit1", key: "1", ctrlKey: true }))).toBe(false);
  });

  it("the folders' map is untouched (Ctrl+0 is no folder: since C3w.2 it is the map's own «saved» action) and the table still holds the eight rows C2.6 pinned; the saved row is its own, with words from the dictionary", () => {
    expect(shortcutOf(key({ code: "Digit0", key: "0", ctrlKey: true }))).toEqual({ type: "saved" });
    expect(SHORTCUT_ROWS).toHaveLength(8);
    expect(SAVED_SHORTCUT.keys).toEqual(["ctrl", "0"]);
    expect(AR[SAVED_SHORTCUT.labelKey]).toBe("افتح المحفوظة");
  });

  it("openSavedId is the ONE place that asks the dm door: the id, or null for a refusal, a body with no id, or a fault", async () => {
    const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await openSavedId(reply(201, { id: "sv1", created: true }))).toBe("sv1");
    expect(await openSavedId(reply(404, { message: "features.off" }))).toBeNull();
    expect(await openSavedId(reply(200, {}))).toBeNull();
    expect(await openSavedId(reply(200, { id: "" }))).toBeNull();
    expect(await openSavedId((async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });

  it("openSavedChat asks the dm door and hands the id to the shell; a refusal (the switch is off) opens nothing", async () => {
    const opened: string[] = [];
    const ok = (async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/chat/dm");
      expect(JSON.parse(String(init?.body))).toEqual({ saved: true });
      return new Response(JSON.stringify({ id: "sv7" }), { status: 201 });
    }) as unknown as typeof fetch;
    expect(await openSavedChat((id) => opened.push(id), ok)).toBe(true);
    expect(opened).toEqual(["sv7"]);
    const off = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    expect(await openSavedChat((id) => opened.push(id), off)).toBe(false);
    expect(opened).toEqual(["sv7"]);
  });
});
