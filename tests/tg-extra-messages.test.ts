/**
 * «الرد في محادثة أخرى», «تعديل صورة أو ملف», «خيارات إضافية للاستطلاع» and «المقالات»: the pure rules and what the one presenter sends. The rules that need a database
 * (who may read, post, vote) are in tests/db/tg-cross-reply.test.ts, tg-edit-media.test.ts and tg-polls-articles.test.ts.
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { presentMessage, type Viewer } from "@/server/chat/redact";
import { cleanPollExtras, hasPollExtras, presentPoll, type PollRow, type PollViewer } from "@/server/chat/poll-shared";
import { sendSchema, editSchema } from "@/server/chat/messages";
import { CROSS_TEXT_MAX, crossSnapshotOf, readCrossSnapshot } from "@/lib/chat/cross-reply";
import { articleBodyProblem, articleExcerpt, articleProblem, compactArticleImages, insertPictureLine, joinArticle, parseArticle, prefixLines, splitArticle, unplacedImages } from "@/lib/chat/article";
import { buildPollPayload, correctAfter, emptyPollDraft, pollDraftProblem, quizPatch } from "@/lib/chat/poll-client";
import { menuFor, type MessageMenuContext } from "@/components/chat/message/message-menu-registry";
import { sanitizeItem } from "@/lib/chat/outbox/queue";
import { normalizeMessage } from "@/lib/chat/cache/reducers";
import { attachItemsOf, attachTabsOf } from "@/lib/chat/v2/composer/attach-items";
import { rowPreview } from "@/lib/chat/row-preview";
import { FEATURES, FEATURE_DEFAULTS, FEATURE_META } from "@/lib/features";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AR } from "@/lib/i18n/dict";
import { ArticleBody } from "@/components/chat/v2/article/article-body";
import { CrossReplyBlock } from "@/components/chat/v2/bubble/cross-quote";
import type { MessageDto } from "@/server/chat/dto";
import type { ChatRowDto } from "@/lib/chat/cache/types";

(globalThis as { React?: typeof React }).React = React;

const AT = new Date("2026-11-27T10:00:00.000Z");
const viewer = (over: Partial<Viewer> = {}): Viewer => ({ userId: "me", role: "MEMBER", oversight: false, canModerateHere: false, isMember: true, canPost: true, ...over });
const row = (over: Record<string, unknown> = {}) => ({ id: "reply-1", kind: "TEXT", body: "ردّي", createdAt: AT, pinned: false, editedAt: null, deletedAt: null, authorId: "other", author: { id: "other", name: "Bee" }, ...over });
const carried = { crossReply: { author: "Writer", text: "المقطع", kind: "text" }, crossReplyToId: "SOURCE-ID", crossReplyTo: { deletedAt: null, conversationId: "SOURCE-CONVERSATION", orgId: "o" } };

describe("the four switches", () => {
  it("are on by default, in the chat group under the new chat screen, with their Arabic lines", () => {
    for (const key of ["chatReplyElsewhere", "chatEditMedia", "chatPollExtras", "chatArticles"] as const) {
      expect(FEATURES).toContain(key);
      expect(FEATURE_DEFAULTS[key]).toBe(true);
      expect(FEATURE_META[key]).toEqual({ group: "chat", dependsOn: ["chatLayoutV2"] });
      expect(AR[`features.${key}.name`]).toBeTruthy();
      expect(AR[`features.${key}.hint`]).toBeTruthy();
    }
  });
});

describe("«الرد في محادثة أخرى»: what is carried", () => {
  it("the name and a short piece: markers gone, a spoiler hidden BEFORE the cut, 200 characters at most", () => {
    const snap = crossSnapshotOf({ kind: "TEXT", body: `**مهم** ||${"سر ".repeat(100).trim()}|| ${"ك".repeat(400)}`, authorName: "Writer", attachments: [] });
    expect(snap.author).toBe("Writer");
    expect(snap.text).not.toContain("سر");
    expect(snap.text.startsWith("مهم •••")).toBe(true);
    expect([...snap.text].length).toBeLessThanOrEqual(CROSS_TEXT_MAX);
  });

  it("a voice note carries no words, a file only its kind, an article only its title", () => {
    expect(crossSnapshotOf({ kind: "VOICE", body: "نص مكتوب", authorName: "W", attachments: [{ kind: "AUDIO" }] })).toEqual({ author: "W", text: "", kind: "voice" });
    expect(crossSnapshotOf({ kind: "TEXT", body: "", authorName: "W", attachments: [{ kind: "FILE" }] })).toEqual({ author: "W", text: "", kind: "file" });
    expect(crossSnapshotOf({ kind: "ARTICLE", body: "العنوان\nنص سري طويل", authorName: "W", attachments: [] })).toEqual({ author: "W", text: "العنوان", kind: "article" });
    expect(readCrossSnapshot({ author: "x", text: "y", kind: "other" })).toBeNull();
  });
});

describe("«الرد في محادثة أخرى»: what each viewer is sent", () => {
  it("never the source's id or conversation; the way there only for the ids the loader judged readable", () => {
    const dto = presentMessage(row(carried), viewer({ crossReply: { jumpable: new Set() } }));
    expect(dto.crossReply).toEqual({ authorName: "Writer", text: "المقطع", kind: "text" });
    expect(JSON.stringify(dto)).not.toContain("SOURCE");
    expect(presentMessage(row(carried), viewer({ crossReply: { jumpable: new Set(["reply-1"]) } })).crossReply?.jump).toBe(true);
  });

  it("a loader that did not ask sends nothing at all (the switch off reads the same way)", () => {
    const dto = presentMessage(row(carried), viewer());
    expect(dto.crossReply).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain("المقطع");
    expect(JSON.stringify(dto)).not.toContain("SOURCE");
  });

  it("a guest: no writer's name and never a way there", () => {
    const dto = presentMessage(row(carried), viewer({ role: "GUEST", crossReply: { jumpable: new Set(["reply-1"]) } }));
    expect(dto.crossReply).toEqual({ authorName: "", text: "المقطع", kind: "text" });
  });

  it("a deleted source, or one whose row is gone, takes the words away from everybody; a deleted reply has no quote", () => {
    for (const source of [{ deletedAt: AT, conversationId: "SOURCE-CONVERSATION", orgId: "o" }, null]) {
      const dto = presentMessage(row({ ...carried, crossReplyTo: source }), viewer({ oversight: true, crossReply: { jumpable: new Set(["reply-1"]) } }));
      expect(dto.crossReply).toEqual({ authorName: "Writer", text: null, kind: "text", gone: true });
      expect(JSON.stringify(dto)).not.toContain("المقطع");
    }
    expect(presentMessage(row({ ...carried, deletedAt: AT }), viewer({ crossReply: { jumpable: new Set() } })).crossReply).toBeUndefined();
  });

  it("the quote is a button only where the server said jump; its words are text, never markup", () => {
    const open = renderToStaticMarkup(createElement(CrossReplyBlock, { crossReply: { authorName: "W", text: "<img src=x onerror=alert(1)>", kind: "text", jump: true }, onOpen: () => {} }));
    expect(open).toContain("data-cross-open");
    expect(open).not.toContain("<img");
    expect(renderToStaticMarkup(createElement(CrossReplyBlock, { crossReply: { authorName: "W", text: "x", kind: "text" }, onOpen: () => {} }))).not.toContain("<button");
  });

  it("the tombstone of the device cache keeps no quote, and the outbox keeps only the source's id", () => {
    const dead = normalizeMessage({ id: "m", deleted: true, body: null, edited: false, attachments: [], reactions: [], mentions: [], crossReply: { authorName: "W", text: "x", kind: "text" } } as unknown as MessageDto);
    expect(dead.crossReply).toBeUndefined();
    const item = sanitizeItem({ clientId: "c", conversationId: "k", body: "ن", mentions: [], createdAt: 1, attempts: 0, crossReplyId: "s", crossReply: { text: "x" } });
    expect(item).toMatchObject({ crossReplyId: "s" });
    expect(JSON.stringify(item)).not.toContain("\"text\"");
    expect(sanitizeItem({ clientId: "c", conversationId: "k", body: "ن", mentions: [], createdAt: 1, replyToId: "r", crossReplyId: "s" })).not.toHaveProperty("crossReplyId");
  });
});

describe("the edit history's old files", () => {
  const revisions = [{ body: "قبل", createdAt: AT }];
  const replacedFiles = [{ id: "old-att", kind: "IMAGE", replacedAt: AT, file: { id: "f", name: "old.png", mimeType: "image/png", size: 4 } }];
  it("are told to the holder of oversight only, under the edit that took them off", () => {
    expect(presentMessage(row({ editedAt: AT, revisions, replacedFiles }), viewer({ oversight: true })).history).toEqual([
      { body: "قبل", editedAt: AT.toISOString(), files: [{ id: "old-att", kind: "IMAGE", name: "old.png", mime: "image/png", size: 4, url: "/api/chat/attachments/old-att" }] },
    ]);
    for (const v of [viewer(), viewer({ userId: "other" }), viewer({ canModerateHere: true })]) expect(JSON.stringify(presentMessage(row({ editedAt: AT, revisions, replacedFiles }), v))).not.toContain("old-att");
  });
});

describe("the limits of a send and an edit", () => {
  it("an ordinary message stays at 4000; an article may be long", () => {
    expect(sendSchema.safeParse({ body: "ا".repeat(4001) }).success).toBe(false);
    expect(sendSchema.safeParse({ body: "ا".repeat(4001), article: true }).success).toBe(true);
    expect(sendSchema.safeParse({ body: "ا".repeat(20_001), article: true }).success).toBe(false);
    expect(editSchema.safeParse({ body: "" }).success).toBe(true);
    expect(editSchema.safeParse({ body: "ا".repeat(20_001) }).success).toBe(false);
  });

  it("the snapshot is never taken from the browser: only the source's id is read", () => {
    const parsed = sendSchema.parse({ body: "x", crossReply: { messageId: "m", text: "ملفق" } });
    expect(parsed.crossReply).toEqual({ messageId: "m" });
  });

  it("in the composer only the edit of a message that keeps its file may be saved with no words (the plain edit is as it was)", () => {
    const engine = readFileSync(path.resolve(__dirname, "..", "src/lib/chat/v2/composer/use-composer.ts"), "utf8");
    expect(engine).toContain("if (editing && editsMedia) return void saveMediaEdit();");
    expect(engine).toContain('const editsMedia = editing !== null && detail.editMedia === true && editing.attachments.length > 0');
  });
});

describe("the message menu", () => {
  const ctx: MessageMenuContext = { mine: true, deleted: false, kind: "TEXT", hasText: false, pinned: false, conversationKind: "TOPIC", canPost: true, canModerate: false, oversight: false, surface: "v2" };
  const ids = (c: Partial<MessageMenuContext>) => menuFor({ ...ctx, ...c }).map((a) => a.id);

  it("«الرد في محادثة أخرى» only on the new screen and only where the header says so; never to the silent eye", () => {
    expect(ids({ canReplyElsewhere: true })).toContain("replyElsewhere");
    expect(ids({})).not.toContain("replyElsewhere");
    expect(menuFor({ ...ctx, surface: undefined, canReplyElsewhere: true }).map((a) => a.id)).not.toContain("replyElsewhere");
    expect(ids({ canReplyElsewhere: true, oversight: true })).toEqual([]);
  });

  it("«عدّل» on my photo with no words only with the media switch; on my article only with the articles switch", () => {
    expect(ids({ hasFiles: true })).not.toContain("edit");
    expect(ids({ hasFiles: true, canEditMedia: true })).toContain("edit");
    expect(ids({ hasFiles: true, canEditMedia: true, mine: false })).not.toContain("edit");
    expect(ids({ kind: "ARTICLE", hasText: true })).not.toContain("edit");
    expect(ids({ kind: "ARTICLE", hasText: true, canEditArticle: true })).toContain("edit");
    expect(ids({ kind: "VOICE", hasFiles: true, canEditMedia: true })).not.toContain("edit");
  });
});

describe("the extra poll options", () => {
  const poll = (over: Partial<PollRow> = {}, votes: Record<string, string[]> = {}): PollRow => ({
    id: "p", multiple: false, anonymous: false, closesAt: null, closedAt: null, explanation: "لأن",
    options: ["a", "b", "c"].map((id) => ({ id, text: id, correct: id === "b", votes: (votes[id] ?? []).map((userId) => ({ userId, user: { name: userId } })) })),
    ...over,
  });
  const who = (userId: string, over: Partial<PollViewer> = {}): PollViewer => ({ userId, role: "MEMBER", oversight: false, isMember: true, canModerateHere: false, canPost: true, ...over });
  const asker = "asker";

  it("a quiz: no answer, no line and no counts before the vote; all of it after; the asker knows; a guest learns only at the close", () => {
    const q = poll({ quiz: true }, { a: ["x"] });
    const before = presentPoll(q, who("me"), asker, false);
    expect(before.resultsHidden).toBe(true);
    expect(JSON.stringify(before)).not.toContain("correct");
    expect(JSON.stringify(before)).not.toContain("لأن");
    expect(before.options.every((o) => o.count === 0 && !o.voters)).toBe(true);
    expect(before.canVote).toBe(true);
    const after = presentPoll(q, who("x"), asker, false);
    expect(after.explanation).toBe("لأن");
    expect(after.options.map((o) => o.correct)).toEqual([false, true, false]);
    expect(after.canVote).toBe(false);
    expect(after.options[0]!.count).toBe(1);
    expect(presentPoll(q, who(asker), asker, false).explanation).toBe("لأن");
    expect(JSON.stringify(presentPoll(q, who("g", { role: "GUEST" }), asker, false))).not.toContain("correct");
    expect(presentPoll({ ...q, closedAt: AT }, who("g", { role: "GUEST" }), asker, false).explanation).toBe("لأن");
  });

  it("hidden results: nothing leaves until the close, not even to the asker", () => {
    const hidden = poll({ hideResults: true }, { a: ["x", "y"] });
    for (const v of ["me", "x", asker]) {
      const dto = presentPoll(hidden, who(v), asker, false);
      expect(dto.options.map((o) => [o.count, o.percent, o.voters])).toEqual([[0, 0, undefined], [0, 0, undefined], [0, 0, undefined]]);
    }
    expect(presentPoll({ ...hidden, closesAt: new Date(Date.now() - 1000) }, who("me"), asker, false).options[0]!.count).toBe(2);
  });

  it("adding an option takes an open poll and the right to post; one vote stays one", () => {
    const open = poll({ openOptions: true });
    expect(presentPoll(open, who("me"), asker, false).canAddOption).toBe(true);
    expect(presentPoll(open, who("me", { canPost: false }), asker, false).canAddOption).toBeUndefined();
    expect(presentPoll(open, who("me", { role: "GUEST" }), asker, false).canAddOption).toBeUndefined();
    expect(presentPoll({ ...open, closedAt: AT }, who("me"), asker, false).canAddOption).toBeUndefined();
    expect(presentPoll(poll(), who("me"), asker, false).canAddOption).toBeUndefined();
    expect(presentPoll(poll({ noRevote: true }, { a: ["me"] }), who("me"), asker, false).canVote).toBe(false);
  });

  it("a shuffled poll: one person always sees one order, the asker sees their own", () => {
    const shuffled = poll({ shuffle: true });
    const order = (v: string) => presentPoll(shuffled, who(v), asker, false).options.map((o) => o.id).join("");
    expect(order("u1")).toBe(order("u1"));
    expect(order(asker)).toBe("abc");
    expect(new Set(Array.from({ length: 20 }, (_, i) => order(`u${i}`))).size).toBeGreaterThan(1);
  });

  it("an old poll is presented exactly as before (no new field)", () => {
    expect(Object.keys(presentPoll(poll({ explanation: null }), who("me"), asker, false)).sort()).toEqual(["anonymous", "canClose", "canVote", "closed", "closesAt", "id", "multiple", "options", "voters"]);
  });

  it("the shapes the server takes: a quiz has one right answer, found by its words after the blanks go", () => {
    expect(cleanPollExtras({ options: ["", "x", "y"], quiz: true, correctOption: 2 }, ["x", "y"])).toMatchObject({ extras: { correct: 1, noRevote: true } });
    for (const bad of [{ quiz: true }, { quiz: true, correctOption: 0, multiple: true }, { quiz: true, correctOption: 0, openOptions: true }, { correctOption: 0 }, { explanation: "e" }]) {
      expect(cleanPollExtras({ options: ["x", "y"], ...bad }, ["x", "y"]), JSON.stringify(bad)).toHaveProperty("error");
    }
    expect(hasPollExtras({ options: ["x", "y"], multiple: true, anonymous: true })).toBe(false);
    expect(hasPollExtras({ options: ["x", "y"], shuffle: true })).toBe(true);
  });

  it("the form: the right answer follows its option, is counted in the options as sent, and the old payload is unchanged", () => {
    const draft = { ...emptyPollDraft(), question: "؟", options: ["أ", "", "ب"], ...quizPatch(true), correct: 2 };
    expect(pollDraftProblem(draft)).toBeNull();
    expect(buildPollPayload(draft, "c").poll).toEqual({ options: ["أ", "ب"], quiz: true, correctOption: 1 });
    expect(pollDraftProblem({ ...draft, correct: 1 })).toBe("correct");
    expect(correctAfter(2, [2, 0, 1])).toBe(0);
    expect(correctAfter(1, [0, 2])).toBeNull();
    expect(buildPollPayload({ ...emptyPollDraft(), question: "؟", options: ["أ", "ب"] }, "c").poll).toEqual({ options: ["أ", "ب"] });
  });
});

describe("«المقالات»", () => {
  it("a title line and the content; what is not an article", () => {
    expect(splitArticle(joinArticle("  عنوان  ", "نص\nسطر"))).toEqual({ title: "عنوان", content: "نص\nسطر" });
    expect(articleProblem("", "نص")).toBe("title");
    expect(articleProblem("ا".repeat(121), "نص")).toBe("title");
    expect(articleProblem("ع", "  \n ")).toBe("content");
    expect(articleProblem("ع", "ا".repeat(20_000))).toBe("long");
    expect(articleBodyProblem("عنوان بس")).toBe("content");
    expect(articleProblem("ع", "نص")).toBeNull();
  });

  it("headings, lists, pictures and words; a code block keeps its marks; a picture that is not there stays words", () => {
    const content = "## قسم\n- أ\n- ب\n1. واحد\n\n![2]\nفقرة\n```\n# تعليق\n- ليس قائمة\n```\n![9]";
    expect(parseArticle(content, 2)).toEqual([
      { t: "heading", level: 2, text: "قسم" },
      { t: "list", ordered: false, items: ["أ", "ب"] },
      { t: "list", ordered: true, items: ["واحد"] },
      { t: "image", index: 1 },
      { t: "text", text: "فقرة\n```\n# تعليق\n- ليس قائمة\n```\n![9]" },
    ]);
    expect(unplacedImages(parseArticle(content, 2), 2)).toEqual([0]);
  });

  it("NO HTML and no unsafe link, whatever is typed: every word is drawn by the formatter", () => {
    const html = renderToStaticMarkup(createElement(ArticleBody, { content: "## <script>alert(1)</script>\n- <img src=x onerror=alert(1)>\n[اضغط](javascript:alert(1))\n<iframe></iframe>\n[موقع](https://example.com)", pictures: [] }));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain('href="https://example.com');
  });

  it("the card's excerpt has no marks and hides a spoiler; the list row says the title only", () => {
    expect(articleExcerpt("## قسم\n- **أ**\n![1]\n||سر||")).toBe("قسم أ •••");
    const row = { kind: "DM", lastMessage: { id: "m", kind: "ARTICLE", preview: "العنوان\nبقية المقال", authorName: "W", mine: false, at: AT.toISOString() } } as unknown as ChatRowDto;
    expect(rowPreview(row).text).toBe("📄 العنوان");
  });

  it("the editor's helpers: only the pictures the words name are sent, renumbered in their order", () => {
    expect(compactArticleImages("![3]\nنص\n![1]\n![3]\n![7]", 3)).toEqual({ content: "![1]\nنص\n![2]\n![1]\n", used: [2, 0] });
    expect(prefixLines("أ\nب", 0, 3, "- ")).toEqual({ value: "- أ\n- ب", start: 0, end: 7 });
    expect(prefixLines("- أ", 3, 3, "- ").value).toBe("أ");
    expect(prefixLines("", 0, 0, "## ")).toEqual({ value: "## ", start: 3, end: 3 });
    expect(insertPictureLine("قبل", 3, 1)).toEqual({ value: "قبل\n![1]\n", caret: 9 });
  });

  it("«مقال» is offered only where the header says so", () => {
    expect(attachItemsOf({})).toEqual(["media", "file"]);
    expect(attachItemsOf({ canArticle: true })).toEqual(["media", "file", "article"]);
    expect(attachTabsOf({ canArticle: true })).toContain("article");
    expect(attachTabsOf({})).not.toContain("article");
  });
});
