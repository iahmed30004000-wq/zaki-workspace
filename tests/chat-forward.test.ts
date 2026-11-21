import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

(globalThis as { React?: typeof React }).React = React;

import { ForwardSheetView, type ForwardSheetViewProps } from "@/components/chat/v2/forward/forward-sheet";
import { ForwardedHeader } from "@/components/chat/v2/bubble/bubble-parts";
import { TOAST_ACTION_DISMISS_MS, TOAST_DISMISS_MS, ToastRow } from "@/components/ui/toast";
import {
  FORWARD_MAX_TARGETS,
  FORWARD_RECENTS,
  SAVED_NEW_ID,
  cleanComment,
  forwardBody,
  groupBySpace,
  matchesTarget,
  normalizeSearch,
  outcomeOf,
  recentTargets,
  remainingPicks,
  savedRowFor,
  savedTarget,
  togglePick,
  visibleTargets,
  type ForwardTargetDto,
  type ForwardTargetsDto,
} from "@/lib/chat/forward";
import { forwardedPreview } from "@/server/chat/notify";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { classTokens } from "./ui-render";

/**
 * S5.2 — the forward sheet: the pure rules (search, grouping, the pick, the request, what an answer means), the sheet drawn from its parts, the toast's optional action, the
 * header's tap and the wiring of both flows to the ONE sheet. What the server lets through is proven against a real database in `tests/db/chat-forward.test.ts`.
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const read = (path: string): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const target = (over: Partial<ForwardTargetDto> & { id: string }): ForwardTargetDto => ({ kind: "TOPIC", title: "موضوع", emoji: null, avatarUrl: null, spaceId: "s1", spaceName: "المبيعات", lastAt: null, ...over });
const dm = (id: string, title: string, over: Partial<ForwardTargetDto> = {}): ForwardTargetDto => target({ id, kind: "DM", title, spaceId: null, spaceName: null, ...over });
const data = (over: Partial<ForwardTargetsDto> = {}): ForwardTargetsDto => ({
  saved: { id: null },
  targets: [
    target({ id: "t1", title: "عام", spaceId: "s1", spaceName: "المبيعات", lastAt: "2026-11-21T10:00:00.000Z" }),
    target({ id: "t2", title: "الدعم", spaceId: "s1", spaceName: "المبيعات", emoji: "🎧" }),
    target({ id: "t3", title: "عام", spaceId: "s2", spaceName: "التصنيع", lastAt: "2026-11-21T11:00:00.000Z" }),
    dm("d1", "سلمى", { lastAt: "2026-11-21T12:00:00.000Z" }),
    target({ id: "g1", kind: "GROUP", title: "فريق الإطلاق", spaceId: null, spaceName: null }),
  ],
  recents: ["d1", "t3", "t1"],
  ...over,
});

describe("the pure rules", () => {
  it("the caps are the server's: ten targets, a recents strip of six", () => {
    expect(FORWARD_MAX_TARGETS).toBe(10);
    expect(FORWARD_RECENTS).toBe(6);
  });

  it("the search ignores vowel marks, the shapes of alef / ya / ta marbuta and Arabic-Indic digits, and every word must be found (in the title or the space's name)", () => {
    expect(normalizeSearch("  أَحمد  إبراهيم ")).toBe("احمد ابراهيم");
    expect(normalizeSearch("فريق ٢")).toBe("فريق 2");
    expect(matchesTarget({ title: "مبيعات الشركة", spaceName: null }, "الشركه")).toBe(true);
    expect(matchesTarget({ title: "عام", spaceName: "المبيعات" }, "مبيعات عام")).toBe(true);
    expect(matchesTarget({ title: "عام", spaceName: "المبيعات" }, "مبيعات دعم")).toBe(false);
    expect(matchesTarget({ title: "عام", spaceName: null }, "   ")).toBe(true);
  });

  it("the list never offers the conversation the message is in, and the search keeps the matches", () => {
    const all = data().targets;
    expect(visibleTargets(all, "", "t1").map((t) => t.id)).toEqual(["t2", "t3", "d1", "g1"]);
    expect(visibleTargets(all, "عام", null).map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(visibleTargets(all, "التصنيع", null).map((t) => t.id)).toEqual(["t3"]);
  });

  it("grouped by space in the server's order, the private chats and groups last", () => {
    const groups = groupBySpace(data().targets);
    expect(groups.map((g) => [g.spaceId, g.spaceName, g.items.map((t) => t.id)])).toEqual([
      ["s1", "المبيعات", ["t1", "t2"]],
      ["s2", "التصنيع", ["t3"]],
      [null, null, ["d1", "g1"]],
    ]);
    expect(groupBySpace([])).toEqual([]);
  });

  it("a private chat of a space stays among the private chats (its space is only its subtitle)", () => {
    const groups = groupBySpace([target({ id: "t1" }), dm("d2", "علي", { spaceId: "s1", spaceName: "المبيعات" })]);
    expect(groups.map((g) => g.spaceId)).toEqual(["s1", null]);
    expect(groups[1]!.items.map((t) => t.id)).toEqual(["d2"]);
  });

  it("the recents are the server's ids in its order, only those still listed, never the open conversation, at most six", () => {
    expect(recentTargets(data(), null).map((t) => t.id)).toEqual(["d1", "t3", "t1"]);
    expect(recentTargets(data(), "t3").map((t) => t.id)).toEqual(["d1", "t1"]);
    expect(recentTargets(data({ recents: ["gone", "d1"] }), null).map((t) => t.id)).toEqual(["d1"]);
    expect(recentTargets(data(), null, "سلمى").map((t) => t.id)).toEqual(["d1"]);
    const many = Array.from({ length: 9 }, (_, i) => target({ id: `x${i}`, title: `x${i}` }));
    expect(recentTargets({ targets: many, recents: many.map((t) => t.id) }, null)).toHaveLength(6);
  });

  it("the saved chat is a row of its own with its id (or a placeholder while it is not made yet); no row when the switch is off", () => {
    expect(savedTarget({ saved: { id: "sv1" } }, "المحفوظة")).toMatchObject({ id: "sv1", kind: "SAVED", title: "المحفوظة" });
    expect(savedTarget({ saved: { id: null } }, "المحفوظة")?.id).toBe(SAVED_NEW_ID);
    expect(savedTarget({ saved: null }, "المحفوظة")).toBeNull();
  });

  it("the saved chat is never offered inside itself (like every other open conversation)", () => {
    expect(savedRowFor({ saved: { id: "sv1" } }, "x", null)?.id).toBe("sv1");
    expect(savedRowFor({ saved: { id: "sv1" } }, "x", "sv1")).toBeNull();
    expect(savedRowFor({ saved: { id: null } }, "x", "sv1")?.id).toBe(SAVED_NEW_ID);
    expect(savedRowFor({ saved: null }, "x", null)).toBeNull();
  });

  it("after a partial answer only the picks that did not get their copies stay (the saved chat's placeholder counts as the id it was made under)", () => {
    expect(remainingPicks(["a", "b", "c"], ["a", "c"], null)).toEqual(["b"]);
    expect(remainingPicks(["a", SAVED_NEW_ID], ["sv9"], "sv9")).toEqual(["a"]);
    expect(remainingPicks(["a", SAVED_NEW_ID], ["a"], "sv9")).toEqual([SAVED_NEW_ID]);
    expect(remainingPicks(["a"], ["a"], null)).toEqual([]);
  });

  it("the pick: add, remove, and never more than ten (the eleventh is not taken)", () => {
    expect(togglePick([], "a")).toEqual(["a"]);
    expect(togglePick(["a", "b"], "a")).toEqual(["b"]);
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
    expect(togglePick(ten, "extra")).toEqual(ten);
    expect(togglePick(ten, "t3")).toHaveLength(9);
  });

  it("the comment is trimmed and cut at 1000, and empty means none", () => {
    expect(cleanComment("  hi  ")).toBe("hi");
    expect(cleanComment("   ")).toBeUndefined();
    expect(cleanComment("x".repeat(1500))).toHaveLength(1000);
  });

  it("ONE request body for both flows: the messages, the targets, the author switch and the comment only when there is one", () => {
    expect(forwardBody({ messageIds: ["m1"], targetIds: ["t1", "t2"], withoutAuthor: false, comment: "" })).toEqual({ messageIds: ["m1"], targetIds: ["t1", "t2"], withoutAuthor: false });
    expect(forwardBody({ messageIds: ["m1", "m2"], targetIds: ["t1"], withoutAuthor: true, comment: " look " })).toEqual({ messageIds: ["m1", "m2"], targetIds: ["t1"], withoutAuthor: true, comment: "look" });
  });

  it("what an answer means: all, some or none; «افتح» only when exactly ONE target was asked and it worked", () => {
    expect(outcomeOf(null)).toMatchObject({ state: "none", openId: null });
    expect(outcomeOf([])).toMatchObject({ state: "none" });
    expect(outcomeOf([{ targetId: "a", ok: true }])).toMatchObject({ state: "all", openId: "a" });
    expect(outcomeOf([{ targetId: "a", ok: false }])).toMatchObject({ state: "none", failed: 1, openId: null });
    expect(outcomeOf([{ targetId: "a", ok: true }, { targetId: "b", ok: true }])).toMatchObject({ state: "all", openId: null });
    expect(outcomeOf([{ targetId: "a", ok: true }, { targetId: "b", ok: false }])).toMatchObject({ state: "some", ok: ["a"], failed: 1, openId: null });
  });

  it("the bell's words for a forward without a comment: the one message's words, or how many were passed on", () => {
    expect(forwardedPreview(1, "نص")).toBe("نص");
    expect(forwardedPreview(2, "x")).toBe("حوّل لك رسالتين");
    expect(forwardedPreview(3, "x")).toBe("حوّل لك 3 رسائل");
    expect(forwardedPreview(10, "x")).toBe("حوّل لك 10 رسائل");
    expect(forwardedPreview(11, "x")).toBe("حوّل لك 11 رسالة");
  });
});

describe("the sheet", () => {
  const base = (over: Partial<ForwardSheetViewProps> = {}): ForwardSheetViewProps => ({
    open: true,
    onClose: () => {},
    count: 1,
    from: null,
    state: { status: "ready", data: data() },
    onRetry: () => {},
    query: "",
    onQuery: () => {},
    picked: [],
    onToggle: () => {},
    hideAuthor: false,
    onHideAuthor: () => {},
    comment: "",
    onComment: () => {},
    busy: false,
    onSend: () => {},
    portal: false,
    ...over,
  });
  const draw = (over: Partial<ForwardSheetViewProps> = {}): string => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(ForwardSheetView, base(over))));
  const order = (html: string, ...needles: string[]): boolean => needles.map((n) => html.indexOf(n)).every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1]!));

  it("a search box, «الرسائل المحفوظة» on top, then the recents, then one group per space with its name, the private chats last", () => {
    const html = draw();
    expect(html).toContain("data-forward-search");
    expect(html).toContain(AR["chatfwd.search"]!);
    expect(order(html, 'data-forward-kind="SAVED"', "data-forward-recents", 'data-forward-group="s1"', 'data-forward-group="s2"', 'data-forward-group="private"')).toBe(true);
    expect(html).toContain(AR["chatfwd.saved"]!);
    expect(html).toContain(">المبيعات<");
    expect(html).toContain(">التصنيع<");
    expect(html).toContain(AR["chatfwd.private"]!);
    expect(html).toContain("فريق الإطلاق");
  });

  it("every place has a picture: the saved chat's bookmark, a topic's emoji, a person's initials", () => {
    const html = draw();
    expect(html).toContain("🎧");
    expect(html).toContain("bg-accent text-accent-fg"); // the saved chat's circle
    expect(html).toContain("hsl("); // an avatar with initials draws its own hue
  });

  it("the saved chat is not offered inside the saved chat", () => {
    const own = { saved: { id: "sv1" }, targets: [target({ id: "t1" })], recents: [] };
    expect(draw({ state: { status: "ready", data: own }, from: null })).toContain('data-forward-kind="SAVED"');
    expect(draw({ state: { status: "ready", data: own }, from: "sv1" })).not.toContain('data-forward-kind="SAVED"');
  });

  it("the open conversation is not offered, and the recents strip is not drawn while searching", () => {
    const html = draw({ from: "t1" });
    expect(html).not.toContain('data-forward-target="t1"');
    expect(html).not.toContain('data-forward-recent="t1"');
    const searching = draw({ query: "سلمى" });
    expect(searching).not.toContain("data-forward-recents");
    expect(searching).toContain('data-forward-target="d1"');
    expect(searching).not.toContain('data-forward-target="t3"');
    expect(searching).not.toContain('data-forward-kind="SAVED"');
  });

  it("nothing found says so; no place at all (and no saved chat) says that", () => {
    expect(draw({ query: "لا يوجد أبدا" })).toContain(AR["chatfwd.none"]!);
    expect(draw({ state: { status: "ready", data: { saved: null, targets: [], recents: [] } } })).toContain(AR["chatfwd.empty"]!);
  });

  it("loading and a failed list are drawn; the failed one offers a retry", () => {
    expect(draw({ state: { status: "loading" } })).toContain(AR["chatfwd.loading"]!);
    const failed = draw({ state: { status: "error" } });
    expect(failed).toContain(AR["chatfwd.load_failed"]!);
    expect(failed).toContain(AR["chatfwd.retry"]!);
  });

  it("with nothing picked: no comment box, no author switch, and «إرسال» is disabled; with a pick: the comment, the switch and a live count", () => {
    const none = draw();
    expect(none).not.toContain("data-forward-comment");
    expect(none).not.toContain('role="switch"');
    expect(none).toMatch(/data-forward-send=""[^>]*disabled=""|disabled=""[^>]*data-forward-send=""/);
    expect(none).toContain(AR["chatfwd.pick"]!);
    const some = draw({ picked: ["t1", "d1"], comment: "شوف هاد" });
    expect(some).toContain("data-forward-comment");
    expect(some).toContain('value="شوف هاد"');
    expect(some).toContain('role="switch"');
    expect(some).toContain(AR["chatfwd.hide_author"]!);
    expect(some).toContain("محادثتين");
    expect(some).not.toMatch(/disabled=""[^>]*data-forward-send|data-forward-send=""[^>]*disabled=""/);
    // ONE send button
    expect(some.match(/data-forward-send/g)).toHaveLength(1);
    expect(some).toContain(AR["chatfwd.send"]!);
  });

  it("a picked row says so (aria-checked) and ten picked disable the rest, with the cap said", () => {
    const html = draw({ picked: ["t1"] });
    expect(html).toMatch(/aria-checked="true"[^>]*data-forward-target="t1"/);
    expect(html).toMatch(/aria-checked="false"[^>]*data-forward-target="t2"/);
    const many = Array.from({ length: 12 }, (_, i) => target({ id: `m${i}`, title: `مكان ${i}` }));
    const full = draw({ state: { status: "ready", data: { saved: null, targets: many, recents: [] } }, picked: many.slice(0, 10).map((t) => t.id) });
    expect(full).toMatch(/data-forward-target="m11"/);
    expect(full).toMatch(/disabled=""[^>]*data-forward-target="m11"/);
    expect(full).not.toMatch(/disabled=""[^>]*data-forward-target="m0"/);
    expect(full).toContain(AR["chatfwd.max"]!);
  });

  it("the title counts the messages (one, two, a few, many) and the polls left out are said", () => {
    expect(draw({ count: 1 })).toContain("حوّل الرسالة");
    expect(draw({ count: 2 })).toContain("حوّل الرسالتين");
    expect(draw({ count: 4 })).toContain("حوّل 4 رسائل");
    expect(draw({ count: 12 })).toContain("حوّل 12 رسالة");
    expect(draw({ skipped: 2 })).toContain(AR["chatfwd.skipped"]!);
    expect(draw({ skipped: 0 })).not.toContain(AR["chatfwd.skipped"]!);
  });

  it("while sending the button says so and cannot be pressed twice", () => {
    const html = draw({ picked: ["t1"], busy: true });
    expect(html).toContain(AR["chatfwd.sending"]!);
    expect(html).toMatch(/data-forward-send=""[^>]*disabled=""|disabled=""[^>]*data-forward-send=""/);
  });

  it("theme tokens and logical sides only: no hex colour, no fixed left/right, no small text sizes", () => {
    const html = draw({ picked: ["t1"] });
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const tokens = classTokens(html);
    for (const token of tokens) {
      expect(token, token).not.toMatch(/^(?:text-\[1[01](?:\.5)?px\]|bg-white|bg-black|text-white|(?:ml|mr|pl|pr|left|right)-\S+)$/);
    }
  });

  it("every word the sheet shows is Arabic (no Latin word, no tanween on tatweel) and the keys live in ONE file", () => {
    const file = JSON.parse(read("src/lib/i18n/ar.chat-forward.json")) as Record<string, string>;
    for (const [key, text] of Object.entries(file)) {
      expect(AR[key], key).toBe(text);
      expect(text.replace(/\{[a-z]+\}/g, ""), key).not.toMatch(/[A-Za-z]{2,}/);
      expect(text, key).not.toMatch(/ـ[ً-ِ]/);
    }
    // no key of the new file is defined anywhere else
    for (const other of ["ar.chat-features.json", "ar.chat-ui.json", "ar.chat-conversation.json"]) {
      const keys = Object.keys(JSON.parse(read(`src/lib/i18n/${other}`)) as Record<string, string>);
      expect(keys.filter((k) => k in file)).toEqual([]);
    }
    expect(read("src/lib/i18n/dict.ts")).toContain('import chatForward from "./ar.chat-forward.json"');
    expect(read("src/lib/i18n/dict.ts")).toContain("...chatForward,");
  });
});

describe("the toast's optional action", () => {
  const row = (item: Parameters<typeof ToastRow>[0]["item"]) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(ToastRow, { item, onDismiss: () => {} })));

  it("a toast with an action draws its button with the label; one without has none (everything else is as it was)", () => {
    const withAction = row({ id: 1, kind: "success", message: "تحوّلت إلى عام", action: { label: "افتح", onClick: () => {} } });
    expect(withAction).toContain("data-toast-action");
    expect(withAction).toContain(">افتح<");
    expect(withAction).toContain("data-zk-toast");
    const plain = row({ id: 2, kind: "info", message: "تم" });
    expect(plain).not.toContain("data-toast-action");
    expect(plain).toContain("data-zk-toast");
  });

  it("a toast that carries a button stays up longer than a plain one (there must be time to reach it)", () => {
    expect(TOAST_ACTION_DISMISS_MS).toBeGreaterThan(TOAST_DISMISS_MS);
    expect(read("src/components/ui/toast.tsx")).toContain("item.action ? TOAST_ACTION_DISMISS_MS : TOAST_DISMISS_MS");
  });

  it("the provider's toast() takes the action as an optional third argument and the old two-argument calls are untouched", () => {
    const source = read("src/components/ui/toast.tsx");
    expect(source).toContain("toast: (message: string, kind?: ToastKind, action?: ToastAction) => void;");
    expect(source).toContain("item.action?.onClick();");
    expect(source).toContain("onDismiss();");
  });
});

describe("the «محوّلة من» header", () => {
  const html = (props: Parameters<typeof ForwardedHeader>[0]) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(ForwardedHeader, props)));

  it("names the author; with a handler it is a button that says what a tap does, without one it is plain text as before", () => {
    const plain = html({ name: "أحمد" });
    expect(plain).toContain("محوّلة من أحمد");
    expect(plain).toContain("data-forwarded");
    expect(plain).not.toContain("<button");
    const tappable = html({ name: "أحمد", onOpen: () => {} });
    expect(tappable).toContain("<button");
    expect(tappable).toContain("data-forwarded-open");
    expect(tappable).toContain("محوّلة من أحمد");
    expect(tappable).toContain(`aria-label="${AR["chatfwd.source_open"]}"`);
  });

  it("the bubble wires the tap to the server's answer (the same conversation jumps, another one is opened by its address)", () => {
    const bubble = read("src/components/chat/v2/message-bubble.tsx");
    expect(bubble).toContain("useOpenForwardSource(conversationId, onJump)");
    expect(bubble).toContain("onOpen={() => openForwardSource(message.id)}");
    const hook = read("src/components/chat/v2/forward/use-open-forward-source.ts");
    expect(hook).toContain("/forward`");
    expect(hook).toContain("source.conversationId === here");
    expect(hook).toContain("chatfwd.source_gone");
    // a bubble must be drawable with no router around it: `useRouter()` throws then, so the hook catches it (the bubble render test draws without one)
    const open = read("src/components/chat/v2/forward/use-open-chat.ts");
    expect(open).toContain("try {");
    expect(open).toContain("return useRouter();");
    expect(open).not.toContain("next/dist");
  });
});

describe("one sheet for both flows", () => {
  it("the multi-select dialog IS the sheet (it makes no door call of its own) and the single «حوّل» opens the same sheet while the switch is on", () => {
    const many = read("src/components/chat/v2/menu/selection-dialogs.tsx");
    const body = many.slice(many.indexOf("export function ForwardManyDialog"), many.indexOf("export function DeleteManyDialog"));
    expect(body).toContain("<ForwardSheet");
    expect(body).not.toContain("fetch(");
    expect(body).not.toContain("/api/chat/home");
    const host = read("src/components/chat/v2/pane/seams/menu-host.tsx");
    const forwardHost = host.slice(host.indexOf("function ForwardHost("), host.indexOf("function SeenDialog("));
    expect(forwardHost).toContain("useMultiSelectSwitch(header)");
    expect(forwardHost).toContain("<ForwardSheet");
    expect(forwardHost).toContain("<ForwardDialog");
  });

  it("the sheet posts ONE body to the multi door and asks the new picker door (never /api/chat/home, which stays the current space's)", () => {
    const send = read("src/components/chat/v2/forward/use-forward-send.ts");
    expect(send).toContain("/api/chat/messages/forward");
    expect(send).toContain("forwardBody(");
    expect(send).toContain("openSavedId()");
    const targets = read("src/components/chat/v2/forward/use-forward-targets.ts");
    expect(targets).toContain("/api/chat/forward-targets");
    expect(targets).not.toContain("/api/chat/home");
    const home = read("src/app/api/chat/home/route.ts");
    expect(home).toContain("spaceId: space?.id ?? null");
  });

  it("the picker's door and the forward doors name their switch before anything else is read or written", () => {
    const door = read("src/app/api/chat/forward-targets/route.ts");
    expect(door).toContain('assertFeatureOn(ctx.orgId, "chatMultiSelect")');
    expect(door).toContain("withApi");
    expect(door.indexOf("assertFeatureOn(")).toBeLessThan(door.indexOf("listForwardTargets(ctx)"));
    expect(read("src/app/api/chat/messages/forward/route.ts")).toContain('assertFeatureOn(ctx.orgId, "chatMultiSelect")');
  });

  it("the picker uses the chat list's own two rules for what a topic lists and who writes in it", () => {
    const source = read("src/server/chat/forward-targets.ts");
    expect(source).toContain("topicListed(");
    expect(source).toContain("topicPostable(");
    expect(source).toContain("t.archivedAt ||");
    const home = read("src/server/chat/home.ts");
    expect(home).toContain("topicListed({");
    expect(home).toContain("topicPostable({");
  });

  it("the server writes a forward's comment and notifies in the same places for the single and the multi door", () => {
    const messages = read("src/server/chat/messages.ts");
    expect(messages).toContain("forwardedFromId: msg.forwardedFromId ?? msg.id");
    expect(messages).toContain("export async function notifyAfterSend(");
    expect(messages.match(/notifyForward\(ctx,/g)?.length).toBe(2);
    expect(messages.match(/await assertTargetOpen\(to,/g)?.length).toBe(2);
  });
});
