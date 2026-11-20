import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

import { TourRunner, findHookElement, hasSeenTour, navModeOf, startTour, stopTour } from "@/components/guide/tour-runner";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";

const t = (key: string) => AR[key] ?? key;
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;

interface FakeEl {
  name: string;
  w: number;
  h: number;
  display?: string;
  visibility?: string;
}

/** A page with these elements under these selectors; each answers getBoundingClientRect like a real one. */
function fakePage(bySelector: Record<string, FakeEl[]>) {
  vi.stubGlobal("getComputedStyle", (el: FakeEl) => ({ display: el.display ?? "block", visibility: el.visibility ?? "visible" }));
  return {
    querySelectorAll: (selector: string) =>
      (bySelector[selector] ?? []).map((el) => Object.assign(el, { getBoundingClientRect: () => ({ width: el.w, height: el.h }) })),
  } as unknown as ParentNode;
}

afterEach(() => vi.unstubAllGlobals());

describe("findHookElement: the element a hook points at", () => {
  it("looks the hook up by its data-tour attribute", () => {
    const asked: string[] = [];
    const root = { querySelectorAll: (selector: string) => (asked.push(selector), []) } as unknown as ParentNode;
    expect(findHookElement("places", root)).toBeNull();
    expect(asked).toEqual(['[data-tour="places"]']);
  });

  it("with two elements on one hook (a side menu and a bottom bar) points at the one that is shown", () => {
    const sideMenu: FakeEl = { name: "side menu", w: 0, h: 0, display: "none" };
    const bottomBar: FakeEl = { name: "bottom bar", w: 375, h: 64 };
    const root = fakePage({ '[data-tour="places"]': [sideMenu, bottomBar] });
    expect((findHookElement("places", root) as unknown as FakeEl).name).toBe("bottom bar");
  });

  it("an element with no size, display none or hidden visibility is not 'on the page'", () => {
    expect(findHookElement("tabs", fakePage({ '[data-tour="tabs"]': [{ name: "a", w: 0, h: 0 }] }))).toBeNull();
    expect(findHookElement("tabs", fakePage({ '[data-tour="tabs"]': [{ name: "b", w: 100, h: 40, display: "none" }] }))).toBeNull();
    expect(findHookElement("tabs", fakePage({ '[data-tour="tabs"]': [{ name: "c", w: 100, h: 40, visibility: "hidden" }] }))).toBeNull();
    expect(findHookElement("tabs", fakePage({ '[data-tour="tabs"]': [] }))).toBeNull();
  });

  it("takes the first shown one when several are", () => {
    const root = fakePage({ '[data-tour="search"]': [{ name: "first", w: 200, h: 40 }, { name: "second", w: 200, h: 40 }] });
    expect((findHookElement("search", root) as unknown as FakeEl).name).toBe("first");
  });
});

describe("findHookElement: a hook with several marks (the phone's ☰ in the app bar or in the chat's list bar)", () => {
  it("asks every selector of the hook, in order, and points at the first one that is shown", () => {
    const asked: string[] = [];
    const burger: FakeEl = { name: "chat burger", w: 44, h: 44 };
    const root = fakePage({ "[data-chat-drawer-open]": [burger] });
    const spy = root as unknown as { querySelectorAll: (selector: string) => unknown[] };
    const original = spy.querySelectorAll;
    spy.querySelectorAll = (selector: string) => (asked.push(selector), original(selector));
    expect((findHookElement("menu", root) as unknown as FakeEl).name).toBe("chat burger");
    expect(asked).toEqual(['[data-shell="drawer-open"]', "[data-chat-drawer-open]"]);
  });

  it("the app bar's ☰ wins when both are shown, and a hidden one is passed over", () => {
    const hidden: FakeEl = { name: "app bar burger", w: 0, h: 0, display: "none" };
    const chat: FakeEl = { name: "chat burger", w: 44, h: 44 };
    const root = fakePage({ '[data-shell="drawer-open"]': [hidden], "[data-chat-drawer-open]": [chat] });
    expect((findHookElement("menu", root) as unknown as FakeEl).name).toBe("chat burger");
    const shown: FakeEl = { name: "app bar burger", w: 44, h: 44 };
    const both = fakePage({ '[data-shell="drawer-open"]': [shown], "[data-chat-drawer-open]": [chat] });
    expect((findHookElement("menu", both) as unknown as FakeEl).name).toBe("app bar burger");
  });

  it("the «الشغل» stops are found inside the tab strip by their address, the inbox by its pinned mark", () => {
    const mine: FakeEl = { name: "mine", w: 80, h: 44 };
    const inbox: FakeEl = { name: "inbox", w: 300, h: 80 };
    const root = fakePage({ '[data-tour="tabs"] a[href="/my-work"]': [mine], '[data-work-inbox="pinned"]': [inbox] });
    expect((findHookElement("work-mine", root) as unknown as FakeEl).name).toBe("mine");
    expect((findHookElement("work-inbox", root) as unknown as FakeEl).name).toBe("inbox");
    expect(findHookElement("work-requests", root)).toBeNull();
  });
});

describe("navModeOf: which map is on the page", () => {
  it("the new map draws the app bar; the old one never does", () => {
    expect(navModeOf(fakePage({ '[data-shell="app-bar"]': [{ name: "bar", w: 800, h: 64 }] }))).toBe("v2");
    expect(navModeOf(fakePage({}))).toBe("v1");
  });
});

describe("startTour", () => {
  it("does nothing on the server (no document) and says so", async () => {
    expect(await startTour("shell", t)).toBe(false);
  });

  it("does not start, and says so, when none of the tour's elements is on the page", async () => {
    vi.stubGlobal("document", fakePage({}));
    expect(await startTour("shell", t)).toBe(false);
    expect(await startTour("today", t)).toBe(false);
    expect(await startTour("work", t)).toBe(false);
  });

  it("on a page of «الشغل» with none of the place's elements and none of the shell's, nothing starts either", async () => {
    vi.stubGlobal("document", fakePage({}));
    expect(await startTour("shell", t, { pathname: "/my-work" })).toBe(false);
  });
});

describe("stopTour", () => {
  it("is harmless when no tour is running", () => {
    expect(() => stopTour()).not.toThrow();
  });
});

describe("remembering a tour", () => {
  it("a device with no storage (the server) has seen nothing", () => {
    expect(hasSeenTour("shell")).toBe(false);
    expect(hasSeenTour("today")).toBe(false);
  });
});

describe("TourRunner", () => {
  it("draws nothing (it only starts a tour, and only when asked to)", () => {
    const html = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(TourRunner, { tour: "today", auto: true })));
    expect(html).toBe("");
  });
});
