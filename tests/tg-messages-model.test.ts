import { describe, expect, it } from "vitest";
import { menuFor } from "@/components/chat/message/message-menu-registry";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { PHONE_MAIN_IDS, cardRowDelayMs, placeOverlay, sevenReactions, splitPhoneMenu } from "@/lib/chat/v2/menu/phone-menu";
import { isSecondTap, longPressDoes, opensMenuOnTap } from "@/lib/chat/v2/phone/message-gestures";
import { MAX_REMOVALS, announceRemoval, isAnnouncedRemoval, removalsOf, settleOffset } from "@/lib/chat/v2/phone/removals";
import { MAX_DUST_PARTICLES, dustFrame, dustParticles } from "@/lib/chat/v2/phone/dust";
import { MAX_EFFECT_PIECES, effectPieces, effectWordKeys } from "@/lib/chat/v2/phone/emoji-effect";
import { flightPoint, sparksOf, withPendingReaction } from "@/lib/chat/v2/phone/reaction-flight";
import { smoothJumpAllowed } from "@/lib/chat/v2/phone/jump-scroll";
import { STICKERS_FOR, suggestedStickers } from "@/lib/chat/v2/composer/sticker-suggest";
import { deleteBack, insertPiece } from "@/lib/chat/v2/composer/panel-text";
import { quoteChoice } from "@/lib/chat/v2/composer/reply-options-model";
import { AR } from "@/lib/i18n/dict";
import { ct, ctCount } from "@/lib/chat/text";
import { isZakiEmoji } from "@/lib/chat/zaki-emoji";
import { CHAT_REACTIONS } from "@/lib/chat-reactions";
import { DOUBLE_TAP_MS } from "@/lib/chat/v2/menu/quick-reactions";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { menuContextV2 } from "@/lib/chat/v2/menu/menu-context";

/** «تيليجرام على التلفون», PHASE 3 (messages): the rules that need no browser. */

const rand = () => {
  let seed = 7;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
};

describe("the bar of seven reactions", () => {
  it("is the person's six and one more that is not already there", () => {
    const seven = sevenReactions(CHAT_REACTIONS);
    expect(seven.slice(0, 6)).toEqual([...CHAT_REACTIONS]);
    expect(seven).toHaveLength(7);
    expect(new Set(seven).size).toBe(7);
    const own = ["🙏", "👏", "😍", "💯", "🤔", "😢"];
    const theirs = sevenReactions(own);
    expect(theirs.slice(0, 6)).toEqual(own);
    expect(new Set(theirs).size).toBe(7);
  });
});

describe("the short menu of the phone", () => {
  const context = menuContextV2(makeMessage({ mine: true }), bubbleFactsOf(makeHeader({ kind: "DM", me: { canMakeWork: true } })), { readerCount: 0, askKind: false });

  it("the main list is the spec's six in the spec's order: رد · نسخ · تحويل · تثبيت · تعديل · حذف", () => {
    expect([...PHONE_MAIN_IDS]).toEqual(["reply", "copy", "forward", "pin", "edit", "delete"]);
    const { main } = splitPhoneMenu(menuFor(context));
    expect(main.map((a) => a.id)).toEqual(["reply", "copy", "forward", "pin", "edit", "delete"]);
  });

  it("nothing the registry offers is lost: the rest stays, in the registry's order, behind «المزيد»; nothing is added", () => {
    const all = menuFor(context);
    const { main, more } = splitPhoneMenu(all);
    expect([...main, ...more].map((a) => a.id).sort()).toEqual(all.map((a) => a.id).sort());
    expect(more.map((a) => a.id)).toEqual(all.map((a) => a.id).filter((id) => !(PHONE_MAIN_IDS as readonly string[]).includes(id)));
  });

  it("the spec's words", () => {
    expect(["reply", "copy", "forward", "pin", "unpin", "edit", "delete"].map((k) => AR[`tgmsg.menu.${k}`])).toEqual(["رد", "نسخ", "تحويل", "تثبيت", "إلغاء التثبيت", "تعديل", "حذف"]);
  });
});

describe("where the bar and the menu go", () => {
  const viewport = { width: 390, height: 800 };
  const bar = { width: 332, height: 52 };
  const menu = { width: 220, height: 300 };
  const inside = (box: { top: number; left: number }, size: { width: number; height: number }) => {
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.left + size.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.top + size.height).toBeLessThanOrEqual(viewport.height - 8);
  };

  it("in the middle: the bar above the message, the menu under it, both grow from the tap", () => {
    const anchor = { top: 300, left: 120, width: 250, height: 60 };
    const at = placeOverlay({ anchor, viewport, bar, menu, align: "right", tap: { x: 300, y: 330 } });
    expect(at.bar.top + bar.height).toBeLessThanOrEqual(anchor.top);
    expect(at.menu.top).toBeGreaterThanOrEqual(anchor.top + anchor.height);
    inside(at.bar, bar);
    inside(at.menu, menu);
    expect(at.bar.originY).toBe(bar.height);
    expect(at.menu.originY).toBe(0);
    expect(at.menu.originX).toBe(300 - at.menu.left);
  });

  it("near the top the bar stays on the screen and the menu goes under it; near the bottom the menu moves up", () => {
    const top = placeOverlay({ anchor: { top: 4, left: 10, width: 200, height: 40 }, viewport, bar, menu, align: "left", tap: null });
    inside(top.bar, bar);
    expect(top.menu.top).toBeGreaterThanOrEqual(top.bar.top + bar.height);
    const bottom = placeOverlay({ anchor: { top: 740, left: 10, width: 200, height: 40 }, viewport, bar, menu, align: "left", tap: null });
    inside(bottom.bar, bar);
    inside(bottom.menu, menu);
    expect(bottom.menu.top).toBeGreaterThanOrEqual(bottom.bar.top + bar.height);
  });

  it("a menu taller than what is left under the bar gets a height of its own and scrolls", () => {
    const at = placeOverlay({ anchor: { top: 100, left: 10, width: 200, height: 40 }, viewport: { width: 360, height: 400 }, bar, menu: { width: 220, height: 600 }, align: "left", tap: null });
    expect(at.menu.top + at.menu.maxHeight).toBeLessThanOrEqual(400 - 8);
    expect(at.menu.maxHeight).toBeGreaterThan(150);
  });
});

describe("the reaction card fills in about a second", () => {
  it("every row has appeared by the end of the fill, one after the other", () => {
    const delays = Array.from({ length: 60 }, (_, row) => cardRowDelayMs(row));
    expect(delays[0]).toBeGreaterThanOrEqual(TG_MOTION.reactionCardMs);
    for (let i = 1; i < delays.length; i += 1) expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!);
    expect(Math.max(...delays)).toBeLessThanOrEqual(TG_MOTION.reactionCardFillMs - TG_MOTION.cardRowFadeMs);
  });
});

describe("the gestures of a bubble on the phone", () => {
  const plain = { closest: () => null };
  const base = { inside: true, target: plain as unknown as EventTarget, movedPx: 0, hasSelection: false };

  it("a plain tap on the bubble opens the menu", () => {
    expect(opensMenuOnTap(base)).toBe(true);
  });

  it("not when the press does its own thing, moved, selected words, or came from outside the bubble's box (a dialog it opened)", () => {
    expect(opensMenuOnTap({ ...base, target: { closest: () => ({}) } as unknown as EventTarget })).toBe(false);
    expect(opensMenuOnTap({ ...base, movedPx: 24 })).toBe(false);
    expect(opensMenuOnTap({ ...base, hasSelection: true })).toBe(false);
    expect(opensMenuOnTap({ ...base, inside: false })).toBe(false);
  });

  it("a long press starts the selection where the screen can select, and keeps the menu where it cannot (and on a computer-sized screen)", () => {
    expect(longPressDoes({ phone: true, canSelect: true })).toBe("select");
    expect(longPressDoes({ phone: true, canSelect: false })).toBe("menu");
    expect(longPressDoes({ phone: false, canSelect: true })).toBe("menu");
  });

  it("the second tap of a double tap is the one that comes soon and near the first (the menu never waits for it)", () => {
    const first = { at: 1000, x: 100, y: 200 };
    expect(isSecondTap(first, { at: 1000 + DOUBLE_TAP_MS, x: 110, y: 205 })).toBe(true);
    expect(isSecondTap(first, { at: 1001 + DOUBLE_TAP_MS, x: 100, y: 200 })).toBe(false);
    expect(isSecondTap(first, { at: 1100, x: 200, y: 200 })).toBe(false);
  });
});

describe("which messages just went", () => {
  const a = makeMessage({ id: "a" });
  const b = makeMessage({ id: "b" });
  const c = makeMessage({ id: "c" });

  it("a message that turned into «حُذفت الرسالة»", () => {
    expect(removalsOf([a, b, c], [a, { ...b, deleted: true, body: null }, c], () => false)).toEqual([{ id: "b", kind: "deleted" }]);
  });

  it("a message that left the list counts only when this screen said it removes it («حذف عندي»): a page that was dropped or a jump is not a deletion", () => {
    expect(removalsOf([a, b, c], [a, c], () => false)).toEqual([]);
    expect(removalsOf([a, b, c], [a, c], (id) => id === "b")).toEqual([{ id: "b", kind: "removed" }]);
  });

  it("nothing for a new message, an edit or one that was already deleted; and never more than a batch", () => {
    expect(removalsOf([a], [a, b], () => true)).toEqual([]);
    expect(removalsOf([a], [{ ...a, edited: true }], () => true)).toEqual([]);
    const gone = { ...a, deleted: true };
    expect(removalsOf([gone], [gone], () => true)).toEqual([]);
    const many = Array.from({ length: MAX_REMOVALS + 1 }, (_, i) => makeMessage({ id: `m${i}` }));
    expect(removalsOf(many, [], () => true)).toEqual([]);
  });

  it("an announcement is kept for a short while only", () => {
    announceRemoval(["x"], 1000);
    expect(isAnnouncedRemoval("x", 2000)).toBe(true);
    expect(isAnnouncedRemoval("y", 2000)).toBe(false);
    expect(isAnnouncedRemoval("x", 1000 + 60_000)).toBe(false);
  });

  it("a row slides from where it was to where it is; a hair or a whole screen is no slide", () => {
    expect(settleOffset(100, 160, 700)).toBe(-60);
    expect(settleOffset(160, 100, 700)).toBe(60);
    expect(settleOffset(100, 100.4, 700)).toBe(0);
    expect(settleOffset(0, 900, 700)).toBe(0);
  });
});

describe("the dust of a deleted bubble (our own particles)", () => {
  const rect = { top: 100, left: 20, width: 340, height: 600 };
  const parts = dustParticles(rect, { durationMs: TG_MOTION.deleteDustMs, random: rand() });

  it("is capped, starts inside the bubble, and flies up and to the right", () => {
    expect(parts.length).toBeGreaterThan(50);
    expect(parts.length).toBeLessThanOrEqual(MAX_DUST_PARTICLES);
    for (const p of parts) {
      expect(p.x).toBeGreaterThanOrEqual(rect.left);
      expect(p.x).toBeLessThanOrEqual(rect.left + rect.width);
      expect(p.y).toBeGreaterThanOrEqual(rect.top);
      expect(p.y).toBeLessThanOrEqual(rect.top + rect.height);
      expect(p.dx).toBeGreaterThan(0);
      expect(p.dy).toBeLessThan(0);
      expect(p.delayMs + p.lifeMs).toBeLessThanOrEqual(TG_MOTION.deleteDustMs);
    }
  });

  it("a tiny bubble gets few particles, and several bubbles share one cap", () => {
    expect(dustParticles({ top: 0, left: 0, width: 40, height: 20 }, { durationMs: 360, random: rand() }).length).toBeLessThan(80);
    expect(dustParticles(rect, { durationMs: 360, random: rand(), cap: 100 }).length).toBeLessThanOrEqual(100);
  });

  it("a particle waits, then moves and fades, and is gone at its end", () => {
    const p = { x: 10, y: 10, dx: 30, dy: -40, size: 2, delayMs: 50, lifeMs: 200, tone: 0 as const };
    expect(dustFrame(p, 10)).toEqual({ x: 10, y: 10, alpha: 1 });
    const mid = dustFrame(p, 150)!;
    expect(mid.x).toBeGreaterThan(10);
    expect(mid.y).toBeLessThan(10);
    expect(mid.alpha).toBeLessThan(1);
    expect(dustFrame(p, 260)).toBeNull();
  });
});

describe("the full-screen effect of one big emoji", () => {
  it("is capped and every piece is over by 3.3 seconds", () => {
    const pieces = effectPieces({ totalMs: TG_MOTION.emojiEffectMs, random: rand(), words: 2 });
    expect(pieces.length).toBeLessThanOrEqual(MAX_EFFECT_PIECES);
    for (const p of pieces) expect(p.delayMs + p.durationMs).toBeLessThanOrEqual(TG_MOTION.emojiEffectMs);
    expect(pieces.filter((p) => p.word !== null).length).toBeGreaterThan(0);
  });

  it("only a laughing face brings words, and they are Arabic", () => {
    expect(effectWordKeys("😂").length).toBe(2);
    expect(effectWordKeys("❤️")).toEqual([]);
    for (const key of effectWordKeys("🤣")) expect(AR[key], key).toMatch(/^[؀-ۿ]+$/);
    expect(effectPieces({ totalMs: 3300, random: rand(), words: 0 }).every((p) => p.word === null)).toBe(true);
  });
});

describe("the reaction on its way to its pill", () => {
  it("starts at the bar, ends at the pill, and rises on the way", () => {
    const from = { x: 100, y: 300 };
    const to = { x: 200, y: 300 };
    expect(flightPoint(from, to, 0)).toEqual({ x: 100, y: 300, scale: 1.4 });
    expect(flightPoint(from, to, 1)).toEqual({ x: 200, y: 300, scale: 0.7 });
    expect(flightPoint(from, to, 0.5).y).toBeLessThan(300);
  });

  it("the pill is drawn at once while the server answers: a new chip, or one more on a chip that is there; mine is never counted twice", () => {
    expect(withPendingReaction([], "🔥")).toEqual([{ emoji: "🔥", count: 1, mine: true }]);
    expect(withPendingReaction([{ emoji: "🔥", count: 2, mine: false }], "🔥")).toEqual([{ emoji: "🔥", count: 3, mine: true }]);
    const mine = [{ emoji: "🔥", count: 1, mine: true }];
    expect(withPendingReaction(mine, "🔥")).toBe(mine);
    expect(withPendingReaction(mine, null)).toBe(mine);
  });

  it("the burst is a few sparks around the pill, capped", () => {
    expect(sparksOf(rand()).length).toBeLessThanOrEqual(24);
  });
});

describe("a tap on the quote jumps to the original", () => {
  it("slides only to a row that is already drawn (its height is measured), with smooth transitions on", () => {
    expect(smoothJumpAllowed({ wanted: true, targetIndex: 12, drawn: [10, 11, 12, 13] })).toBe(true);
    expect(smoothJumpAllowed({ wanted: true, targetIndex: 2, drawn: [10, 11, 12, 13] })).toBe(false);
    expect(smoothJumpAllowed({ wanted: false, targetIndex: 12, drawn: [10, 11, 12, 13] })).toBe(false);
  });
});

describe("the sticker suggestions", () => {
  it("come while the box holds one emoji and nothing else", () => {
    expect(suggestedStickers("😂")).toEqual(STICKERS_FOR["😂"]);
    expect(suggestedStickers("  😂 ")).toEqual(STICKERS_FOR["😂"]);
    expect(suggestedStickers("❤️").length).toBeGreaterThan(0);
    expect(suggestedStickers("👍🏽").length).toBeGreaterThan(0);
    for (const body of ["", "مرحبا 😂", "😂😂", "🧿", ":zaki_joy:", "12"]) expect(suggestedStickers(body), body).toEqual([]);
  });

  it("name only stickers of our own pack", () => {
    for (const [emoji, ids] of Object.entries(STICKERS_FOR)) {
      expect(ids.length, emoji).toBeGreaterThan(0);
      for (const id of ids) expect(isZakiEmoji(id), `${emoji} ${id}`).toBe(true);
    }
  });
});

describe("typing from the emoji panel (the keyboard stays closed)", () => {
  it("puts the piece at the caret and moves the caret after it", () => {
    expect(insertPiece("ab", 1, 1, "😂")).toEqual({ text: "a😂b", caret: 3 });
    expect(insertPiece("abcd", 1, 3, "x")).toEqual({ text: "axd", caret: 2 });
    expect(insertPiece("ab", 99, 99, "x")).toEqual({ text: "abx", caret: 3 });
  });

  it("⌫ removes one whole thing: a letter, a joined emoji, a sticker's code, or the selection", () => {
    expect(deleteBack("ab", 2, 2)).toEqual({ text: "a", caret: 1 });
    expect(deleteBack("a👨‍👩‍👧", 99, 99)).toEqual({ text: "a", caret: 1 });
    expect(deleteBack("a👍🏽b", 5, 5)).toEqual({ text: "ab", caret: 1 });
    expect(deleteBack("x:zaki_joy:", 99, 99)).toEqual({ text: "x", caret: 1 });
    expect(deleteBack("abcd", 1, 3)).toEqual({ text: "ad", caret: 1 });
    expect(deleteBack("ab", 0, 0)).toEqual({ text: "ab", caret: 0 });
  });
});

describe("«خيارات الرد»: the quote that is applied", () => {
  const body = "الأولى والثانية\nوالثالثة";
  it("a part of the message is kept; the whole message or nothing is an ordinary reply; words that are not in it are refused", () => {
    expect(quoteChoice("والثانية", body)).toEqual({ kind: "part", quote: "والثانية" });
    expect(quoteChoice("والثانية والثالثة", body)).toEqual({ kind: "part", quote: "والثانية والثالثة" });
    expect(quoteChoice(body, body)).toEqual({ kind: "whole" });
    expect(quoteChoice("  ", body)).toEqual({ kind: "whole" });
    expect(quoteChoice("كلام آخر", body)).toEqual({ kind: "not-part" });
  });
});

describe("the Arabic forms", () => {
  it("«محددة»، «محددتان»، then the number", () => {
    expect([1, 2, 3, 11].map((n) => ctCount("tgmsg.sel.count", n))).toEqual(["محددة", "محددتان", "3 محددة", "11 محددة"]);
  });

  it("the delete dialog says «حذف الرسالة»، «حذف رسالتين»، and the plural", () => {
    expect([1, 2, 3, 11].map((n) => ctCount("tgmsg.del.title", n))).toEqual(["حذف الرسالة", "حذف رسالتين", "حذف 3 رسائل", "حذف 11 رسالة"]);
    expect(ctCount("tgmsg.del.body", 1)).toBe("هل ترغب حقًّا في حذف هذه الرسالة؟");
    expect(ctCount("tgmsg.del.body", 2)).toBe("هل ترغب حقًّا في حذف هذه الرسائل؟");
  });

  it("the spec's own words", () => {
    expect(ct("tgmsg.pin.done")).toBe("تم تثبيت الرسالة.");
    expect(ct("tgmsg.undo")).toBe("تراجع");
    expect(ct("tgmsg.reply.hint")).toBe("انقر هنا لعرض خيارات الرد");
    expect(ct("tgmsg.reply.options")).toBe("خيارات الرد");
    expect(ct("tgmsg.reply.pick_quote")).toBe("تحديد اقتباس معين");
    expect(ct("tgmsg.reply.apply")).toBe("تطبيق التغييرات");
    expect(ct("tgmsg.reply.cancel")).toBe("عدم الرد");
    expect(ct("tgmsg.panel.emoji")).toBe("الرموز التعبيرية");
    expect(ct("tgmsg.panel.stickers")).toBe("الملصقات");
  });
});

describe("the new timings", () => {
  it("are named constants of the messages section", () => {
    expect(TG_MOTION.cardRowFadeMs).toBeLessThanOrEqual(200);
    expect(TG_MOTION.selectionCheckMs).toBeLessThanOrEqual(200);
    expect(TG_MOTION.quoteFlashMs).toBeLessThanOrEqual(2000);
    expect(TG_MOTION.emojiIdleMs).toBeGreaterThan(1000);
  });
});
