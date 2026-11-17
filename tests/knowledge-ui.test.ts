import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AR } from "../src/lib/i18n/dict";
import { stockWord } from "../src/components/knowledge/sheet-view";
import { GAP_KEYS } from "../src/lib/cards/knowledge";
import type { KnowledgeError } from "../src/lib/cards/knowledge";

/** Q1.1: the screens of the product sheets. Every sentence they print is in the dictionary, in Arabic. */
const FILES = ["sheet-view", "sheet-editor", "knowledge-view", "knowledge-settings-card"].map((f) => readFileSync(new URL(`../src/components/knowledge/${f}.tsx`, import.meta.url), "utf8"));
const dict = AR as Record<string, string>;

describe("the sentences", () => {
  it("every static key the screens print exists", () => {
    const keys = FILES.flatMap((src) => [...src.matchAll(/\bt\("([A-Za-z_.]+)"/g)].map((m) => m[1]!));
    expect(keys.length).toBeGreaterThan(60);
    expect([...new Set(keys)].filter((k) => !dict[k])).toEqual([]);
  });
  it("every key built from a variable has its whole family (stock, badge, part, gap, kind, filter, status)", () => {
    for (const k of ["stock.in", "stock.out", "badge.test", "badge.new", "part.description", "part.sections", "part.price", "part.link", "kind.text", "kind.steps", "kind.chips", "filter.all", "filter.out", "filter.test", "filter.lacking"]) {
      expect(dict[`knowledge.${k}`], k).toBeTruthy();
    }
    for (const g of GAP_KEYS) expect(dict[`knowledge.gap.${g}`], g).toBeTruthy();
    for (const s of ["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"]) expect(dict[`cards.status.${s}`], s).toBeTruthy();
  });
  it("every refusal the server can give has its sentence", () => {
    const errors: KnowledgeError[] = ["knowledge.e.shape", "knowledge.e.tagline", "knowledge.e.sections", "knowledge.e.section", "knowledge.e.chips", "knowledge.e.steps", "knowledge.e.text", "knowledge.e.faq", "knowledge.e.question", "knowledge.e.answer", "knowledge.e.caution", "knowledge.e.test_note", "knowledge.e.template", "knowledge.e.reply"];
    for (const e of errors) expect(dict[e], e).toBeTruthy();
  });
  it("the name of the tab is «المنتجات»", () => {
    expect(dict["nav.tab.knowledge"]).toBe("المنتجات");
  });
});

describe("the stock word", () => {
  it("reads what the orders system says", () => {
    expect(stockWord("in_stock")).toBe("in");
    expect(stockWord("available")).toBe("in");
    expect(stockWord("out_of_stock")).toBe("out");
    expect(stockWord("sold_out")).toBe("out");
    expect(stockWord("unknown")).toBeNull();
    expect(stockWord(null)).toBeNull();
  });
});

describe("what the screens never do", () => {
  it("print no price they typed: the sheet view takes the price from the snapshot only", () => {
    const view = FILES[0]!;
    expect(view).not.toMatch(/price\s*=\s*\d/);
  });
  it("show the caution only to an editor", () => {
    const view = FILES[0]!;
    expect(view).toMatch(/sheet\.canEdit && data\?\.caution/);
  });
  it("a stale price is never copied: the offer button is the warning when the message cannot be built", () => {
    const view = FILES[0]!;
    expect(view).toMatch(/offer\.ok \?/);
    expect(view).toMatch(/oms\.stale\.refuse/);
  });
});
