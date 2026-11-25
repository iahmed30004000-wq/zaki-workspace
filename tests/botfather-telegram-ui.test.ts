import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

import { BotFatherLine } from "@/components/chat/message/botfather-line";
import { BotFatherBar } from "@/components/chat/v2/composer/botfather-bar";
import { asksForBotFather, botFatherSuggestions, decodeAsk, decodeKeyboard, encodeAsk, encodeKeyboard, interruptsAsk } from "@/lib/chat/botfather";
import { AR } from "@/lib/i18n/dict";
import { textOf } from "./ui-render";

/** «بوت فاذر» as Telegram's: bot bubbles with buttons, «ابدأ», the «/» menu, and found by search. */
const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8").replace(/\r\n/g, "\n");
const bar = (text: string, started: boolean) => renderToStaticMarkup(React.createElement(BotFatherBar, { text, started, busy: false, onSend: () => undefined, onType: () => undefined }));

describe("the keyboard and the question travel inside the line", () => {
  it("round-trips, and junk is no keyboard and no question", () => {
    const kb = [[{ t: "التوكن", d: "tk:a_bot" }, { t: "رجوع", d: "bots" }]];
    expect(decodeKeyboard(encodeKeyboard(kb))).toEqual(kb);
    for (const junk of [undefined, 5, "", "{", '{"a":1}', "[[1,2]]", "[[]]"]) expect(decodeKeyboard(junk)).toEqual([]);
    expect(decodeAsk(encodeAsk({ c: "newbot", s: "username", n: "بوت" }))).toEqual({ c: "newbot", s: "username", n: "بوت" });
    for (const junk of [undefined, "", "{", '{"c":"nope","s":"value"}', '{"c":"setname","s":"other"}', "null"]) expect(decodeAsk(junk)).toBeNull();
  });
  it("a command interrupts a question, except the list of commands being asked for", () => {
    expect(interruptsAsk("/mybots", { c: "setname", s: "value", u: "a_bot" })).toBe(true);
    expect(interruptsAsk("اسم جديد", { c: "setname", s: "value", u: "a_bot" })).toBe(false);
    expect(interruptsAsk("/empty", { c: "setdescription", s: "value", u: "a_bot" })).toBe(false);
    expect(interruptsAsk("/help - مساعدة\n/start - ابدأ", { c: "setcommands", s: "value", u: "a_bot" })).toBe(false);
    expect(interruptsAsk("/mybots", { c: "setcommands", s: "value", u: "a_bot" })).toBe(true);
  });
});

describe("the «/» menu and «ابدأ»", () => {
  it("suggests while one slash word is typed, and nothing otherwise", () => {
    expect(botFatherSuggestions("/")).toContain("newbot");
    expect(botFatherSuggestions("/set")).toEqual(["setname", "setdescription", "setabouttext", "setuserpic", "setcommands", "setjoingroups", "setprivacy", "setwebhook"]);
    for (const quiet of ["", "مرحبا", "/newbot", "/newbot بوت", "a /"]) expect(botFatherSuggestions(quiet), quiet).toEqual([]);
  });
  it("an empty chat shows «ابدأ»; a started one shows «القائمة»; typing «/» shows the commands with what they do", () => {
    expect(bar("", false)).toContain("data-botfather-start");
    expect(textOf(bar("", false))).toContain(AR["botfather.start"]!);
    expect(bar("", true)).toContain("data-botfather-open-menu");
    expect(bar("", true)).not.toContain("data-botfather-start");
    const menu = bar("/new", true);
    expect(menu).toContain('data-botfather-command="newbot"');
    expect(textOf(menu)).toContain(AR["botfather.cmd.newbot"]!);
    expect(bar("كلام", false)).toBe("");
  });
  it("every command of the menu has its words", () => {
    for (const c of botFatherSuggestions("/")) expect(AR[`botfather.cmd.${c}`], c).toBeTruthy();
  });
});

describe("a line with buttons", () => {
  const line = (p: Record<string, string | number>) => renderToStaticMarkup(React.createElement(BotFatherLine, { messageId: "m1", meta: { k: "botfather", p }, time: "10:30", createdAt: "2026-11-24T07:30:00.000Z" }));
  it("draws each button under the bubble, and none when the line has none", () => {
    const html = line({ text: "اختار", kb: encodeKeyboard([[{ t: "@a_bot", d: "bot:a_bot" }], [{ t: "رجوع", d: "bots" }]]) });
    expect(html).toContain('data-botfather-button="bot:a_bot"');
    expect(html).toContain('data-botfather-button="bots"');
    expect(textOf(html)).toContain("@a_bot");
    expect(line({ text: "بلا أزرار" })).not.toContain("data-botfather-keyboard");
  });
  it("a press goes to the press door with the line and the button", () => {
    expect(SRC("components/chat/message/botfather-line.tsx")).toContain('apiPost("/api/chat/botfather/press", { messageId, data })');
  });
});

describe("where it is found", () => {
  it("the chat list's search finds it by its names, from three letters", () => {
    for (const q of ["بوت", "فاذر", "بوت فاذر", "bot", "BotFather", "@botfather"]) expect(asksForBotFather(q), q).toBe(true);
    for (const q of ["", "بو", "أحمد", "orders"]) expect(asksForBotFather(q), q).toBe(false);
  });
  it("the search, the contacts screen and the composer are wired to it", () => {
    expect(SRC("components/chat/v2/info/list-search-results.tsx")).toContain("{botFather ? <BotFatherFound onPick={onPick} /> : null}");
    expect(SRC("app/(app)/contacts/page.tsx")).toContain("botFatherOffered(actor.orgId, actor.role)");
    expect(SRC("components/chat/v2/composer/chat-composer-v2.tsx")).toContain("{detail.botFather && !editing ? <BotFatherBar");
  });
});
