import { describe, expect, it } from "vitest";
import { autoRulesOf, DEFAULT_PROBLEM_WORDS, matchRule, ruleMode, type AutoRule } from "../src/lib/tickets/auto-rules";
import { DEFAULT_PROBLEM_KINDS, problemKind, problemKindsOf } from "../src/lib/tickets/problem-kinds";

/** Q1.5: the rules that decide when a message gets a ticket (or a «بدك تعمليها تذكرة؟» chip). */
const topic: AutoRule = { id: "r1", type: "topic", spaceId: "s1", conversationId: "c1", kindKey: "other" };
const content: AutoRule = { id: "r2", type: "content", spaceId: "s1", kindKey: "shipping" };
const msg = (body: string, over: Partial<{ conversationId: string; spaceId: string }> = {}) => ({ body, conversationId: "c1", spaceId: "s1", ...over });

describe("the mode", () => {
  it("defaults to «اقترح» for a content rule and «تلقائي» for a topic rule; an explicit mode wins", () => {
    expect(ruleMode(topic)).toBe("auto");
    expect(ruleMode(content)).toBe("suggest");
    expect(ruleMode({ ...content, mode: "auto" })).toBe("auto");
    expect(ruleMode({ ...topic, mode: "suggest" })).toBe("suggest");
  });
});

describe("matching", () => {
  it("a topic rule matches every message of that topic, and only that topic", () => {
    expect(matchRule(topic, msg("أي كلام"))).toBe(true);
    expect(matchRule(topic, msg("أي كلام", { conversationId: "c2" }))).toBe(false);
  });
  it("a content rule needs an order number AND a problem word, in the rule's space", () => {
    expect(matchRule(content, msg("الطلب ZK-2026-000123 متأخر"))).toBe(true);
    expect(matchRule(content, msg("الطلب ZK-2026-000123 وصل تمام"))).toBe(false);
    expect(matchRule(content, msg("متأخر بدون رقم"))).toBe(false);
    expect(matchRule(content, msg("الطلب ZK-2026-000123 متأخر", { spaceId: "s2" }))).toBe(false);
  });
  it("the rule's own problem words replace the defaults", () => {
    const own: AutoRule = { ...content, problemWords: ["زعلان"] };
    expect(matchRule(own, msg("الطلب ZK-2026-000123 متأخر"))).toBe(false);
    expect(matchRule(own, msg("الزبون زعلان ZK-2026-000123"))).toBe(true);
    expect(DEFAULT_PROBLEM_WORDS.length).toBeGreaterThan(5);
  });
  it("a phone number is not an order number", () => {
    expect(matchRule(content, msg("متأخر 079-1234-5678"))).toBe(false);
  });
});

describe("reading the company's rules", () => {
  it("keeps the valid ones and drops the rest (never trusted)", () => {
    const rules = autoRulesOf({
      autoTicketRules: [
        topic,
        { id: "bad1", type: "weird", spaceId: "s1", kindKey: "other" },
        { id: "bad2", type: "topic", spaceId: "s1", kindKey: "other" },
        { ...content, mode: "nonsense" },
        content,
        { ...content, id: "r2" },
        "x",
        null,
      ],
    });
    expect(rules.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(autoRulesOf({})).toEqual([]);
    expect(autoRulesOf(null)).toEqual([]);
    expect(autoRulesOf({ autoTicketRules: "no" })).toEqual([]);
  });
});

describe("the kinds", () => {
  it("are the defaults until the company has its own valid list; «constructor» is no kind", () => {
    expect(problemKindsOf({})).toEqual([...DEFAULT_PROBLEM_KINDS]);
    expect(problemKind(DEFAULT_PROBLEM_KINDS, "constructor")).toBeNull();
    expect(problemKind(DEFAULT_PROBLEM_KINDS, "shipping")?.label).toBe("مشكلة شحن");
    const own = problemKindsOf({ ticketKinds: [{ key: "x1", label: "نوعي", reminderHours: 2 }, { key: "X", label: "bad", reminderHours: 2 }, { key: "x1", label: "dup", reminderHours: 2 }, { key: "x2", label: "", reminderHours: 2 }] });
    expect(own.map((k) => k.key)).toEqual(["x1"]);
    expect(problemKindsOf({ ticketKinds: [] })).toEqual([...DEFAULT_PROBLEM_KINDS]);
  });
});
