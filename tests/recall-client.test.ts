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
});
