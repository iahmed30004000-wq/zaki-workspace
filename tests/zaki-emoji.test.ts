import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ZAKI_EMOJIS, ZAKI_TASK_STICKERS, isStickerOnly, isZakiEmoji, splitZakiEmoji, zakiCode, zakiSrc } from "@/lib/chat/zaki-emoji";

describe("the Zaki emoji pack", () => {
  it("has 32 chat emojis and 16 task stickers, each with a small picture in public/brand/zaki-emojis", () => {
    expect(ZAKI_EMOJIS).toHaveLength(32);
    expect(ZAKI_TASK_STICKERS).toHaveLength(16);
    const dir = path.join(process.cwd(), "public", "brand", "zaki-emojis");
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(48);
    for (const e of ZAKI_EMOJIS) expect(files, e.id).toContain(`${e.id}.webp`);
    for (const t of ZAKI_TASK_STICKERS) expect(files, t.emoji).toContain(`${t.emoji}.webp`);
    for (const f of files) expect(statSync(path.join(dir, f)).size, f).toBeLessThan(30 * 1024);
  });

  it("keeps an emoji as a short text code and finds it back", () => {
    expect(zakiCode("smile")).toBe(":zaki_smile:");
    expect(zakiSrc("smile")).toBe("/brand/zaki-emojis/smile.webp");
    expect(splitZakiEmoji("أهلاً :zaki_hello: شو الأخبار")).toEqual([{ text: "أهلاً " }, { emoji: "hello" }, { text: " شو الأخبار" }]);
    expect(splitZakiEmoji(":zaki_like::zaki_fire:")).toEqual([{ emoji: "like" }, { emoji: "fire" }]);
    expect(splitZakiEmoji("no emoji")).toEqual([{ text: "no emoji" }]);
  });

  it("leaves an unknown code as plain words and never touches the plain text", () => {
    expect(splitZakiEmoji("a :zaki_nothing: b")).toEqual([{ text: "a :zaki_nothing: b" }]);
    expect(isZakiEmoji("task_done")).toBe(true);
    expect(isZakiEmoji("nothing")).toBe(false);
  });

  it("draws a message of only one to three emojis as a big sticker", () => {
    expect(isStickerOnly(":zaki_love:")).toBe(true);
    expect(isStickerOnly(" :zaki_love:  :zaki_fire: ")).toBe(true);
    expect(isStickerOnly(":zaki_love: شكراً")).toBe(false);
    expect(isStickerOnly(":zaki_a::zaki_love::zaki_love::zaki_love::zaki_love:")).toBe(false);
    expect(isStickerOnly("hello")).toBe(false);
  });
});
