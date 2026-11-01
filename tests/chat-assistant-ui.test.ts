import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { systemSentence } from "@/lib/chat/system-sentence";
import { AssistantLine } from "@/components/chat/message/assistant-line";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

/** «المساعد»'s line in a conversation: a labelled AI line with its ⚠️/🔧 note, theme tokens only, Arabic only. */

const line = (p: Record<string, string | number>) => render(createElement(AssistantLine, { meta: { k: "assistant", p }, time: "10:30", createdAt: "2026-11-01T07:30:00.000Z" }));

function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(textOf(markup)).not.toMatch(/[A-Za-z]{2,}/);
}

describe("the assistant's line", () => {
  it("the first answer is labelled as AI and carries the full ⚠️ and 🔧 note with the number of messages read", () => {
    const html = line({ text: "الخلاصة: اتفقتوا.", first: 1, read: 12 });
    const text = textOf(html);
    expect(text).toContain("المساعد");
    expect(text).toContain("ذكاء اصطناعي");
    expect(text).toContain("الخلاصة: اتفقتوا.");
    expect(text).toContain("⚠️");
    expect(text).toContain("🔧");
    expect(text).toContain("12");
    expect(text).not.toContain("{read}");
    expectClean(html);
  });

  it("a later answer carries the short reminder only", () => {
    const text = textOf(line({ text: "جواب", read: 5 }));
    expect(text).toContain("⚠️");
    expect(text).not.toContain("🔧");
  });

  it("a refusal is a notice, without the AI note", () => {
    const html = line({ text: AR["chatai.err.guest"] ?? "", err: "guest" });
    expect(html).toContain('data-assistant-line="refusal"');
    expect(textOf(html)).not.toContain("⚠️");
    expectClean(html);
  });

  it("the text is plain text: markup the model writes is not markup", () => {
    const html = line({ text: "<img src=x onerror=alert(1)> **bold**", read: 1 });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("the preview of the chat list reads «المساعد: …», never the raw JSON", () => {
    expect(systemSentence({ k: "assistant", p: { text: "خلاصة قصيرة" } }, "سارة")).toBe("المساعد: خلاصة قصيرة");
  });
});
