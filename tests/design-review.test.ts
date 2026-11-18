import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", async () => {
  const { AR } = await import("@/lib/i18n/dict");
  return { useI18n: () => ({ t: (k: string) => AR[k] ?? k }) };
});

import { PrimitiveSamples } from "../src/components/theme/primitive-samples";
import { THEME_KEYS } from "../src/lib/themes/registry";
import { BUTTON_VARIANTS } from "../src/components/ui/button";
import { AR } from "../src/lib/i18n/dict";

/** D1.3: the review of every primitive in every theme. */
describe("«معاينة المظاهر»", () => {
  const html = renderToStaticMarkup(React.createElement(PrimitiveSamples));
  it("shows one box per theme, each with its own data-theme", () => {
    for (const k of THEME_KEYS) expect(html).toContain(`data-theme="${k}"`);
  });
  it("shows every button variant and every badge tone in each box, and the chat bubbles with their tokens", () => {
    for (const v of BUTTON_VARIANTS) expect(html.split(v === "fab" ? "+" : (AR[`design.button.${v}`] as string)).length - 1, v).toBeGreaterThanOrEqual(1);
    expect(html.split("bg-bubble-out").length - 1).toBe(THEME_KEYS.length);
    expect(html.split("bg-bubble-in").length - 1).toBe(THEME_KEYS.length);
    expect(html.split("data-selected=\"true\"").length - 1).toBe(THEME_KEYS.length);
  });
  it("its words exist in Arabic", () => {
    for (const k of ["design.review.title", "design.review.hint", "design.sample.name", "design.sample.in", "design.sample.out"]) expect(AR[k], k).toBeTruthy();
  });
});
