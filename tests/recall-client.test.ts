import { describe, expect, it } from "vitest";
import { slashCommand } from "../src/lib/chat/recall-client";

/** Q1.3: what the composer treats as a «/» command. Nothing opens while an ordinary message is being written. */
describe("the slash command of the composer", () => {
  it("a bare slash opens the menu", () => {
    expect(slashCommand("/")).toEqual({ kind: null, q: "" });
  });
  it("«/منتج» and «/رد» open their lists once the word is finished by a space, with what follows searched", () => {
    expect(slashCommand("/منتج ")).toEqual({ kind: "product", q: "" });
    expect(slashCommand("/منتج حراك")).toEqual({ kind: "product", q: "حراك" });
    expect(slashCommand("/رد  توصيل مجاني ")).toEqual({ kind: "reply", q: "توصيل مجاني" });
  });
  it("a word still being typed, another word, or an ordinary message is not a command", () => {
    expect(slashCommand("/منت")).toBeNull();
    expect(slashCommand("/منتج")).toBeNull();
    expect(slashCommand("/شي حراك")).toBeNull();
    expect(slashCommand("مرحبا /منتج حراك")).toBeNull();
    expect(slashCommand("")).toBeNull();
    expect(slashCommand("//")).toBeNull();
    expect(slashCommand("/ منتج")).toBeNull();
  });
  it("a slash inside a link or a path is not a command", () => {
    expect(slashCommand("/home/user")).toBeNull();
    expect(slashCommand("https://x.test/منتج a")).toBeNull();
  });
  it("names of the language itself («constructor», «toString») are not commands", () => {
    expect(slashCommand("/constructor x")).toBeNull();
    expect(slashCommand("/toString ")).toBeNull();
    expect(slashCommand("/__proto__ x")).toBeNull();
  });
  it("a pasted or long text that starts with a command word is a message, not a command", () => {
    expect(slashCommand("/رد\nشكرا على التواصل\nمع السلام")).toBeNull();
    expect(slashCommand("/رد " + "كلام ".repeat(40))).toBeNull();
  });
});

describe("«/طلب»", () => {
  it("opens the order tab once the word is finished, with the number after it", () => {
    expect(slashCommand("/طلب ")).toEqual({ kind: "order", q: "" });
    expect(slashCommand("/طلب ZK-2026-000123")).toEqual({ kind: "order", q: "ZK-2026-000123" });
    expect(slashCommand("/طلب")).toBeNull();
  });
});

describe("a command whose tab is not offered here", () => {
  it("is plain text: «/طلب» with the orders switch off is a message, not a menu", () => {
    expect(slashCommand("/طلب xyz ", ["product", "reply"])).toBeNull();
    expect(slashCommand("/طلب xyz ", ["order"])).toEqual({ kind: "order", q: "xyz" });
    expect(slashCommand("/", ["order"])).toEqual({ kind: null, q: "" });
  });
});
