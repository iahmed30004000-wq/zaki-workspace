import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ComposerSurface, type SurfaceEngine } from "@/components/chat/v2/composer/composer-surface";
import { ConversationPickerDialog } from "@/components/chat/v2/feedback/conversation-picker";
import { FeedbackDialog } from "@/components/chat/v2/feedback/feedback-dialog";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { ChatListDto, ChatRowDto } from "@/lib/chat/cache/types";
import { composerFaceOf } from "@/lib/chat/v2/composer/face";
import { scheduledPlanOf } from "@/lib/chat/v2/composer/scheduled-plan";
import { MAX_FEEDBACK_SEND, feedbackCommand, offerableFeedback, pickableChats, sendInOrder, sendableFeedbackIds } from "@/lib/chat/v2/feedback/feedback-model";
import { slashCommand } from "@/lib/chat/recall-client";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import type { MediaItemDTO } from "@/server/services/knowledge-media";
import { textOf } from "./ui-render";

/**
 * C3w.2 — the composer's wiring: the header's own count of scheduled messages (no request of its own for every conversation), the formatting switch, «/آراء» with its
 * picker and the screen's picker for «ابعتيها بالمحادثة» (Q1.2, Q1.3). Nothing of Q1 is lost: the «/» menu, «⚡», the card, the order chip stay as they were.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const noop = () => undefined;
const inApp = (node: ReactElement, qc = new QueryClient()) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: qc }, node)));

describe("«جدول الإرسال»: the composer asks the header, not its own request (C3c.3)", () => {
  it("no number in the header: no entry and no request (the switch is off, or the person may not write)", () => {
    expect(scheduledPlanOf({ scheduled: undefined, oversight: false, meId: "u1" })).toEqual({ entry: false, count: 0, loadOnOpen: false });
  });

  it("a number, even 0, is the entry; the list is read at the opening only when some wait", () => {
    expect(scheduledPlanOf({ scheduled: 0, oversight: false, meId: "u1" })).toEqual({ entry: true, count: 0, loadOnOpen: false });
    expect(scheduledPlanOf({ scheduled: 3, oversight: false, meId: "u1" })).toEqual({ entry: true, count: 3, loadOnOpen: true });
  });

  it("the owner reading in silence and a person with no id never ask", () => {
    expect(scheduledPlanOf({ scheduled: 2, oversight: true, meId: "u1" }).entry).toBe(false);
    expect(scheduledPlanOf({ scheduled: 2, oversight: false, meId: "" }).entry).toBe(false);
    expect(scheduledPlanOf({ scheduled: 2, oversight: true, meId: "u1" }).loadOnOpen).toBe(false);
  });

  it("the engine reads the plan: its one opening request is guarded by loadOnOpen, the dialog and the list read when asked, and the icon counts from the header until the list is here", () => {
    const engine = read("src/lib/chat/v2/composer/use-composer.ts");
    expect(engine).toContain("scheduledPlanOf({ scheduled: detail.scheduled, oversight: detail.me.oversight, meId })");
    expect(engine).toContain("if (!plan.loadOnOpen && !listHere.current) return;");
    expect(engine).not.toContain("const scheduledAsk");
    expect(engine).toContain("const list = scheduledList ?? (await refreshScheduled());");
    expect(engine).toContain("scheduledCount: scheduledList ? scheduledList.items.length : plan.count");
    expect(engine).toContain("if (open && !scheduledList) void refreshScheduled();");
  });

  it("the icon shows the header's number, then the list's", () => {
    expect(read("src/components/chat/v2/composer/composer-surface.tsx")).toContain("c.scheduledCount ?? c.scheduledItems?.length ?? 0");
  });
});

describe("the formatting switch reaches the composer (C3b.1)", () => {
  it("the box is given the header's switch (absent: on)", () => {
    expect(read("src/components/chat/v2/composer/chat-composer-v2.tsx")).toContain("formatting={detail.chatFormatting !== false}");
  });
});

describe("Ctrl+Enter is the person's choice (C4.1): already in the engine, kept", () => {
  it("the key handler asks the device's copy of the choice at the moment of the key", () => {
    const engine = read("src/lib/chat/v2/composer/use-composer.ts");
    expect(engine).toContain("sendKeyAllows(readDevicePrefs().mirror?.sendKey, event)");
  });
});

describe("«/آراء» (Q1.3)", () => {
  it("feedbackCommand: the word and a space after it, with what follows as the search; a word still being typed, another word, a long or multi-line text are not commands", () => {
    expect(feedbackCommand("/آراء حراك")).toEqual({ q: "حراك" });
    expect(feedbackCommand("/آراء ")).toEqual({ q: "" });
    expect(feedbackCommand("/آراء")).toBeNull();
    expect(feedbackCommand("/آرا ")).toBeNull();
    expect(feedbackCommand("/منتج حراك")).toBeNull();
    expect(feedbackCommand("آراء حراك")).toBeNull();
    expect(feedbackCommand("/آراء حراك\nوسطر ثاني")).toBeNull();
    expect(feedbackCommand(`/آراء ${"ا".repeat(130)}`)).toBeNull();
  });

  it("the words of the other «/» commands are untouched (the product, answers and order menus still open as before)", () => {
    expect(slashCommand("/")).toEqual({ kind: null, q: "" });
    expect(slashCommand("/منتج حراك")).toEqual({ kind: "product", q: "حراك" });
    expect(slashCommand("/رد توصيل")).toEqual({ kind: "reply", q: "توصيل" });
    expect(slashCommand("/طلب ")).toEqual({ kind: "order", q: "" });
    expect(slashCommand("/آراء حراك")).toBeNull();
  });

  const item = (id: string, over: Partial<MediaItemDTO> = {}): MediaItemDTO => ({ id, fileId: `f${id}`, role: "FEEDBACK", caption: null, position: 0, url: `/api/files/f${id}/raw`, ...over });

  it("only feedback with the customer's consent AND an approver's approval is offered; a reader's list (no state) is already only the approved ones", () => {
    const items = [
      item("a"),
      item("b", { state: { consent: true, approved: true } }),
      item("c", { state: { consent: true, approved: false } }),
      item("d", { state: { consent: false, approved: true } }),
      item("e", { role: "GALLERY" }),
    ];
    expect(offerableFeedback(items).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("sendableFeedbackIds (the sheet's «ابعتيهم»): only the offerable ones, at most ten, in the order chosen — an editor's unapproved picture never goes (the review's finding)", () => {
    const many = Array.from({ length: 14 }, (_, i) => item(`m${i}`));
    expect(sendableFeedbackIds([item("a", { state: { consent: true, approved: false } }), item("b"), item("c", { state: { consent: false, approved: true } })])).toEqual(["b"]);
    expect(sendableFeedbackIds(many)).toHaveLength(MAX_FEEDBACK_SEND);
    expect(sendableFeedbackIds(many)[0]).toBe("m0");
    expect(sendableFeedbackIds([])).toEqual([]);
  });

  it("sendInOrder sends one after another, in the order given, and stops at the first failure", async () => {
    const seen: string[] = [];
    const ok = await sendInOrder(["1", "2", "3"], async (id) => (seen.push(id), id));
    expect(ok).toEqual({ sent: ["1", "2", "3"], failed: false });
    const stopped = await sendInOrder(["1", "2", "3"], async (id) => {
      if (id === "2") throw new Error("no");
      return id;
    });
    expect(stopped).toEqual({ sent: ["1"], failed: true });
    expect(MAX_FEEDBACK_SEND).toBe(10);
  });

  const draw = (props: Record<string, unknown> = {}) =>
    inApp(createElement(FeedbackDialog as FunctionComponent<Record<string, unknown>>, { open: true, conversationId: "c1", initialQuery: "", onClose: noop, onSent: noop, portal: false, ...props }));

  it("the dialog opens on a product search, with the ⚠️ and its 🔧 about customers' own chats in view", () => {
    const html = draw();
    expect(html).toContain("data-feedback-note");
    expect(textOf(html)).toContain("⚠️");
    expect(textOf(html)).toContain("🔧");
    expect(html).toContain(AR["chatui.feedback.search"]!);
    expect(html).not.toContain("data-feedback-items");
  });

  it("closed, it draws nothing", () => {
    expect(draw({ open: false })).toBe("");
  });

  it("the doors it uses are the existing ones: the «/» menu's product search, the sheet's media list and its «send to a chat» door", () => {
    const src = read("src/components/chat/v2/feedback/feedback-dialog.tsx");
    const doors = new Set([...src.matchAll(/["'`](\/api\/[^"'`${]*)/g)].map((m) => m[1]!.replace(/\?.*$/, "").replace(/\/$/, "")));
    expect([...doors].sort()).toEqual(["/api/chat/recall", "/api/knowledge"]);
    expect(src).toContain("/media/${encodeURIComponent(attachmentId)}/chat");
    expect(src).toContain("offerableFeedback(list.feedback)");
  });
});

describe("the review's findings on the composer and the dialog", () => {
  const engine = read("src/lib/chat/v2/composer/use-composer.ts");
  const dialog = read("src/components/chat/v2/feedback/feedback-dialog.tsx");

  it("an answer for the list of a conversation the person has left is not shown in the next one (the refresh and the dialog's wait both check the live conversation)", () => {
    expect(engine).toContain("const activeConversation = React.useRef(conversationId);");
    expect(engine).toContain("if (activeConversation.current !== asked) return null;");
    expect(engine).toContain("if (activeConversation.current !== conversationId) return;");
  });

  it("the header's number going down (a row was sent elsewhere) refreshes a list that is already here", () => {
    expect(engine).toContain("if (!plan.loadOnOpen && !listHere.current) return;");
    expect(engine).toContain("listHere.current = scheduledList !== null;");
  });

  it("a late answer for the product that was left is ignored (one ticket per open, and «رجوع» takes it back)", () => {
    expect(dialog).toContain("const ticket = React.useRef(0);");
    expect(dialog).toContain("const mine = ++ticket.current;");
    expect(dialog).toContain("mine === ticket.current");
    expect(dialog).toContain("ticket.current += 1;");
  });

  it("the word «آراء» is a key of the dictionary, not a literal in the code", () => {
    expect(read("src/lib/chat/v2/feedback/feedback-model.ts")).not.toMatch(/"آراء"/);
    expect(AR["chatui.feedback.word"]).toBe("آراء");
  });
});

describe("«/آراء» is wired into the composer without a door of the engine's own", () => {
  it("the engine opens the picker from the command and the button, only for a person who may use the product sheets", () => {
    const engine = read("src/lib/chat/v2/composer/use-composer.ts");
    expect(engine).toContain('detail.me.canRecall && detail.me.recallKinds?.includes("product") ? feedbackCommand(text) : null');
    expect(engine).toContain("if (feedbackAsk) { setFeedback(feedbackAsk); setBody(\"\"); keepDraft(\"\", mentions); return; }");
    expect(engine).not.toContain("/api/knowledge");
  });

  it("the composer draws the dialog beside the «/» menu's, for the same people", () => {
    const src = read("src/components/chat/v2/composer/chat-composer-v2.tsx");
    expect(src).toContain("<FeedbackDialog");
    expect(src).toContain("<RecallDialog");
    expect(src).toContain("onSent={(messages) => messages.forEach((message) => onMessage(message))}");
  });

  const engine = (over: Partial<SurfaceEngine> = {}): SurfaceEngine =>
    ({
      body: "", files: [], busy: false, error: "", progress: [], voice: { mode: "idle" }, face: composerFaceOf({ text: "", fileCount: 0, editing: false, voiceOn: true }), canSubmit: false, choices: [], pickAt: 0, setPick: noop, hint: null,
      textRef: { current: null }, mediaInput: { current: null }, fileInput: { current: null }, addFiles: noop, removeFile: noop, selectMention: noop,
      onTextChange: noop, onKeyDown: noop, onPaste: noop, submit: noop, cancelRecording: noop, sendVoice: noop, onMicPointerDown: noop, onMicClick: noop, setPollOpen: noop, setRecall: noop, setFeedback: noop,
      ...over,
    }) as unknown as SurfaceEngine;
  const surface = (c: SurfaceEngine, me: { canRecall?: boolean; recallKinds?: string[] }) => inApp(createElement(ComposerSurface, { c, me, reply: null, editing: null, onCancelReply: noop, onCancelEdit: noop, recents: [], onEmoji: noop }));

  it("the ⭐ button sits beside «⚡» only where the person may use the product sheets; «⚡» itself is as it was", () => {
    const withKinds = surface(engine(), { canRecall: true, recallKinds: ["product", "reply", "order"] });
    expect(withKinds).toContain("data-recall-button");
    expect(withKinds).toContain("data-feedback-button");
    expect(withKinds).toContain(AR["chatui.feedback.button"]!);
    const noProduct = surface(engine(), { canRecall: true, recallKinds: ["reply"] });
    expect(noProduct).toContain("data-recall-button");
    expect(noProduct).not.toContain("data-feedback-button");
    expect(surface(engine(), {})).not.toContain("data-feedback-button");
    expect(surface(engine(), {})).not.toContain("data-recall-button");
  });
});

describe("the picker for «ابعتيها بالمحادثة» (Q1.2)", () => {
  const row = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto => ({ id, kind: "DM", title: `محادثة ${id}`, emoji: null, space: null, lastMessage: null, unread: 0, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, markedUnread: false, restricted: false, ...over });
  const rows: ChatRowDto[] = [
    row("dm1", { title: "أحمد" }),
    row("grp1", { kind: "GROUP", title: "فريق التصميم" }),
    row("s1", { kind: "SPACE", title: "مبيعات", space: { id: "s1", name: "مبيعات" }, topicChips: [{ id: "t1", title: "الطلبات", emoji: "📦", unread: 0 }, { id: "t2", title: "الشكاوي", emoji: null, unread: 1 }] }),
    row("t9", { kind: "TOPIC", title: "موضوع مستقل", space: { id: "s2", name: "تصنيع" } }),
    row("old", { title: "مؤرشفة", archivedByMe: true }),
  ];

  it("private chats, groups, topics and the topics of a space (its chips) — never a space row, never an archived chat", () => {
    expect(pickableChats(rows).map((c) => c.id)).toEqual(["dm1", "grp1", "t1", "t2", "t9"]);
    expect(pickableChats(rows).find((c) => c.id === "t1")).toMatchObject({ title: "الطلبات", emoji: "📦", space: "مبيعات" });
    expect(pickableChats(rows).find((c) => c.id === "dm1")?.space).toBeNull();
  });

  it("a search narrows it by the chat's name or its space's", () => {
    expect(pickableChats(rows, "طلبات").map((c) => c.id)).toEqual(["t1"]);
    expect(pickableChats(rows, "مبيعات").map((c) => c.id)).toEqual(["t1", "t2"]);
    expect(pickableChats(rows, "  ").length).toBe(5);
    expect(pickableChats(rows, "ما في").length).toBe(0);
  });

  const seeded = () => {
    const qc = new QueryClient();
    installChatDefaults(qc);
    qc.setQueryData(chatKeys.list(), { scope: "all", spaceId: null, canOversee: false, rows } satisfies ChatListDto);
    return qc;
  };
  const draw = (props: Record<string, unknown> = {}) => inApp(createElement(ConversationPickerDialog as FunctionComponent<Record<string, unknown>>, { open: true, onClose: noop, onPick: noop, portal: false, ...props }), seeded());

  it("the dialog lists the chats of the cached list, each a button that picks it by id", () => {
    const html = draw();
    expect(html).toContain("data-pick-search");
    for (const id of ["dm1", "grp1", "t1", "t2", "t9"]) expect(html).toContain(`data-pick-chat="${id}"`);
    expect(html).not.toContain('data-pick-chat="old"');
    expect(html).not.toContain('data-pick-chat="s1"');
    expect(textOf(html)).toContain("أحمد");
  });

  it("while a send runs the buttons are off; closed, nothing is drawn", () => {
    expect(draw({ busy: true })).toContain("disabled");
    expect(draw({ open: false })).toBe("");
  });

  it("the sheet offers the button on every stored picture and on the chosen feedback, and draws the picker only while a choice is wanted (the chat list is not asked for every sheet)", () => {
    const sheet = read("src/components/knowledge/sheet-media.tsx");
    expect(sheet).toContain("data-send-chat={p.id}");
    expect(sheet).toContain("data-send-chat-chosen");
    expect(sheet).toContain("{sending !== null ? <ConversationPickerDialog open");
    expect(sheet).toContain("/media/${encodeURIComponent(attId)}/chat");
    // the chosen feedback goes through the same rule as the dialog's, and the button is there only when something may go
    expect(sheet).toContain("sendableFeedbackIds(chosen)");
    expect(sheet).toContain("{sendable.length > 0 ? (");
    // a partial send keeps the picker open on what is left (nothing that went is sent twice)
    expect(sheet).toContain("setSending(sending.slice(sent.length))");
    expect(AR["chatui.pick.send_chat"]).toBe("ابعتيها بالمحادثة");
  });
});

describe("the strings of this package", () => {
  it("every one is Arabic with no Latin word, and the interpolation names are the ones the code passes", () => {
    const keys = Object.keys(AR).filter((k) => /^chatui\.(feedback|pick)\./.test(k) || k === "chatui.empty.custom");
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const key of keys) {
      const text = AR[key]!.replace(/\{[a-z]+\}/g, "");
      expect(text, key).toMatch(/[؀-ۿ]/);
      expect(text.replace(/[⚠️🔧]/gu, ""), key).not.toMatch(/[A-Za-z]/);
    }
    expect(AR["chatui.feedback.selected"]).toContain("{n}");
    expect(AR["chatui.feedback.selected"]).toContain("{max}");
  });
});
