import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

import { PendingBubble } from "../src/components/chat/message/pending-bubble";
import { OutboxStatusLine } from "../src/components/chat/composer/outbox-status";
import { attachTriggers } from "../src/lib/chat/outbox/registry";
import { FEATURE_DEFAULTS } from "../src/lib/features";
import type { OutboxItem } from "../src/lib/chat/outbox/queue";
import { buildPendingMessage, outboxItemOfPending } from "../src/lib/chat/cache/pending";

const src = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");
const noop = () => undefined;
const item: OutboxItem = { clientId: "k1", conversationId: "c1", body: "رسالة ما انبعتت", mentions: [], createdAt: Date.parse("2026-01-01T10:00:00Z"), attempts: 1 };

describe("the pending bubble", () => {
  const render = (i: OutboxItem, extra: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(PendingBubble, { item: i, onRetry: noop, onDelete: noop, onCopy: noop, onEdit: noop, ...extra }));

  it("is my bubble with a clock: the words, «⏳ بانتظار الإرسال», «إعادة المحاولة» and «احذف»", () => {
    const html = render(item);
    expect(html).toContain("رسالة ما انبعتت");
    expect(html).toContain("⏳ بانتظار الإرسال");
    expect(html).toContain("إعادة المحاولة");
    expect(html).toContain("احذف");
    expect(html).toContain('data-outbox-state="pending"');
    expect(html).toContain('data-message-row="mine"'); // in my style (the accent bubble, my side)
    expect(html).toContain("bg-bubble-out");
    // nothing about failing, and no copy/edit while it is still just waiting
    expect(html).not.toContain("تعذّر الإرسال");
    expect(html).not.toContain("انسخ");
    expect(html).not.toContain("عدّل");
  });

  it("when the server refused it for good it says «تعذّر الإرسال» with the reason, and offers copy, edit and delete", () => {
    const html = render({ ...item, failed: { status: 403, key: "outbox.reason.forbidden" } });
    expect(html).toContain("تعذّر الإرسال");
    expect(html).toContain("ما عاد مسموح لك تكتب بهالمحادثة");
    expect(html).toContain('data-outbox-state="failed"');
    for (const word of ["إعادة المحاولة", "انسخ", "عدّل", "احذف"]) expect(html).toContain(word);
    expect(html).not.toContain("⏳");
    expect(html).toContain("border-danger"); // theme tokens, never a palette colour
  });

  it("draws an attachment-only message without an empty bubble", () => {
    expect(render({ ...item, body: "", attachmentIds: ["f1"] })).toContain("رسالة فيها مرفقات");
  });

  it("uses theme tokens only (no default palette, no hex)", () => {
    const code = src("src/components/chat/message/pending-bubble.tsx");
    expect(code).not.toMatch(/(?:text|bg|border)-(?:red|green|blue|gray|slate|zinc|yellow|amber)-\d/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe("the status line above the composer", () => {
  const render = (props: { pending: number; failed: number; offline: boolean }) => renderToStaticMarkup(React.createElement(OutboxStatusLine, props));

  it("says «ما في نت: 3 رسائل بانتظار الإرسال» while offline", () => {
    expect(render({ pending: 3, failed: 0, offline: true })).toContain("ما في نت: 3 رسائل بانتظار الإرسال");
    expect(render({ pending: 1, failed: 0, offline: true })).toContain("ما في نت: رسالة وحدة بانتظار الإرسال");
    expect(render({ pending: 2, failed: 0, offline: true })).toContain("ما في نت: رسالتين بانتظار الإرسال");
    expect(render({ pending: 11, failed: 0, offline: true })).toContain("ما في نت: 11 رسالة بانتظار الإرسال");
  });

  it("back online and still sending: the same count without «ما في نت»", () => {
    const html = render({ pending: 3, failed: 0, offline: false });
    expect(html).toContain("3 رسائل بانتظار الإرسال");
    expect(html).not.toContain("ما في نت");
  });

  it("counts the ones the server refused apart", () => {
    expect(render({ pending: 0, failed: 2, offline: false })).toContain("رسالتين تعذّر إرسالهم");
  });

  it("is gone when the queue is empty, and its live region (polite) stays so the change is announced", () => {
    const html = render({ pending: 0, failed: 0, offline: true });
    expect(html).not.toContain("بانتظار الإرسال");
    expect(html).not.toContain("<p");
    expect(html).toContain('aria-live="polite"');
  });
});

describe("the moments the queue flushes at once", () => {
  it("the network coming back, the page becoming visible and the window getting focus each flush; a hidden page does not", () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    const flush = vi.fn(async () => undefined);
    const detach = attachTriggers({ flush }, win, doc);
    win.dispatchEvent(new Event("online"));
    expect(flush).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event("focus"));
    expect(flush).toHaveBeenCalledTimes(2);
    doc.dispatchEvent(new Event("visibilitychange")); // hidden: nothing
    expect(flush).toHaveBeenCalledTimes(2);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(3);
    expect(flush).toHaveBeenLastCalledWith({ force: true });
    detach();
    win.dispatchEvent(new Event("online"));
    expect(flush).toHaveBeenCalledTimes(3);
  });
});

describe("the composer and the conversation route failed sends through the outbox (source pins)", () => {
  const composer = src("src/components/chat/composer/chat-composer.tsx");
  const screen = src("src/components/chat/conversation/conversation-screen.tsx");

  it("the composer sends through postChatMessage and keeps a transient or rate-limited answer in the outbox instead of failing", () => {
    expect(composer).toContain("postChatMessage(conversationId, payload");
    expect(composer).toMatch(/outcome\.kind === "transient"\) return keep\(queue, payload\)/);
    expect(composer).toMatch(/outcome\.kind === "limited"\) return keep\(queue, payload, outcome\.retryAfterSec\)/);
    expect(composer).toContain("queue.enqueue(");
    // a definitive refusal is shown with its reason and the text stays in the box
    expect(composer).toContain("outcome.kind === \"refused\" ? t(outcome.failure.key)");
    // offline: straight into the outbox, no request
    expect(composer).toContain("navigator.onLine === false");
  });

  it("a message sent while earlier ones wait goes behind them (order), and a voice note is never queued", () => {
    expect(composer).toContain("queue.forConversation(conversationId).some(i => !i.failed)");
    expect(composer).toMatch(/voice: true \}, false\)/);
  });

  it("a full outbox is an error and the text stays in the box", () => {
    expect(composer).toContain('throw new Error(t("outbox.full"))');
  });

  it("the draft is saved while typing, loaded per conversation and cleared on send", () => {
    expect(composer).toContain("saveComposerDraft(meId, conversationId");
    expect(composer).toContain("loadComposerDraft(meId, conversationId)");
    expect(composer).toContain("clearComposerDraft(meId, conversationId)");
  });

  it("the screen draws the pending bubbles, reconciles by clientId, and never queues for the owner's silent reading", () => {
    expect(screen).toContain("useOutbox(detail?.me.id,outboxOn)");
    expect(screen).toContain("pendingToDraw(outboxItems,conversationId,messages)");
    expect(screen).toContain("<PendingBubble");
    expect(screen).toContain("<OutboxStatusLine");
    expect(screen).toMatch(/const outboxOn=detail\?\.chatOutbox!==false&&Boolean\(detail\?\.me\.canPost\)&&!detail\?\.me\.oversight/);
    // the real message goes in without a second copy
    expect(screen).toContain("appendOnce(current,message)");
  });

  it("the feature switch exists, is ON by default, and the sign-out hook clears every queue of the browser", () => {
    expect(FEATURE_DEFAULTS.chatOutbox).toBe(true);
    expect(src("src/server/chat/topics.ts")).toContain('chatOutbox: await isFeatureOn(ctx.orgId, "chatOutbox")');
    expect(src("src/components/shell/avatar-menu.tsx")).toContain("await clearAllOutboxes()");
  });

  it("no message body is ever logged by the outbox", () => {
    for (const file of ["queue.ts", "send.ts", "storage.ts", "registry.ts"]) {
      expect(src(`src/lib/chat/outbox/${file}`), file).not.toMatch(/console\.|log\.(info|warn|error|debug)\(/);
    }
  });
});

describe("C1.8: a bubble that failed has a red «!»", () => {
  const html = (i: OutboxItem) => renderToStaticMarkup(React.createElement(PendingBubble, { item: i, onRetry: noop, onDelete: noop, onCopy: noop, onEdit: noop }));

  it("a refused message shows the red «!» (hidden from a screen reader: the words say it) beside «تعذّر الإرسال» and «إعادة المحاولة»", () => {
    const failed = html({ ...item, failed: { status: 403, key: "outbox.reason.forbidden" } });
    expect(failed).toContain("data-outbox-bang");
    expect(failed).toMatch(/data-outbox-bang[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-outbox-bang/);
    expect(failed).toContain("bg-danger");
    expect(failed).toContain("text-danger-fg"); // a theme token, never white
    expect(failed).toContain("إعادة المحاولة");
  });

  it("a message that is only waiting has the clock and no «!»", () => {
    expect(html(item)).not.toContain("data-outbox-bang");
  });

  it("a pending message of the cache is drawn by the same bubble (its words, its time, its reason)", () => {
    const m = { ...buildPendingMessage({ clientId: "k9", body: "من الكاش", author: { id: "u1", name: "أنا" }, now: new Date("2026-01-01T10:00:00Z") }), pending: { state: "failed" as const, reason: "outbox.reason.invalid" } };
    const out = html(outboxItemOfPending("c1", m));
    expect(out).toContain("من الكاش");
    expect(out).toContain('data-pending-message="k9"');
    expect(out).toContain('data-outbox-state="failed"');
    expect(out).toContain("data-outbox-bang");
  });
});
