import { describe, expect, it } from "vitest";
import { FALLBACK_ASPECT, IMAGE_MAX_H, IMAGE_MAX_W, VOICE_ROW_PX, estimateRowHeight, imageBox } from "@/lib/chat/viewport/sizes";
import { buildRows, type Row } from "@/lib/chat/viewport/rows";
import { detectArrival, newestArrival } from "@/lib/chat/viewport/arrival";
import { makeConversation } from "./chat-history-model.test";
import type { AttachmentDto } from "@/server/chat/dto";
import type { MessageDto } from "@/lib/chat/cache/types";

/**
 * C1.7 — what the virtual list knows about a row BEFORE it is drawn: a picture reserves its box from the attachment's own
 * width / height (a missing size falls back to ONE fixed box, so nothing jumps when the picture loads); a voice row has a fixed height.
 */

const image = (over: Partial<AttachmentDto> = {}): AttachmentDto => ({ id: "a1", kind: "IMAGE", name: "x.jpg", mime: "image/jpeg", size: 1000, url: "/f/a1", ...over });
const one = (over: Partial<MessageDto>): Row => {
  const [m] = makeConversation(1, 1, () => over);
  return buildRows([m!], {}).find((r) => r.type === "message")!;
};

describe("the box a picture reserves", () => {
  it("is the picture's own size when it fits, and scaled to fit the maximum box (aspect kept) when it does not", () => {
    expect(imageBox(image({ width: 200, height: 100 }))).toEqual({ width: 200, height: 100 });
    const wide = imageBox(image({ width: 4000, height: 2000 }));
    expect(wide.width).toBe(IMAGE_MAX_W);
    expect(wide.height).toBe(IMAGE_MAX_W / 2);
    const tall = imageBox(image({ width: 1000, height: 4000 }));
    expect(tall.height).toBe(IMAGE_MAX_H);
    expect(Math.abs(tall.width / tall.height - 0.25)).toBeLessThan(0.01);
    expect(wide.width / wide.height).toBeCloseTo(2, 1);
  });

  it("an older row with no size (or a nonsense one) gets the same fixed fallback box: it can never be a layout jump", () => {
    const fallback = { width: IMAGE_MAX_W, height: Math.round(IMAGE_MAX_W / FALLBACK_ASPECT) };
    expect(imageBox(image())).toEqual(fallback);
    expect(imageBox(image({ width: 0, height: 0 }))).toEqual(fallback);
    expect(imageBox(image({ width: -5, height: 100 }))).toEqual(fallback);
    expect(imageBox(image({ width: Number.NaN, height: 100 }))).toEqual(fallback);
    expect(imageBox(image({ width: 300 }))).toEqual(fallback); // half a size is no size
  });

  it("a hairline or a speck is kept at a box a finger can see, never zero", () => {
    const tiny = imageBox(image({ width: 1, height: 1 }));
    expect(tiny.width).toBeGreaterThanOrEqual(1);
    expect(tiny.height).toBeGreaterThanOrEqual(1);
    const thin = imageBox(image({ width: 5000, height: 4 }));
    expect(thin.height).toBeGreaterThanOrEqual(1);
  });
});

describe("the height the list estimates for a row", () => {
  it("a voice row is ONE fixed height whatever its body or length, and does not depend on its waveform", () => {
    const a = estimateRowHeight(one({ kind: "VOICE", body: null, attachments: [{ ...image({ kind: "AUDIO", mime: "audio/webm", durationMs: 3000, peaks: [1, 2, 3] }) }] }));
    const b = estimateRowHeight(one({ kind: "VOICE", body: null, attachments: [{ ...image({ kind: "AUDIO", mime: "audio/webm", durationMs: 300_000, peaks: Array.from({ length: 64 }, (_, i) => i) }) }] }));
    expect(a).toBe(VOICE_ROW_PX);
    expect(b).toBe(VOICE_ROW_PX);
  });

  it("a picture row includes the reserved box, so the estimate and the box agree; two pictures stack", () => {
    const box = imageBox(image({ width: 400, height: 300 }));
    const text = estimateRowHeight(one({ body: "x" }));
    const withPicture = estimateRowHeight(one({ body: "x", attachments: [image({ width: 400, height: 300 })] }));
    expect(withPicture).toBeGreaterThanOrEqual(text + box.height);
    const two = estimateRowHeight(one({ body: "x", attachments: [image({ width: 400, height: 300 }), image({ id: "a2", width: 400, height: 300 })] }));
    expect(two).toBeGreaterThanOrEqual(withPicture + box.height);
    // a size-less picture is estimated with the fallback box
    const noSize = estimateRowHeight(one({ body: "x", attachments: [image()] }));
    expect(noSize).toBeGreaterThanOrEqual(text + imageBox(image()).height);
  });

  it("a longer text is taller; a deleted message and a system line are short; day and unread rows are fixed", () => {
    const short = estimateRowHeight(one({ body: "مرحبا" }));
    const long = estimateRowHeight(one({ body: "كلمة ".repeat(200) }));
    expect(long).toBeGreaterThan(short);
    expect(estimateRowHeight(one({ deleted: true, body: null }))).toBeLessThanOrEqual(short);
    expect(estimateRowHeight(one({ kind: "SYSTEM", body: null }))).toBeLessThanOrEqual(short);
    const rows = buildRows(makeConversation(2, 1), { unreadBeforeId: "m000001" });
    const day = rows.find((r) => r.type === "day")!;
    const unread = rows.find((r) => r.type === "unread")!;
    expect(estimateRowHeight(day)).toBeGreaterThan(0);
    expect(estimateRowHeight(unread)).toBeGreaterThan(0);
    expect(estimateRowHeight(day)).toBe(estimateRowHeight(day));
  });

  it("is always a positive whole number of pixels (the virtualizer sums them)", () => {
    for (const over of [{}, { body: null }, { kind: "POLL" as const }, { kind: "CARD" as const }, { replyTo: { id: "r", preview: "x", authorName: "س" } }, { reactions: [{ emoji: "👍", count: 2, mine: false }] }]) {
      const h = estimateRowHeight(one(over));
      expect(Number.isInteger(h) && h > 0).toBe(true);
    }
  });
});

describe("where a new newest message leaves the view (today's owner-approved rules, applied to a window of the list)", () => {
  const base = { previousNewestId: "a", newestId: "b", opening: false, mine: false, atBottom: false, aroundHit: false };

  it("nothing happens when the newest message did not change", () => {
    expect(newestArrival({ ...base, newestId: "a" })).toBe("none");
    expect(newestArrival({ ...base, newestId: null })).toBe("none");
  });

  it("own message and at-the-bottom stay at the bottom; reading old messages gets the «↓ رسائل جديدة» counter; around a hit stays", () => {
    expect(newestArrival({ ...base, mine: true })).toBe("bottom");
    expect(newestArrival({ ...base, atBottom: true })).toBe("bottom");
    expect(newestArrival(base)).toBe("badge");
    expect(newestArrival({ ...base, aroundHit: true })).toBe("stay");
    expect(newestArrival({ ...base, aroundHit: true, mine: true })).toBe("stay");
  });

  it("the first newest message of an opening goes to the bottom, unless the opening landed somewhere else (unread, a jump)", () => {
    expect(newestArrival({ ...base, previousNewestId: null, opening: true })).toBe("bottom");
    expect(newestArrival({ ...base, previousNewestId: null, opening: true, aroundHit: true })).toBe("stay");
    // «opening» only counts for the very first newest message
    expect(newestArrival({ ...base, previousNewestId: "a", opening: true })).toBe("badge");
  });
});

describe("did a message ARRIVE at the end of the list?", () => {
  const list = (n: number, mineLast = false) => makeConversation(n, 1, (i) => ({ mine: mineLast && i === n - 1 }));
  const at = (id: string | null, hasNewer = false) => ({ id, hasNewer });

  it("a live message at the end of a window that reached the newest message is an arrival, counted by how many are below the old newest", () => {
    const all = list(12);
    expect(detectArrival({ previous: at(all[9]!.id), messages: all.slice(0, 11), hasNewer: false, atBottom: false })).toEqual({ action: "badge", count: 1 });
    expect(detectArrival({ previous: at(all[9]!.id), messages: all.slice(0, 12), hasNewer: false, atBottom: false })).toEqual({ action: "badge", count: 2 }); // a burst
    expect(detectArrival({ previous: at(all[9]!.id), messages: all.slice(0, 11), hasNewer: false, atBottom: true })).toEqual({ action: "bottom", count: 1 });
    expect(detectArrival({ previous: at(all[9]!.id), messages: list(11, true), hasNewer: false, atBottom: false }).action).toBe("bottom"); // my own
  });

  it("paging, a replaced window, the first rows of an opening and an unchanged end are NOT arrivals", () => {
    const all = list(120);
    // «after» page appended to a window that was NOT at the newest: paging forward
    expect(detectArrival({ previous: at(all[49]!.id, true), messages: all.slice(0, 100), hasNewer: false, atBottom: false }).action).toBe("none");
    // still not at the newest after the page
    expect(detectArrival({ previous: at(all[49]!.id, true), messages: all.slice(0, 100), hasNewer: true, atBottom: false }).action).toBe("none");
    // the windows were replaced (the old newest message is not in the new list)
    expect(detectArrival({ previous: at("gone"), messages: all.slice(70, 120), hasNewer: false, atBottom: false }).action).toBe("none");
    // the first rows of an opening
    expect(detectArrival({ previous: at(null), messages: all.slice(0, 50), hasNewer: false, atBottom: true }).action).toBe("none");
    // nothing new at the end (an older page in front)
    expect(detectArrival({ previous: at(all[119]!.id), messages: all, hasNewer: false, atBottom: false }).action).toBe("none");
    expect(detectArrival({ previous: at(all[0]!.id), messages: [], hasNewer: false, atBottom: false }).action).toBe("none");
  });
});

describe("the viewport applies exactly the rules of conversation/client.ts", () => {
  it("every combination of opening / mine / atBottom / aroundHit gives onNewest's answer", async () => {
    const { onNewest } = await import("@/lib/chat/conversation/client");
    for (const opening of [false, true]) {
      for (const mine of [false, true]) {
        for (const atBottom of [false, true]) {
          for (const aroundHit of [false, true]) {
            // the very first newest message of an opening: previousNewestId null, so `opening` counts
            expect(newestArrival({ previousNewestId: null, newestId: "b", opening, mine, atBottom, aroundHit })).toBe(onNewest({ opening, mine, atBottom, aroundHit }));
            // a later one: `opening` no longer counts
            expect(newestArrival({ previousNewestId: "a", newestId: "b", opening, mine, atBottom, aroundHit })).toBe(onNewest({ opening: false, mine, atBottom, aroundHit }));
          }
        }
      }
    }
  });
});
