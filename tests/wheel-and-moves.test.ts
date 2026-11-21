import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { centredIndex, DEFAULT_WHEEL_PREFS, parseWheelPrefs, WHEEL_KEY, wheelLook } from "@/lib/nav/tab-wheel";
import { parseSpot, spotOf, spotStyle, SPOT_KEY } from "@/lib/calls/mini-window";

const read = (path: string) => readFileSync(path, "utf8");

describe("the tabs as a wheel (the owner, 2026-11-21: like the alarm's picker, sideways, the middle one is the chosen one)", () => {
  it("the wheel is on, it moves, and it is silent until the person asks for the tick", () => {
    expect(DEFAULT_WHEEL_PREFS).toEqual({ wheel: true, motion: true, sound: false });
    expect(WHEEL_KEY).toBe("zk-tab-wheel");
  });

  it("the remembered choice is read tolerantly: nothing, rubbish and half an answer all give the rest of the defaults", () => {
    expect(parseWheelPrefs(null)).toEqual(DEFAULT_WHEEL_PREFS);
    expect(parseWheelPrefs("{not json")).toEqual(DEFAULT_WHEEL_PREFS);
    expect(parseWheelPrefs('{"wheel":false}')).toEqual({ ...DEFAULT_WHEEL_PREFS, wheel: false });
    expect(parseWheelPrefs('{"sound":true,"motion":false,"wheel":"yes"}')).toEqual({ wheel: true, motion: false, sound: true });
  });

  it("the middle one is the tab whose centre is nearest the middle of the strip", () => {
    expect(centredIndex([40, 130, 230], 150)).toBe(1);
    expect(centredIndex([40, 130, 230], 400)).toBe(2);
    expect(centredIndex([-80, 20], 0)).toBe(1);
    expect(centredIndex([], 100)).toBe(-1);
  });

  it("the middle one is full size and bright, the ones beside it shrink and fade; with the motion off nothing scales", () => {
    expect(wheelLook(0, 100, true)).toEqual({ opacity: 1, scale: 1 });
    const near = wheelLook(100, 100, true);
    const far = wheelLook(250, 100, true);
    expect(near.opacity).toBeLessThan(1);
    expect(near.scale).toBeLessThan(1);
    expect(far.opacity).toBeLessThan(near.opacity);
    expect(far.scale).toBeLessThan(near.scale);
    expect(far.opacity).toBeGreaterThan(0.2);
    expect(wheelLook(-100, 100, true)).toEqual(near);
    expect(wheelLook(250, 100, false).scale).toBe(1);
  });

  it("the strip on a phone is a snapping scroller that follows the middle tab, ticks only when asked, and keeps the old strip for a computer and for «ترتيب»", () => {
    const tabs = read("src/components/shell/place-tabs.tsx");
    expect(tabs).toContain("data-tab-wheel");
    expect(tabs).toContain("snap-x snap-mandatory");
    expect(tabs).toContain("snap-center");
    expect(tabs).toContain("centredIndex(");
    expect(tabs).toContain("wheelLook(");
    expect(tabs).toContain("loadWheelPrefs");
    expect(tabs).toMatch(/prefs\.sound/);
    expect(tabs).toContain("(max-width: 767px)");
    expect(tabs).toContain("<SortableList");
    expect(tabs).toContain("useRosary(");
  });

  it("the three choices are in «المظهر واللغة», each with its words", () => {
    const section = read("src/components/settings-me/language-section.tsx");
    expect(section).toContain("<TabWheelBlock");
    const block = read("src/components/settings-me/tab-wheel-block.tsx");
    for (const key of ["wheel", "motion", "sound"]) expect(block).toContain(`settingsMe.wheel.${key}`);
    for (const key of ["settingsMe.wheel.title", "settingsMe.wheel.hint", "settingsMe.wheel.wheel", "settingsMe.wheel.motion", "settingsMe.wheel.sound"]) expect(AR[key], key).toBeTruthy();
  });
});

describe("the small call window goes where the person drops it", () => {
  const view = { width: 400, height: 800 };
  const box = { width: 176, height: 150 };

  it("a window dropped against the left edge is at 0, against the right edge at 1, in the middle at one half", () => {
    expect(spotOf({ left: 8, top: 100, ...box }, view, { top: 0, bottom: 0 }).fx).toBe(0);
    expect(spotOf({ left: 400 - 8 - 176, top: 100, ...box }, view, { top: 0, bottom: 0 }).fx).toBe(1);
    expect(spotOf({ left: 112, top: 100, ...box }, view, { top: 0, bottom: 0 }).fx).toBeCloseTo(0.5, 5);
  });

  it("the same for the top and the bottom, with the notch and the home bar kept clear", () => {
    expect(spotOf({ left: 50, top: 8, ...box }, view, { top: 0, bottom: 0 }).fy).toBe(0);
    expect(spotOf({ left: 50, top: 8 + 47, ...box }, view, { top: 47, bottom: 34 }).fy).toBe(0);
    expect(spotOf({ left: 50, top: 800 - 8 - 34 - 150, ...box }, view, { top: 47, bottom: 34 }).fy).toBe(1);
  });

  it("a drop outside the screen is pulled back to the edge, and a screen too small for the window gives 0", () => {
    expect(spotOf({ left: -50, top: -50, ...box }, view, { top: 0, bottom: 0 })).toEqual({ fx: 0, fy: 0 });
    expect(spotOf({ left: 900, top: 900, ...box }, view, { top: 0, bottom: 0 })).toEqual({ fx: 1, fy: 1 });
    expect(spotOf({ left: 0, top: 0, width: 500, height: 900 }, view, { top: 0, bottom: 0 })).toEqual({ fx: 0, fy: 0 });
  });

  it("what is remembered is two fractions of the room there is, so a turned phone or a resized window keeps it on screen", () => {
    expect(parseSpot({ fx: 0.25, fy: 1 })).toEqual({ fx: 0.25, fy: 1 });
    expect(parseSpot(JSON.stringify({ fx: 2, fy: -1 }))).toEqual({ fx: 1, fy: 0 });
    expect(parseSpot("junk")).toBeNull();
    expect(parseSpot({ fx: "a", fy: 0 })).toBeNull();
    expect(SPOT_KEY).toBe("zk-mini-call-spot");
    const style = spotStyle({ fx: 0.25, fy: 1 });
    expect(style.left).toContain("0.25");
    expect(style.top).toContain("env(safe-area-inset-top)");
    expect(style.transform).toContain("-100%");
  });

  it("the window follows a finger or a mouse, drops where it was let go, and a tap still goes back to the call", () => {
    const call = read("src/components/calls/call-provider.tsx");
    expect(call).toContain("spotOf(");
    expect(call).toContain("saveSpot(");
    expect(call).toContain("loadSpot(");
    expect(call).toContain("spotStyle(");
    expect(call).toContain("setPointerCapture");
    expect(call).toContain("touch-none");
    expect(call).toContain("isTap(");
  });
});

describe("«رسالة جديدة» is one menu: a message, a group, a topic, a meeting", () => {
  it("the phone's round button and the computer's pencil both open the menu; the topic is offered only to who may open one in the space on screen", () => {
    const fab = read("src/components/chat/v2/list/new-message-fab.tsx");
    for (const key of ["chath.new_dm", "chath.group.new", "chath.topic.new", "calls.meeting_new"]) expect(fab).toContain(key);
    expect(fab).toContain("onGroup");
    expect(fab).toContain("onTopic");
    const header = read("src/components/chat/v2/list/list-header.tsx");
    expect(header).toContain("<DropdownMenu");
    expect(header).toContain("onNewGroup");
    expect(header).toContain("onNewTopic");
    const column = read("src/components/chat/v2/list/chat-list-column.tsx");
    expect(column).toContain("<NewGroupDialog");
    expect(column).toContain("<NewTopicDialog");
    expect(column).toMatch(/oneSpace\.space\?\.canCreateTopic/);
    expect(column).toContain("useSpaceSections(");
  });

  it("the group dialog names the group, picks its people from the directory, and posts one GROUP", () => {
    const dialog = read("src/components/chat/home/new-group-dialog.tsx");
    expect(dialog).toContain('kind: "GROUP"');
    expect(dialog).toContain("/api/chat/directory");
    expect(dialog).toContain("memberIds");
    for (const key of ["chath.group.new", "chath.group.title", "chath.group.name", "chath.group.people", "chath.group.create", "chath.group.failed", "chath.group.needs_people"]) expect(AR[key], key).toBeTruthy();
  });
});
