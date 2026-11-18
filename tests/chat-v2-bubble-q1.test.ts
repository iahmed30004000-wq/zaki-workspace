import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { MessageBubble, type MessageBubbleProps } from "@/components/chat/v2/message-bubble";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { AR } from "@/lib/i18n/dict";
import type { MessageDto } from "@/server/chat/dto";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";

(globalThis as { React?: typeof React }).React = React;

/**
 * C2.4 — «NOTHING of Q1 may be lost»: one render test each for what Q1 put on the old screen and the new bubble must still draw — the CARD bubble with its
 * «افتحي الكرت», an order number as a chip, the ticket chip under a message with the «✅ انحلّت» reply, and «قرأت ✓» with «قرأ 7 من 10» on a must-read
 * message. (The «/» menu and «⚡» belong to the composer, C2.5; «🎫 مشكلة» and «اسألي مشرفتك» to the menu, C2.6.)
 */
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const noop = () => undefined;

function draw(message: MessageDto, over: Partial<MessageBubbleProps> = {}, client = new QueryClient()): string {
  const facts = bubbleFactsOf(makeHeader({ me: { canOrderState: true, orderHints: true, canModerate: false } }));
  const props: MessageBubbleProps = { message, conversationId: "c1", facts, start: true, end: true, mentionNames: [], onReact: noop, onJump: noop, ...over };
  return renderToStaticMarkup(createElement(Queries, { client }, createElement(MessageBubble, props)));
}

describe("Q1 on the new bubble", () => {
  it("the CARD bubble: the product's name, its line, and «افتحي الكرت» as a link to the sheet", () => {
    const client = new QueryClient();
    client.setQueryData(["knowledge-sheet", "k1"], { id: "k1", name: "عسل السدر", category: "عسل", data: { tagline: "من جبال الشام" }, external: null });
    const html = draw(makeMessage({ kind: "CARD", body: "", card: { type: "product", cardId: "k1" } }), {}, client);
    expect(html).toContain("data-card-bubble");
    expect(html).toContain("عسل السدر");
    expect(html).toContain("من جبال الشام");
    expect(html).toContain('href="/knowledge/k1"');
    expect(html).toContain(AR["recall.card.open"]);
  });

  it("an order number in a message is a chip (a button), only where the header says so", () => {
    const message = makeMessage({ body: "الطلب ZK-2026-1234 تأخر" });
    const html = draw(message);
    expect(html).toContain("data-order-chip");
    expect(html).toContain("ZK-2026-1234");
    expect(html).toContain(`${AR["order.chip.open"]} ZK-2026-1234`);
    const off = draw(message, { facts: bubbleFactsOf(makeHeader({ me: { canOrderState: false } })) });
    expect(off).not.toContain("data-order-chip");
    expect(off).toContain("ZK-2026-1234");
  });

  it("the ticket chip under a message (its number, its state and who holds it), and the «✅ انحلّت» reply that quotes it", () => {
    const original = makeMessage({ id: "orig", body: "الزبون ما استلم", work: [{ kind: "ticket", id: "t1", number: 7, status: "RESOLVED", assigneeName: "ليلى" }] });
    const chip = draw(original);
    expect(chip).toContain("data-ticket-chip");
    expect(chip).toContain(`🎫 T-7 · ${AR["tickets.chip.resolved"]} · ${AR["tickets.chip.with"]} ليلى`);
    const resolved = draw(makeMessage({ id: "answer", mine: false, authorName: "ليلى", body: "✅ انحلّت: تم التسليم", replyTo: { id: "orig", preview: "الزبون ما استلم", authorName: "سلمى" } }));
    expect(resolved).toContain("✅ انحلّت: تم التسليم");
    expect(resolved).toContain("data-reply-block");
    expect(resolved).toContain("الزبون ما استلم");
  });

  it("a task made of a message is a chip that opens it", () => {
    const html = draw(makeMessage({ work: [{ kind: "task", id: "task9" }] }));
    expect(html).toContain('href="/tasks/task9"');
  });

  it("«قرأت ✓» with «قرأ 7 من 10» on a must-read message, and the people who did not read for whoever may see them", () => {
    const html = draw(makeMessage({ mustRead: { mine: true, acked: false, total: 10, read: 7, missing: [{ id: "u5", name: "هديل" }] } }), { onAck: noop });
    expect(html).toContain("data-must-read");
    expect(html).toContain("data-ack");
    expect(html).toContain(AR["mustread.ack"]);
    expect(html).toContain("قرأ 7 من 10");
    expect(html).toContain(`${AR["mustread.missing"]} هديل`);
    const acked = draw(makeMessage({ mustRead: { mine: true, acked: true, total: 10, read: 10 } }), { onAck: noop });
    expect(acked).toContain('aria-pressed="true"');
    expect(acked).toContain(AR["mustread.done"]);
    // a person who is not one of the readers gets the count and no button
    expect(draw(makeMessage({ mustRead: { mine: false, acked: false, total: 10, read: 7 } }), { onAck: noop })).not.toContain("data-ack");
  });

  it("the customer-data hint (Q1.7) and the «بدك تعمليها تذكرة؟» suggestion are still drawn, for the people they were for", () => {
    const template = "الاسم: سارة\nالهاتف: 0791234567\nالمحافظة: عمان\nالعنوان: الجبيهة";
    const hint = draw(makeMessage({ mine: true, body: template }));
    expect(hint).toContain("data-customer-hint");
    expect(draw(makeMessage({ mine: false, body: template }))).not.toContain("data-customer-hint");
    const header = makeHeader({
      me: {
        problemKinds: [{ key: "late", label: "تأخير" }],
        problemRules: [{ id: "r1", type: "topic", spaceId: "s1", conversationId: "c1", kindKey: "late", mode: "suggest" }],
      },
    });
    const suggested = draw(makeMessage({ body: "الطلب متأخر" }), { facts: bubbleFactsOf(header), onSuggestProblem: noop });
    expect(suggested).toContain("data-problem-suggest");
  });
});
