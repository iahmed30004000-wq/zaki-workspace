import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(globalThis as { React?: typeof React }).React = React;

import { BotFatherLine } from "@/components/chat/message/botfather-line";
import { BotFatherRow } from "@/components/chat/botfather-row";
import { AR } from "@/lib/i18n/dict";
import { FEATURE_DEFAULTS, FEATURE_META } from "@/lib/features";
import { systemSentence } from "@/lib/chat/system-sentence";
import { classTokens, textOf } from "./ui-render";

/** «بوت فاذر»: the answer card, the row, and where they are wired. Nothing secret is ever in the message the card draws. */
const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8").replace(/\r\n/g, "\n");
const line = (p: Record<string, string | number>) => renderToStaticMarkup(React.createElement(BotFatherLine, { messageId: "m1", meta: { k: "botfather", p }, time: "10:30", createdAt: "2026-11-24T07:30:00.000Z" }));

describe("the answer card", () => {
  it("is an opaque surface with the theme's text colour, labelled «بوت فاذر», and draws the words as they are (new lines kept, markup not markup)", () => {
    const html = line({ text: "السطر الأول\nالسطر الثاني <img src=x onerror=alert(1)>" });
    const tokens = classTokens(html);
    expect(tokens).toContain("bg-surface-1");
    expect(tokens).toContain("text-fg");
    expect(tokens).toContain("whitespace-pre-wrap");
    expect(textOf(html)).toContain("بوت فاذر");
    expect(textOf(html)).toContain("السطر الأول");
    expect(html).not.toContain("<img");
    expect(html).toContain("data-botfather-line");
  });

  it("an answer with a secret on hold has the «اعرض التوكن» button and shows no secret; an answer without one has none", () => {
    const withSecret = line({ text: "تم", reveal: 1 });
    expect(withSecret).toContain("data-botfather-reveal");
    expect(textOf(withSecret)).toContain(AR["botfather.reveal_button"]);
    expect(withSecret).not.toContain("data-botfather-secrets");
    expect(withSecret).not.toMatch(/zws_|readonly/);
    expect(line({ text: "تم" })).not.toContain("data-botfather-reveal");
  });

  it("the card asks the reveal door ONCE (GET, never cached) and shows the secrets in read-only boxes with the warning; a closed or failed reveal says to write /token", () => {
    const card = SRC("components/chat/message/botfather-line.tsx");
    expect(card).toContain("apiGet<{ token?: string; webhookSecret?: string }>(`/api/chat/botfather/reveal/${encodeURIComponent(messageId)}`)");
    expect(card).toContain("<input readOnly");
    expect(card).toContain('ct("botfather.reveal_warning")');
    expect(AR["botfather.reveal_gone"]).toContain("{c_token}");
    expect(card).toContain('ct("botfather.reveal_gone", BOTFATHER_WORDS)');
  });
});

describe("the row of the new-message list", () => {
  it("opens the person's chat with the bot maker through POST /api/chat/botfather", () => {
    const row = SRC("components/chat/botfather-row.tsx");
    expect(BotFatherRow).toBeTypeOf("function");
    expect(row).toContain('data-testid="botfather-row"');
    expect(row).toContain('fetch("/api/chat/botfather", { method: "POST"');
    expect(row).toContain('ct("botfather.label")');
    expect(AR["botfather.label"]).toBe("بوت فاذر");
  });
});

describe("where it is wired", () => {
  it("both screens draw the card for the system line «botfather»; the list line reads «بوت فاذر: …»", () => {
    expect(SRC("components/chat/v2/pane/service-rows.tsx")).toContain('message.system?.k === "botfather"');
    expect(SRC("components/chat/message/message-item.tsx")).toContain('message.system?.k==="botfather"');
    expect(systemSentence({ k: "botfather", p: { text: "تم عملت البوت" } }, "ليلى")).toBe("بوت فاذر: تم عملت البوت");
  });

  it("the send path answers a message of the person's own chat and delivers to the bots a message addresses, both off the sender's path", () => {
    const messages = SRC("server/chat/messages.ts");
    expect(messages).toContain('if (kind === "TEXT") afterBotFatherMessage({');
    expect(messages).toContain('if (kind === "TEXT") afterBotAddressed({');
  });

  it("somebody else's chat with the bot maker is on nobody's list or forward targets, and the directory offers the row only for the owner and the admins", () => {
    expect(SRC("server/chat/list.ts")).toContain("isAssistantChatKey(r.dmKey) || isBotFatherChatKey(r.dmKey)");
    expect(SRC("server/chat/home.ts")).toContain("isAssistantChatKey(t.dmKey) || isBotFatherChatKey(t.dmKey)");
    expect(SRC("server/chat/forward-targets.ts")).toContain("isAssistantChatKey(t.dmKey) || isBotFatherChatKey(t.dmKey)");
    expect(SRC("app/api/chat/directory/route.ts")).toContain("botFatherOffered(ctx.orgId, ctx.orgRole)");
  });

  it("a bot's token is accepted by the door of messages only when it is the live token of a live bot (and by no other door: it holds messages.write alone)", () => {
    const door = SRC("server/door/messages.ts");
    expect(door).toContain('row.system === "bot"');
    expect(door).toContain("tokenId: row.id, deletedAt: null");
    expect(SRC("server/services/bots.ts")).toContain('permissions: ["messages.write"]');
  });
});

describe("the switch", () => {
  it("is OFF by default (it makes accounts and sends message text to an address), in the owner group, needs the door and its messages, with its words and the ⚠️ and the 🔧", () => {
    expect(FEATURE_DEFAULTS.botFather).toBe(false);
    expect(FEATURE_META.botFather).toEqual({ group: "owner", dependsOn: ["apiDoor", "doorMessages"] });
    expect(AR["features.botFather.hint"]).toContain("⚠️");
    expect(AR["features.botFather.hint"]).toContain("🔧");
  });
});
