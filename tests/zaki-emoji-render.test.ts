import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ZakiEmojiText } from "@/components/chat/v2/bubble/zaki-emoji-text";

const plain = (t: string) => t;
const draw = (text: string, sticker = false) => renderToStaticMarkup(createElement(ZakiEmojiText, { text, render: plain, sticker }));

describe("a Zaki emoji inside a message", () => {
  it("is its picture in the line, with its Arabic name for a screen reader, and the words around it are untouched", () => {
    const html = draw("شكراً :zaki_thanks: كتير");
    expect(html).toContain('src="/brand/zaki-emojis/thanks.webp"');
    expect(html).toContain('alt="شكراً"');
    expect(html).toContain("size-6");
    expect(html).toContain("شكراً ");
    expect(html).toContain(" كتير");
  });
  it("is big when the message is only emojis", () => {
    expect(draw(":zaki_love:", true)).toContain("size-24");
  });
  it("leaves a text without a known code exactly as it is", () => {
    expect(draw("a :zaki_nothing: b")).toBe("a :zaki_nothing: b");
    expect(draw("hello")).toBe("hello");
  });
});
