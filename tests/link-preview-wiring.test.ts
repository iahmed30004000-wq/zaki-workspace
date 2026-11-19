import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageBubble, type MessageBubbleProps } from "@/components/chat/v2/message-bubble";
import { chatKeys, LATEST } from "@/lib/chat/cache";
import { frameWantsSync } from "@/lib/chat/cache/runtime";
import { mergeMessage } from "@/lib/chat/cache/reducers";
import { buildChatMessagePayload } from "@/lib/chat/conversation/client";
import { Outbox, sanitizeItem } from "@/lib/chat/outbox/queue";
import { memoryOutboxStorage } from "@/lib/chat/outbox/storage";
import { startOptimisticSend } from "@/lib/chat/outbox/optimistic";
import { sendOutboxItem } from "@/lib/chat/outbox/send";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { doors, removePreviewOf } from "@/lib/chat/v2/pane/message-actions";
import type { LinkPreviewDto } from "@/server/chat/dto";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";

(globalThis as { React?: typeof React }).React = React;

/**
 * C3b.2 wiring — the pieces the link-preview package built on the server are reachable from the screen: the composer's ✕ travels with the send (through the
 * optimistic path, the outbox and a retry), the card is drawn in the bubble, «شيل المعاينة» calls its door and says what happened, and the card that arrives
 * after the send reaches the open screen through the cache without a reload.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const CARD: LinkPreviewDto = { url: "https://news.example.com/a", title: "خبر عاجل", description: "تفاصيل", siteName: "الأخبار", image: "/api/chat/messages/m1/preview/image" };
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const noop = () => undefined;
function draw(over: Partial<MessageBubbleProps> & { header?: Parameters<typeof makeHeader>[0] } = {}): string {
  const { header, ...rest } = over;
  const props: MessageBubbleProps = { message: makeMessage({ preview: CARD }), conversationId: "c1", facts: bubbleFactsOf(makeHeader({ linkPreviews: true, ...header })), start: true, end: true, mentionNames: [], onReact: noop, onJump: noop, ...rest };
  return renderToStaticMarkup(createElement(Queries, { client: new QueryClient() }, createElement(MessageBubble, props) as ReactElement));
}

afterEach(() => vi.unstubAllGlobals());

describe("the composer's ✕ travels with the send (no visit is made for a link the person refused)", () => {
  const base = { body: "https://example.com/a", attachmentIds: [], mentions: [], clientId: "c-1" };

  it("the payload carries `noPreview: true` only when it was pressed", () => {
    expect(buildChatMessagePayload({ ...base, noPreview: true })).toMatchObject({ noPreview: true });
    expect("noPreview" in buildChatMessagePayload(base)).toBe(false);
    expect("noPreview" in buildChatMessagePayload({ ...base, noPreview: false })).toBe(false);
  });

  it("the request body of the send has it (the server's `sendSchema` reads it)", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(makeMessage()), { status: 200, headers: { "content-type": "application/json" } });
    });
    await sendOutboxItem({ clientId: "c-1", conversationId: "k1", body: "https://example.com/a", mentions: [], createdAt: 1, attempts: 1, noPreview: true });
    await sendOutboxItem({ clientId: "c-2", conversationId: "k1", body: "https://example.com/b", mentions: [], createdAt: 2, attempts: 1 });
    expect(bodies[0]).toMatchObject({ noPreview: true });
    expect(bodies[1]).not.toHaveProperty("noPreview");
  });

  it("a send that waits in the outbox keeps the ✕ (a retry after a reload must not visit the link)", () => {
    const outbox = new Outbox({ userId: "u1", storage: memoryOutboxStorage(), send: async () => ({ kind: "transient" }) });
    const queued = outbox.enqueue({ clientId: "c-1", conversationId: "k1", body: "https://example.com/a", mentions: [], noPreview: true });
    expect(queued.ok && queued.item.noPreview).toBe(true);
    const plain = outbox.enqueue({ clientId: "c-2", conversationId: "k1", body: "https://example.com/b", mentions: [] });
    expect(plain.ok && "noPreview" in plain.item).toBe(false);
    // what is stored and read back by the next page keeps it
    const stored = JSON.parse(JSON.stringify(outbox.getSnapshot()[0]));
    expect(sanitizeItem(stored)?.noPreview).toBe(true);
    expect(sanitizeItem(JSON.parse(JSON.stringify(outbox.getSnapshot()[1])))).not.toHaveProperty("noPreview");
    outbox.dispose();
  });

  it("the optimistic send hands the outbox the ✕ when it cannot post now, and posts it when it can", async () => {
    const enqueued: Array<Record<string, unknown>> = [];
    const posted: Array<Record<string, unknown>> = [];
    const seeded = () => {
      const qc = new QueryClient();
      qc.setQueryData(chatKeys.messages("k1"), { pages: [{ messages: [makeMessage({ id: "m0", createdAt: "2026-03-01T10:00:00.000Z" })], hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [] }], pageParams: [LATEST] });
      return qc;
    };
    const outbox = { enqueue: (input: Record<string, unknown>) => (enqueued.push(input), { ok: true as const, item: input as never }), forConversation: () => [], flush: async () => undefined, retryNow: () => undefined, remove: () => undefined };
    const author = { id: "u1", name: "أنا", avatar: null };
    const payload = { body: "https://example.com/a", attachmentIds: [], mentions: [], clientId: "c-1", noPreview: true };
    const offline = startOptimisticSend({ qc: seeded(), outbox: outbox as never, online: () => false }, { conversationId: "k1", payload, author });
    expect(offline.shown).toBe(true);
    expect(enqueued[0]).toMatchObject({ noPreview: true });
    const online = startOptimisticSend(
      { qc: seeded(), outbox: outbox as never, online: () => true, post: async (_c, p) => (posted.push(p as never), { kind: "sent", message: makeMessage({ id: "m9", clientId: "c-3" }) }) },
      { conversationId: "k1", payload: { ...payload, clientId: "c-3" }, author },
    );
    expect(online.shown).toBe(true);
    if (online.shown) await online.done;
    expect(posted[0]).toMatchObject({ noPreview: true });
  });

  it("the engine puts the flag in EVERY payload it builds for a text (optimistic, direct, queued) and reads it from the surface's report", () => {
    const engine = read("src/lib/chat/v2/composer/use-composer.ts");
    expect(engine).toContain("const [noPreview, setNoPreview] = React.useState(false);");
    // the two send payloads (the optimistic one and the direct one) and the outbox copy of a queued one
    expect(engine.match(/\.\.\.\(noPreview \? \{ noPreview: true \} : \{\}\)/g)?.length).toBe(2);
    expect(engine).toContain("...(payload.noPreview ? { noPreview: true } : {})");
    // an edit never carries it (the server does not visit on an edit)
    const edit = engine.slice(engine.indexOf("async function saveEdit"), engine.indexOf("/** The send itself"));
    expect(edit).not.toContain("noPreview");
    expect(engine).toMatch(/noPreview, setNoPreview/);
    const composer = read("src/components/chat/v2/composer/chat-composer-v2.tsx");
    expect(composer).toContain("onNoPreviewChange={c.setNoPreview}");
    // the line about the visit is a WARNING: it is drawn unless the header says the switch is off (a header cached before this deploy says nothing: the person still gets the warning and the ✕)
    expect(composer).toContain("linkPreviews={detail.linkPreviews !== false}");
  });
});

describe("the card in the bubble", () => {
  it("is drawn under the words when the message carries one", () => {
    const html = draw();
    expect(html).toContain("data-link-preview");
    expect(html).toContain("خبر عاجل");
    expect(html).toContain('href="https://news.example.com/a"');
    expect(html.indexOf("data-link-preview")).toBeGreaterThan(html.indexOf("نص الرسالة"));
  });

  it("is not drawn without a `preview`, or when the header says the company's switch is off", () => {
    expect(draw({ message: makeMessage() })).not.toContain("data-link-preview");
    expect(draw({ header: { linkPreviews: false } })).not.toContain("data-link-preview");
    // a header that does not say (an old cached one) draws none: the card is never shown on the strength of silence
    expect(draw({ header: { linkPreviews: undefined } })).not.toContain("data-link-preview");
  });

  it("the author's menu offers «شيل المعاينة» on a message with a card, and nobody else's does", () => {
    const menu = read("src/components/chat/v2/pane/seams/menu-host.tsx");
    expect(menu).toContain('else if (id === "removePreview") void commands.removePreview(message);');
  });
});

describe("«شيل المعاينة»", () => {
  it("calls DELETE /api/chat/messages/<id>/preview", () => {
    expect(doors.removePreview("m 1")).toEqual({ path: "/api/chat/messages/m%201/preview", method: "DELETE" });
  });

  it("says «انشالت المعاينة» when the server removed it, and «ما انشالت المعاينة» on a refusal or a fault", async () => {
    const answer = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
    expect(await removePreviewOf("m1", answer(200))).toEqual({ ok: true, key: "chatlp.removed" });
    expect(await removePreviewOf("m1", answer(403))).toEqual({ ok: false, key: "chatlp.remove_failed" });
    expect(await removePreviewOf("m1", answer(404))).toEqual({ ok: false, key: "chatlp.remove_failed" });
    expect(await removePreviewOf("m1", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toEqual({ ok: false, key: "chatlp.remove_failed" });
  });

  it("the pane's command runs it, says the toast and asks the feed to catch up", () => {
    const actions = read("src/components/chat/v2/pane/pane-actions.tsx");
    expect(actions).toContain("removePreview: (message: MessageDto) => Promise<boolean>;");
    expect(actions).toContain("const result = await removePreviewOf(message.id);");
    // the feed is asked after a refusal too (the switch may have been turned off, the card may be gone): the screen shows the truth
    expect(actions).toMatch(/removePreview: async[\s\S]*say\(result\.key, result\.ok \? "success" : "error"\);\s*scheduleSync\(qc\);/);
  });
});

describe("a card that arrives after the send reaches the open screen without a reload", () => {
  it("`message.enriched` is a frame that asks the sync feed (it is not stream-only)", () => {
    expect(frameWantsSync({ kind: "message.enriched" })).toBe(true);
  });

  it("the feed's answer replaces the message in place with its card, and again without it after the removal", () => {
    const page = (messages: ReturnType<typeof makeMessage>[]) => ({ pages: [{ messages, hasOlder: false, hasNewer: false } as never], pageParams: [null] }) as never;
    const before = page([makeMessage({ id: "m1" })]);
    const withCard = mergeMessage(before, makeMessage({ id: "m1", preview: CARD }), { append: false });
    expect(withCard.status).toBe("replaced");
    expect((withCard.data as never as { pages: Array<{ messages: Array<{ preview?: unknown }> }> }).pages[0]!.messages[0]!.preview).toEqual(CARD);
    const removed = mergeMessage(withCard.data, makeMessage({ id: "m1" }), { append: false });
    expect((removed.data as never as { pages: Array<{ messages: Array<{ preview?: unknown }> }> }).pages[0]!.messages[0]!.preview).toBeUndefined();
  });
});
