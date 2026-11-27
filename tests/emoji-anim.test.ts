import * as React from "react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

import { JumboEmoji } from "@/components/chat/v2/bubble/jumbo-emoji";
import { ANIMATED_EMOJI_CODES, emojiAnimationOf } from "@/lib/chat/emoji-anim";

/** «تنزيل حركات جوجل» (the owner, 2026-11-27): Noto's drawn animations, served by the app itself. */
const FOLDER = join(__dirname, "..", "public", "emoji", "anim");
const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8").replace(/\r\n/g, "\n");

describe("the drawings the app serves", () => {
  it("the list is exactly the folder: fifty animated WebP pictures, under 25 MB, with their licence beside them", () => {
    const files = readdirSync(FOLDER).filter((f) => f.endsWith(".webp"));
    expect(files.sort()).toEqual(ANIMATED_EMOJI_CODES.map((c) => `${c}.webp`).sort());
    expect(files).toHaveLength(50);
    let total = 0;
    for (const name of files) {
      const body = readFileSync(join(FOLDER, name));
      expect(body.subarray(0, 4).toString("latin1"), name).toBe("RIFF");
      expect(body.subarray(8, 12).toString("latin1"), name).toBe("WEBP");
      expect(body.includes(Buffer.from("ANIM", "latin1")), name).toBe(true);
      total += body.length;
    }
    expect(total).toBeLessThan(25 * 1024 * 1024);
    expect(readFileSync(join(FOLDER, "LICENSE.txt"), "utf8")).toContain("CC BY 4.0");
  });

  it("an emoji finds its drawing with or without the «draw me as a picture» mark; a skin tone, a joined emoji and one with no drawing stay as they are", () => {
    expect(emojiAnimationOf("😂")).toBe("/emoji/anim/1f602.webp");
    expect(emojiAnimationOf("❤️")).toBe("/emoji/anim/2764_fe0f.webp");
    expect(emojiAnimationOf("❤")).toBe("/emoji/anim/2764_fe0f.webp");
    expect(emojiAnimationOf("👍️")).toBe("/emoji/anim/1f44d.webp");
    for (const plain of ["👍🏽", "❤️‍🔥", "🥝", "a", ""]) expect(emojiAnimationOf(plain), plain).toBeNull();
  });

  it("they are reachable without a sign-in check in the way (a picture, like the app's icons), and their maker is named", () => {
    expect(SRC("middleware.ts")).toMatch(/STATIC_DIRS = \[[^\]]*"\/emoji\/"/);
    expect(SRC("components/settings-me/effects-section.tsx")).toContain('t("settingsMe.fx.emoji_credit")');
  });
});

describe("a message of emojis", () => {
  const draw = (tokens: { glyph: string }[]) => renderToStaticMarkup(React.createElement(JumboEmoji, { tokens, fresh: false }));

  it("one with a drawing is drawn by it and still says which emoji it is; one without is the character", () => {
    const html = draw([{ glyph: "😂" }, { glyph: "🥝" }]);
    expect(html).toContain('src="/emoji/anim/1f602.webp"');
    expect(html).toContain('alt="😂"');
    expect(html).toContain(">🥝</span>");
  });
});
