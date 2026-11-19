import { describe, expect, it } from "vitest";
import { COMMIT_PX, EDGE_PX, FLICK_PX, atStartEdge, commitsBack, dragOffset, inwardOf, swipeIntent } from "@/lib/chat/v2/phone/edge-swipe";
import { MIN_KEYBOARD_PX, keyboardInsetOf } from "@/lib/chat/v2/phone/keyboard";
import { phoneBackOf, phoneScreenOf } from "@/lib/chat/v2/phone/screens";
import { chatHref } from "@/lib/chat/v2/routes";

/**
 * C2.8 — the pure rules of the phone screens (no React, no browser): the swipe from the start edge, the keyboard's inset, and which screen of the phone an
 * address is. The timing and the feel of them are the owner's check on a real phone (docs/restructure/pr/C2.8.md).
 */
describe("the swipe from the start edge goes back", () => {
  it("starts only inside the edge strip of the START side: the right edge in this right-to-left layout, the left one in a left-to-right page", () => {
    expect(atStartEdge(375 - 1, 375, true)).toBe(true);
    expect(atStartEdge(375 - EDGE_PX, 375, true)).toBe(true);
    expect(atStartEdge(375 - EDGE_PX - 1, 375, true)).toBe(false);
    expect(atStartEdge(2, 375, true)).toBe(false);
    expect(atStartEdge(2, 375, false)).toBe(true);
    expect(atStartEdge(EDGE_PX + 1, 375, false)).toBe(false);
  });

  it("the distance is measured toward the inline END (leftwards in right-to-left), so a drag the other way is never a back", () => {
    expect(inwardOf(370, 300, true)).toBe(70);
    expect(inwardOf(370, 380, true)).toBe(-10);
    expect(inwardOf(5, 80, false)).toBe(75);
    expect(dragOffset(-10)).toBe(0);
    expect(dragOffset(40)).toBe(40);
  });

  it("a finger that has hardly moved decides nothing; a mostly sideways one is a swipe; a mostly vertical one is the page's own scroll", () => {
    expect(swipeIntent(3, 4)).toBe("undecided");
    expect(swipeIntent(30, 4)).toBe("swipe");
    expect(swipeIntent(6, 40)).toBe("scroll");
    expect(swipeIntent(30, 29)).toBe("scroll");
    expect(swipeIntent(-30, 2)).toBe("scroll");
  });

  it("commits on a long enough pull, or on a short quick flick; never on a short slow one, nor on a diagonal one", () => {
    expect(commitsBack({ inward: COMMIT_PX, dy: 5, ms: 600 })).toBe(true);
    expect(commitsBack({ inward: COMMIT_PX - 1, dy: 5, ms: 600 })).toBe(false);
    expect(commitsBack({ inward: FLICK_PX + 4, dy: 3, ms: 40 })).toBe(true);
    expect(commitsBack({ inward: FLICK_PX + 4, dy: 3, ms: 400 })).toBe(false);
    expect(commitsBack({ inward: 120, dy: 110, ms: 200 })).toBe(false);
    expect(commitsBack({ inward: -90, dy: 0, ms: 100 })).toBe(false);
  });
});

describe("the composer above the keyboard", () => {
  it("is zero while the visible area is the whole window (a browser that resizes the page by itself: `interactiveWidget: resizes-content`)", () => {
    expect(keyboardInsetOf({ layoutHeight: 812, viewportHeight: 812, viewportTop: 0 })).toBe(0);
  });

  it("is what the keyboard hides (a browser that slides it over the page: Safari on an iPhone)", () => {
    expect(keyboardInsetOf({ layoutHeight: 812, viewportHeight: 520, viewportTop: 0 })).toBe(292);
    // the page was scrolled a little by the focus: the top offset is not part of what the keyboard hides
    expect(keyboardInsetOf({ layoutHeight: 812, viewportHeight: 500, viewportTop: 40 })).toBe(272);
  });

  it("ignores a small change (the address bar folding is not a keyboard) and never goes negative", () => {
    expect(keyboardInsetOf({ layoutHeight: 812, viewportHeight: 812 - (MIN_KEYBOARD_PX - 1), viewportTop: 0 })).toBe(0);
    expect(keyboardInsetOf({ layoutHeight: 700, viewportHeight: 812, viewportTop: 0 })).toBe(0);
    expect(keyboardInsetOf({ layoutHeight: Number.NaN, viewportHeight: 300, viewportTop: 0 })).toBe(0);
  });
});

describe("which screen of the phone an address is, and where back goes", () => {
  it("the list, the forum view, a conversation, its info screen and its whiteboard", () => {
    expect(phoneScreenOf("/chat")).toBe("list");
    expect(phoneScreenOf("/chat/s/space1")).toBe("forum");
    expect(phoneScreenOf("/chat/c1")).toBe("conversation");
    expect(phoneScreenOf("/chat/c1/info")).toBe("info");
    expect(phoneScreenOf("/chat/c1/whiteboard")).toBe("conversation");
    expect(phoneScreenOf("/tasks")).toBe("other");
    expect(phoneScreenOf(null)).toBe("other");
  });

  it("back from the info screen is the conversation, from the conversation the list; the list has no back", () => {
    expect(phoneBackOf("/chat/c1/info")).toBe("/chat/c1");
    expect(phoneBackOf("/chat/c1")).toBe("/chat");
    expect(phoneBackOf("/chat/c1/whiteboard")).toBe("/chat/c1");
    expect(phoneBackOf("/chat/s/space1")).toBeNull();
    expect(phoneBackOf("/chat")).toBeNull();
    expect(phoneBackOf("/tasks")).toBeNull();
    expect(phoneBackOf("/chat/a%20b/info")).toBe("/chat/a%20b");
  });

  it("the info screen has a route builder next to the others", () => {
    expect(chatHref.info("c1")).toBe("/chat/c1/info");
    expect(chatHref.info("a b")).toBe("/chat/a%20b/info");
  });
});
