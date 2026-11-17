import { describe, expect, it } from "vitest";
import { AR } from "../src/lib/i18n/dict";
import { messageMenuItems, type MessageMenuContext } from "../src/components/chat/message/message-menu-registry";
import { DEFAULT_PROBLEM_KINDS } from "../src/lib/tickets/problem-kinds";

/** Q1.5: what the screens need to exist — every state of the chip has its word, the menu item is offered only where it should be. */
describe("the chip's words", () => {
  it("every ticket state has its word", () => {
    for (const s of ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]) expect(AR[`tickets.chip.${s.toLowerCase()}`], s).toBeTruthy();
  });
  it("every default kind is a plain Arabic label", () => {
    for (const k of DEFAULT_PROBLEM_KINDS) expect(/[؀-ۿ]/.test(k.label), k.key).toBe(true);
  });
});

describe("«🎫 مشكلة» in the message menu", () => {
  const base: MessageMenuContext = { mine: false, deleted: false, kind: "TEXT", hasText: true, pinned: false, conversationKind: "TOPIC", canPost: true, canModerate: false, oversight: false };
  const item = messageMenuItems.find((i) => i.id === "problem");
  it("is offered on a text message when the screen was given the kinds, and nowhere else", () => {
    expect(item).toBeTruthy();
    expect(item!.available({ ...base, canProblem: true })).toBe(true);
    expect(item!.available(base)).toBe(false);
    expect(item!.available({ ...base, canProblem: true, hasText: false })).toBe(false);
    expect(item!.available({ ...base, canProblem: true, kind: "VOICE" })).toBe(false);
    expect(AR[item!.labelKey(base)]).toBe("🎫 مشكلة");
  });
});
