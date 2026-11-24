import { describe, expect, it } from "vitest";
import {
  BOT_COMMANDS_MAX,
  botFatherChatKey,
  isBotFatherChatKey,
  isBotFatherChatOf,
  isBotUsername,
  normalizeBotUsername,
  parseBotCommands,
  parseBotFatherCall,
  parseNewBot,
} from "@/lib/chat/botfather";

/** «بوت فاذر»: reading a message to the bot maker (pure). */
describe("the conversation key", () => {
  it("names one person's chat in one space, and is told from the assistant's", () => {
    const key = botFatherChatKey("u1", "s1");
    expect(key).toBe("botfather|u1@s1");
    expect(isBotFatherChatKey(key)).toBe(true);
    expect(isBotFatherChatKey("assistant|u1@s1")).toBe(false);
    expect(isBotFatherChatKey(null)).toBe(false);
    expect(isBotFatherChatOf(key, "u1")).toBe(true);
    expect(isBotFatherChatOf(key, "u2")).toBe(false);
  });
});

describe("a bot's handle", () => {
  it("is lower-case letters, digits and underscores, ends in «bot», starts with a letter, 4 to 32 characters", () => {
    for (const ok of ["orders_bot", "muse_bot", "abcbot", "a1_bot", "x".repeat(28) + "bot"]) expect(isBotUsername(ok), ok).toBe(true);
    for (const bad of ["bot", "1abot", "orders", "Orders_bot", "orders-bot", "orders_bot ", "ab", "x".repeat(30) + "bot", "_botbot"]) expect(isBotUsername(bad), bad).toBe(false);
  });
  it("«@Name_Bot» is read as «name_bot»", () => {
    expect(normalizeBotUsername("  @Orders_Bot ")).toBe("orders_bot");
  });
});

describe("a message to the bot maker", () => {
  it("reads «/command @handle the rest» (the command is case-blind, a «@botfather» after it is ignored)", () => {
    expect(parseBotFatherCall("/token @Orders_bot")).toEqual({ command: "token", handle: "orders_bot", rest: "", args: "@Orders_bot" });
    expect(parseBotFatherCall("  /SetDescription@botfather orders_bot بيعمل كذا وكذا")).toMatchObject({ command: "setdescription", handle: "orders_bot", rest: "بيعمل كذا وكذا" });
    expect(parseBotFatherCall("/mybots")).toMatchObject({ command: "mybots", handle: null, rest: "" });
  });
  it("anything that is not a known command is no command (the reply is the help)", () => {
    for (const text of ["مرحبا", "/unknown", "/", "newbot", "/نيو"]) expect(parseBotFatherCall(text).command, text).toBeNull();
  });
  it("keeps new lines of the rest (the commands list)", () => {
    const call = parseBotFatherCall("/setcommands @orders_bot\n/start - ابدأ\n/help - مساعدة");
    expect(call.handle).toBe("orders_bot");
    expect(call.rest).toBe("/start - ابدأ\n/help - مساعدة");
  });
});

describe("«/newbot»", () => {
  it("the name is everything before the last word, the last word is the handle", () => {
    expect(parseNewBot("بوت الطلبات @orders_bot")).toEqual({ name: "بوت الطلبات", username: "orders_bot" });
    expect(parseNewBot("Orders   Bot orders_BOT")).toEqual({ name: "Orders Bot", username: "orders_bot" });
    expect(parseNewBot("@orders_bot")).toBeNull();
    expect(parseNewBot("")).toBeNull();
  });
});

describe("«/setcommands»", () => {
  it("one «/command - what it does» per line", () => {
    const parsed = parseBotCommands("/start - ابدأ\nhelp: مساعدة\n/Order_Status — حالة الطلب");
    expect(parsed).toEqual({ ok: true, commands: [{ command: "start", description: "ابدأ" }, { command: "help", description: "مساعدة" }, { command: "order_status", description: "حالة الطلب" }] });
  });
  it("a line that is not one, a repeated command, or too many are refused with the line number", () => {
    expect(parseBotCommands("/start - ابدأ\nكلام بدون أمر")).toEqual({ ok: false, line: 2 });
    expect(parseBotCommands("/a - x\n/a - y")).toEqual({ ok: false, line: 2 });
    const many = Array.from({ length: BOT_COMMANDS_MAX + 1 }, (_, i) => `/c${i} - x`).join("\n");
    expect(parseBotCommands(many)).toEqual({ ok: false, line: BOT_COMMANDS_MAX + 1 });
  });
});
