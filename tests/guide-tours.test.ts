import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import {
  TOUR_HOOKS,
  TOUR_KEYS,
  TOURS,
  chooseTour,
  hookSelector,
  hookSelectors,
  planTour,
  resolveTourSteps,
  tourForPath,
  toursOffered,
  type TourHook,
} from "@/lib/guide/tours";

/** The hooks the briefing promises (the contract between the shell, the home page, the guide and the themes). */
// «new» joined with «نجمة وطريق» (2026-10-24): the gold «جديد» of the top bar
// N1.6 (the new map): «menu» (the phone's ☰), «more-tabs» (the tab strip's «المزيد») and the three stops of the «الشغل» tour
const BRIEFED = [
  "places",
  "tabs",
  "search",
  "inbox",
  "new",
  "avatar",
  "theme",
  "today-tasks",
  "first-steps",
  "quick-add",
  "menu",
  "more-tabs",
  "work-mine",
  "work-requests",
  "work-inbox",
];

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("the tour hooks", () => {
  it("are exactly the stable hooks of the briefing", () => {
    expect([...TOUR_HOOKS].sort()).toEqual([...BRIEFED].sort());
  });

  it("make an attribute selector on data-tour", () => {
    expect(hookSelector("places")).toBe('[data-tour="places"]');
    expect(hookSelector("first-steps")).toBe('[data-tour="first-steps"]');
  });

  it("a hook the shell already marks with data-tour is looked up by that mark alone", () => {
    for (const hook of ["places", "tabs", "search", "inbox", "new", "avatar", "theme", "today-tasks", "first-steps", "quick-add"] as const) {
      expect(hookSelectors(hook), hook).toEqual([`[data-tour="${hook}"]`]);
    }
  });

  it("the phone's ☰ is found in the app bar AND in the chat's own list bar (the frame's bar is hidden there)", () => {
    expect(hookSelectors("menu")).toEqual(['[data-shell="drawer-open"]', "[data-chat-drawer-open]"]);
  });

  it("«المزيد» and the three «الشغل» stops are found by marks that other packages already draw (no file of theirs is edited)", () => {
    expect(hookSelectors("more-tabs")).toEqual(['[data-shell="more-tabs"]']);
    expect(hookSelectors("work-mine")).toEqual(['[data-tour="tabs"] a[href="/my-work"]']);
    expect(hookSelectors("work-requests")).toEqual(['[data-tour="tabs"] a[href="/requests"]']);
    expect(hookSelectors("work-inbox")).toEqual(['[data-work-inbox="pinned"]']);
  });

  it("every mark a hook relies on is really in the source that draws it", () => {
    expect(read("src/components/shell/app-bar.tsx")).toContain('data-shell="drawer-open"');
    expect(read("src/components/chat/v2/phone/list-bar.tsx")).toContain("data-chat-drawer-open");
    expect(read("src/components/shell/place-tabs.tsx")).toContain('data-shell="more-tabs"');
    expect(read("src/components/shell/place-tabs.tsx")).toContain('data-tour="tabs"');
    expect(read("src/app/(app)/projects/page.tsx")).toContain('data-work-inbox="pinned"');
    // the tabs the «الشغل» stops point at keep their addresses (no route and no tab key is renamed)
    const places = read("src/lib/nav/places.ts");
    expect(places).toContain('href: "/my-work"');
    expect(places).toContain('href: "/requests"');
  });

  it("the places mark is on every menu that can be on screen: the old side menu, the old bottom bar, the rail, the drawer and the phone's ☰", () => {
    for (const file of ["sidebar", "bottom-nav", "rail", "drawer", "app-bar"]) {
      expect(read(`src/components/shell/${file}.tsx`), file).toContain('data-tour="places"');
    }
  });
});

describe("the tours", () => {
  it("there is an app tour, a today tour and a «الشغل» tour", () => {
    expect([...TOUR_KEYS].sort()).toEqual(["shell", "today", "work"]);
    expect(Object.keys(TOURS).sort()).toEqual(["shell", "today", "work"]);
  });

  it("every step points at a known hook, and no tour visits the same hook twice", () => {
    for (const key of TOUR_KEYS) {
      const hooks = TOURS[key].map((s) => s.hook);
      for (const hook of hooks) expect(TOUR_HOOKS, `${key}: ${hook}`).toContain(hook);
      expect(new Set(hooks).size, key).toBe(hooks.length);
    }
  });

  it("the app tour walks the shell: the ☰, the places, the tabs and «المزيد», the search, the bell, «جديد», the avatar menu and the theme picker", () => {
    expect(TOURS.shell.map((s) => s.hook)).toEqual(["menu", "places", "tabs", "more-tabs", "search", "inbox", "new", "avatar", "theme"]);
  });

  it("the old map keeps its tour: with none of the new hooks on the page the stops are the old seven, in the old order", () => {
    const old = ["places", "tabs", "search", "inbox", "new", "avatar", "theme"] as const;
    expect(planTour("shell", (hook) => (old as readonly string[]).includes(hook)).map((s) => s.hook)).toEqual([...old]);
  });

  it("the today tour walks today's own elements: tasks, quick add and the first-steps card", () => {
    expect(TOURS.today.map((s) => s.hook)).toEqual(["today-tasks", "quick-add", "first-steps"]);
  });

  it("the «الشغل» tour walks «مهامي», «الطلبات» and «صندوق المهام»", () => {
    expect(TOURS.work.map((s) => s.hook)).toEqual(["work-mine", "work-requests", "work-inbox"]);
    expect(AR["guide.tour.work.work-mine.title"]).toBe("مهامي");
    expect(AR["guide.tour.work.work-requests.title"]).toBe("الطلبات");
    expect(AR["guide.tour.work.work-inbox.title"]).toBe("صندوق المهام");
  });

  it("every step has a title and a body in the dictionary, in Arabic, short — and so has its new-map body when it has one", () => {
    for (const key of TOUR_KEYS) {
      for (const step of TOURS[key]) {
        for (const k of [step.titleKey, step.bodyKey, ...(step.v2BodyKey ? [step.v2BodyKey] : [])]) {
          const text = AR[k];
          expect(text, `${key}/${step.hook}: ${k}`).toBeTruthy();
          expect(text, k).toMatch(/[؀-ۿ]/);
          expect(text, `${k}: Western digits only, no Latin letters`).not.toMatch(/[A-Za-z]/);
          expect((text ?? "").length, k).toBeLessThanOrEqual(150);
        }
        expect((AR[step.titleKey] ?? "").length).toBeLessThanOrEqual(30);
      }
    }
  });

  it("speaks to the person in the second person and never promises what is not built (no assistant, no calls)", () => {
    for (const key of TOUR_KEYS) {
      for (const step of TOURS[key]) {
        for (const k of [step.bodyKey, ...(step.v2BodyKey ? [step.v2BodyKey] : [])]) {
          const body = AR[k] ?? "";
          for (const word of ["المساعد", "مكالمة", "المكالمات"]) expect(body).not.toContain(word);
        }
      }
    }
  });

  it("the new map's words are the map's: «المزيد» and «الطلبات», never the old tab «القائمة» (the new map has none)", () => {
    const tabs = TOURS.shell.find((s) => s.hook === "tabs");
    expect(tabs?.v2BodyKey).toBeTruthy();
    const v2 = AR[tabs?.v2BodyKey ?? ""] ?? "";
    expect(v2).toContain("المزيد");
    expect(v2).toContain("الطلبات");
    expect(v2).not.toContain("القائمة");
    // the old text is untouched for the old map
    expect(AR[tabs?.bodyKey ?? ""]).toContain("القائمة");
  });

  it("the buttons of the tour are labelled in Arabic: التالي، السابق، تمام، إغلاق", () => {
    expect(AR["guide.tour.next"]).toBe("التالي");
    expect(AR["guide.tour.prev"]).toBe("السابق");
    expect(AR["guide.tour.done"]).toBe("تمام");
    expect(AR["guide.tour.close"]).toBe("إغلاق");
    // driver.js fills {{current}} and {{total}} itself
    expect(AR["guide.tour.progress"]).toContain("{{current}}");
    expect(AR["guide.tour.progress"]).toContain("{{total}}");
  });
});

describe("planTour: a step whose element is not on the page is skipped", () => {
  const present = (...hooks: TourHook[]) => (hook: TourHook) => hooks.includes(hook);

  it("keeps every step when every element is there, in order", () => {
    expect(planTour("shell", () => true).map((s) => s.hook)).toEqual(["menu", "places", "tabs", "more-tabs", "search", "inbox", "new", "avatar", "theme"]);
    expect(planTour("work", () => true).map((s) => s.hook)).toEqual(["work-mine", "work-requests", "work-inbox"]);
  });

  it("drops the steps whose element is missing and keeps the rest in order", () => {
    // the theme picker lives inside the closed avatar menu; a single-tab place has no tab strip
    expect(planTour("shell", present("places", "search", "inbox", "avatar")).map((s) => s.hook)).toEqual(["places", "search", "inbox", "avatar"]);
    expect(planTour("today", present("first-steps")).map((s) => s.hook)).toEqual(["first-steps"]);
    // a member without «الطلبات» (a guest, or the old map) still gets «مهامي»
    expect(planTour("work", present("work-mine", "work-inbox")).map((s) => s.hook)).toEqual(["work-mine", "work-inbox"]);
  });

  it("returns nothing when nothing is on the page (the caller says so instead of starting an empty tour)", () => {
    expect(planTour("shell", () => false)).toEqual([]);
    expect(planTour("today", () => false)).toEqual([]);
    expect(planTour("work", () => false)).toEqual([]);
  });

  it("an unknown tour plans nothing", () => {
    expect(planTour("nope" as never, () => true)).toEqual([]);
  });
});

describe("resolveTourSteps: the steps the tour library is given", () => {
  const t = (key: string) => AR[key] ?? key;

  it("pairs each present element with its Arabic title and body, and skips the missing ones", () => {
    const places = { name: "places-element" };
    const search = { name: "search-element" };
    const found: Partial<Record<TourHook, object>> = { places, search };
    const steps = resolveTourSteps("shell", t, (hook) => found[hook] ?? null);
    expect(steps.map((s) => s.element)).toEqual([places, search]);
    expect(steps.map((s) => s.popover.title)).toEqual([AR["guide.tour.shell.places.title"], AR["guide.tour.shell.search.title"]]);
    expect(steps.map((s) => s.popover.description)).toEqual([AR["guide.tour.shell.places.body"], AR["guide.tour.shell.search.body"]]);
    for (const s of steps) {
      expect(s.popover.title).toMatch(/[؀-ۿ]/);
      expect(s.popover.description).toMatch(/[؀-ۿ]/);
    }
  });

  it("on the new map a step that has its own words says them; on the old map it says the old ones", () => {
    const found: Partial<Record<TourHook, object>> = { tabs: {} };
    const find = (hook: TourHook) => found[hook] ?? null;
    expect(resolveTourSteps("shell", t, find, "v2")[0]?.popover.description).toBe(AR["guide.tour.shell.tabs.v2.body"]);
    expect(resolveTourSteps("shell", t, find, "v1")[0]?.popover.description).toBe(AR["guide.tour.shell.tabs.body"]);
    // no mode given: the old map
    expect(resolveTourSteps("shell", t, find)[0]?.popover.description).toBe(AR["guide.tour.shell.tabs.body"]);
  });

  it("is empty when no element is on the page", () => {
    expect(resolveTourSteps("today", t, () => null)).toEqual([]);
    expect(resolveTourSteps("work", t, () => null)).toEqual([]);
  });

  it("asks for each hook once, in the tour's order", () => {
    const asked: string[] = [];
    resolveTourSteps("shell", t, (hook) => {
      asked.push(hook);
      return null;
    });
    expect(asked).toEqual(["menu", "places", "tabs", "more-tabs", "search", "inbox", "new", "avatar", "theme"]);
  });

  it("never points at one element twice: the phone's ☰ carries the places mark too, and speaks once, as the menu", () => {
    const burger = { name: "☰" };
    const search = { name: "search" };
    const found: Partial<Record<TourHook, object>> = { menu: burger, places: burger, search };
    const steps = resolveTourSteps("shell", t, (hook) => found[hook] ?? null, "v2");
    expect(steps.map((s) => s.element)).toEqual([burger, search]);
    expect(steps[0]?.popover.title).toBe(AR["guide.tour.shell.menu.title"]);
  });

  it("never lets a popover sit to the physical left or right of an element (the page is right-to-left)", () => {
    const everything = () => ({});
    for (const key of TOUR_KEYS) {
      for (const s of resolveTourSteps(key, t, everything)) {
        expect(["top", "bottom", undefined]).toContain(s.popover.side);
      }
    }
  });
});

describe("the tour on each shape of the page (navV2 ON and OFF, computer and phone): what is on the page is visited, the rest is skipped", () => {
  const t = (key: string) => AR[key] ?? key;
  const titles = (steps: { popover: { title: string } }[]) => steps.map((s) => s.popover.title);
  const tour = (on: Partial<Record<TourHook, object>>, mode: "v1" | "v2") => resolveTourSteps("shell", t, (hook) => on[hook] ?? null, mode);

  it("OFF, computer: the side menu, the tab strip, the top bar — the old tour, word for word", () => {
    const steps = tour({ places: {}, tabs: {}, search: {}, inbox: {}, new: {}, avatar: {} }, "v1");
    expect(titles(steps)).toEqual(["places", "tabs", "search", "inbox", "new", "avatar"].map((h) => AR[`guide.tour.shell.${h}.title`]));
    expect(steps.map((s) => s.popover.description)).toEqual(["places", "tabs", "search", "inbox", "new", "avatar"].map((h) => AR[`guide.tour.shell.${h}.body`]));
  });

  it("OFF, phone: the bottom bar is the places stop", () => {
    expect(tour({ places: {}, search: {}, inbox: {} }, "v1").length).toBe(3);
  });

  it("ON, computer: the rail is the places stop, «المزيد» is a stop of its own, the avatar is in the rail's foot", () => {
    const steps = tour({ places: {}, tabs: {}, "more-tabs": {}, search: {}, inbox: {}, new: {}, avatar: {} }, "v2");
    expect(titles(steps)).toEqual(["places", "tabs", "more-tabs", "search", "inbox", "new", "avatar"].map((h) => AR[`guide.tour.shell.${h}.title`]));
  });

  it("ON, phone: ☰ is the one stop for the menu; the avatar and the theme live inside the closed drawer and are skipped, not broken", () => {
    const burger = {};
    const steps = tour({ menu: burger, places: burger, tabs: {}, search: {}, inbox: {}, new: {} }, "v2");
    expect(titles(steps)).toEqual(["menu", "tabs", "search", "inbox", "new"].map((h) => AR[`guide.tour.shell.${h}.title`]));
  });

  it("ON, phone, inside the chat: the frame's ☰ is hidden, the list bar's ☰ is the menu stop and nothing else of the frame is there", () => {
    const steps = tour({ menu: {} }, "v2");
    expect(titles(steps)).toEqual([AR["guide.tour.shell.menu.title"]]);
  });
});

describe("tourForPath: «فرجيني» on a page of «الشغل» opens the «الشغل» tour; everything else keeps its own", () => {
  it("maps the app tour on the front pages of the place", () => {
    for (const p of ["/my-work", "/my-work/", "/projects", "/requests"]) expect(tourForPath("shell", p), p).toBe("work");
  });

  it("leaves the app tour alone anywhere else, and never changes the today tour or an explicit work tour", () => {
    for (const p of ["/", "/chat", "/files", "/settings/me", "/projects/abc", "/my-work-x", "/requests-old", ""]) expect(tourForPath("shell", p), p).toBe("shell");
    expect(tourForPath("today", "/my-work")).toBe("today");
    expect(tourForPath("work", "/chat")).toBe("work");
  });
});

describe("chooseTour: the tour that has something to show on this page", () => {
  it("takes the «الشغل» tour on a work page when one of its elements is there", () => {
    expect(chooseTour("shell", "/my-work", (h) => h === "work-mine")).toBe("work");
  });

  it("falls back to the app tour when the page has none of the place's elements (a person who cannot open it)", () => {
    expect(chooseTour("shell", "/my-work", (h) => h === "places")).toBe("shell");
  });

  it("is null when nothing at all is there", () => {
    expect(chooseTour("shell", "/my-work", () => false)).toBeNull();
    expect(chooseTour("today", "/", () => false)).toBeNull();
  });

  it("a tour that was asked for by name is not swapped on another page", () => {
    expect(chooseTour("today", "/my-work", (h) => h === "today-tasks" || h === "work-mine")).toBe("today");
  });
});

describe("toursOffered: the tour of an area a person cannot open is not offered", () => {
  it("everybody is offered the app tour; «اليوم» and «الشغل» only when the menu has that place", () => {
    expect(toursOffered(["chat", "today", "work", "library"])).toEqual(["shell", "today", "work"]);
    expect(toursOffered(["chat", "library"])).toEqual(["shell"]);
    expect(toursOffered([])).toEqual(["shell"]);
    expect(toursOffered(["work"])).toEqual(["shell", "work"]);
  });
});

describe("the contract in the source: only known hooks are used as data-tour", () => {
  const SRC = path.resolve(__dirname, "../src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("every data-tour attribute written as a literal names a hook of the contract", () => {
    const unknown: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/data-tour=["']([^"']+)["']/g)) {
        if (!(TOUR_HOOKS as readonly string[]).includes(m[1] as string)) unknown.push(`${path.relative(SRC, file)}: ${m[1]}`);
      }
    }
    expect(unknown, "a new hook belongs in the briefing and in src/lib/guide/tours.ts").toEqual([]);
  });
});
