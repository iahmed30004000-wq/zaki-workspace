/**
 * C1.8 — the composer's optimistic path is ADDITIVE: it needs the `optimistic` prop (the chat cache's QueryClient) AND an outbox AND a plain text; the
 * old screen passes no such prop and behaves exactly as before. (No browser here: the behaviour of the path itself is proven on `startOptimisticSend`,
 * `tests/chat-optimistic-send.test.ts`; these tests pin how the composer and the old screen are wired to it.)
 */
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConversationDto } from "../src/server/chat/dto";

(globalThis as { React?: typeof React }).React = React;

import { ChatComposer } from "../src/components/chat/composer/chat-composer";
import { I18nProvider } from "../src/lib/i18n";

const Translations = I18nProvider as unknown as React.FunctionComponent<{ initial: "ar"; children?: React.ReactNode }>;
const inI18n = (node: React.ReactElement) => renderToStaticMarkup(React.createElement(Translations, { initial: "ar" }, node));

const src = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");
const composer = src("src/components/chat/composer/chat-composer.tsx");

const detail = { id: "c1", kind: "TOPIC", me: { id: "me", canPost: true, canModerate: false, muted: false, oversight: false, canJoin: false }, members: [{ id: "me", name: "أنا", online: true }], messages: [], readers: [] } as unknown as ConversationDto;
const noop = () => undefined;

describe("C1.8: the composer's optimistic path is opt-in", () => {
  it("renders with and without the prop (the same box either way)", () => {
    const base = { conversationId: "c1", detail, onMessage: noop, reply: null, onCancelReply: noop };
    const old = inI18n(React.createElement(ChatComposer, base));
    const withProp = inI18n(React.createElement(ChatComposer, { ...base, optimistic: { qc: new QueryClient() } }));
    expect(withProp).toBe(old);
    expect(old).toContain("chat-message");
  });

  it("the branch needs the prop, an outbox, the outbox switch, and no files; otherwise the old flow runs untouched", () => {
    expect(composer).toMatch(/if \(optimistic && outbox && draftOn && !files\.length\)/);
    // the old flow's pieces are all still there, after the branch
    for (const piece of ["await postMessage(", "setBusy(true)", "uploadWithProgress(\"/api/chat/uploads\"", "keep(queue, payload)"]) expect(composer).toContain(piece);
    expect(composer.indexOf("startOptimisticSend")).toBeLessThan(composer.indexOf("await postMessage("));
  });

  it("the effect is keyed on the QueryClient, not on the prop object (a parent that passes `{ qc }` inline must not re-subscribe on every render)", () => {
    expect(composer).toContain("}, [optimisticQc, outbox, conversationId]);");
    expect(composer).toContain("const optimisticQc = optimistic?.qc ?? null;");
  });

  it("a voice note and an edit never take the optimistic path", () => {
    // the voice path calls postMessage directly (never submit()), and an edit returns before the branch
    expect(composer).toMatch(/if \(editing\) return void saveEdit\(\);\s*\n\s*if \(busy/);
    expect(composer).not.toMatch(/sendVoice[\s\S]{0,2500}startOptimisticSend/);
  });

  it("the outbox decides what a handed-over bubble looks like, and an unmount unsubscribes", () => {
    expect(composer).toContain("syncPendingWithOutbox(qc, conversationId, outbox.forConversation(conversationId))");
    expect(composer).toContain("dropStalePending(");
    expect(composer).toContain("replacePending(qc, conversationId, message)");
    expect(composer).toMatch(/return \(\) => \{ offSent\(\); offChange\(\); \}/);
  });
});

describe("C1.8: the old screen is untouched", () => {
  const screen = src("src/components/chat/conversation/conversation-screen.tsx");

  it("does not pass the prop, does not import the pending cache and keeps its own pending-bubble flow", () => {
    expect(screen).not.toContain("optimistic");
    expect(screen).not.toContain("cache/pending");
    expect(screen).toContain("pendingToDraw(");
    expect(screen).toContain("<PendingBubble");
    expect(screen).toContain("canMarkReadNow");
  });

  it("the read gate keeps `canMarkReadNow` (the old screen's own import)", () => {
    expect(src("src/lib/chat/read-gate.ts")).toContain("export function canMarkReadNow");
  });
});
