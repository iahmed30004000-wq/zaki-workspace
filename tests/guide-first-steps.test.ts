import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { AUDIENCES } from "@/lib/guide/audience";
import {
  CURRENT_PHASE,
  FIRST_STEPS,
  allStepsDone,
  progressOf,
  stepDone,
  stepsFor,
  toViews,
  type FirstStepDef,
} from "@/lib/guide/first-steps";
import type { FirstStepsLocal } from "@/lib/guide/storage";

const ids = (defs: readonly { id: string }[]) => defs.map((d) => d.id);
const local = (over: Partial<FirstStepsLocal> = {}): FirstStepsLocal => ({ dismissed: false, collapsed: false, done: [], ...over });

describe("the first-steps registry", () => {
  it("this phase is 3 (the chat), and every step today is available from phase 3 or earlier", () => {
    expect(CURRENT_PHASE).toBe(3);
    for (const step of FIRST_STEPS) expect(step.availableFrom, step.id).toBeLessThanOrEqual(3);
  });

  it("every step has a unique id, a title and a hint in the dictionary (Arabic), and a real page to go to", () => {
    expect(new Set(ids(FIRST_STEPS)).size).toBe(FIRST_STEPS.length);
    for (const step of FIRST_STEPS) {
      for (const key of [step.titleKey, step.hintKey]) {
        expect(AR[key], `${step.id}: ${key}`).toBeTruthy();
        expect(AR[key], key).toMatch(/[؀-ۿ]/);
      }
      expect(step.href, step.id).toMatch(/^\/[a-z0-9/-]*(\?[a-z]+=[a-z]+)?$/);
      expect(Number.isInteger(step.availableFrom) && step.availableFrom >= 1, step.id).toBe(true);
      expect(AUDIENCES).toContain(step.audience);
    }
  });

  it("no step sends a person to «/» alone: with the new map «/» is the landing page and may be the chat, so «اليوم» is asked for by name (N1.6)", () => {
    for (const step of FIRST_STEPS) expect(step.href, step.id).not.toBe("/");
    const byId = Object.fromEntries(FIRST_STEPS.map((s) => [s.id, s]));
    expect(byId["first-task"]?.href).toBe("/?view=today");
  });

  it("the steps are the owner's: install, theme, first message, first task, finish a task, open the guide; and for managers add a person and review the spaces", () => {
    expect([...ids(FIRST_STEPS)].sort()).toEqual(
      ["add-person", "finish-task", "first-message", "first-task", "install", "open-guide", "review-spaces", "theme"].sort(),
    );
    const titles = FIRST_STEPS.map((s) => AR[s.titleKey]);
    expect(titles).toContain("ثبّت التطبيق على موبايلك");
    expect(titles).toContain("اختار ثيمك");
    expect(titles).toContain("أضف أول مهمة");
    expect(titles).toContain("خلّص أول مهمة");
    expect(titles).toContain("افتح الدليل");
    expect(titles).toContain("ضيف أول شخص");
    expect(titles).toContain("افتح أول مساحة");
    expect(titles).toContain("ابعت أول رسالة بـ«عام»");
  });

  it("the install and guide steps are remembered by the device; the others are decided by real data", () => {
    const byId = Object.fromEntries(FIRST_STEPS.map((s) => [s.id, s]));
    expect(byId["install"]?.fact).toBeUndefined();
    expect(byId["open-guide"]?.fact).toBeUndefined();
    expect(byId["install"]?.manual).toBe(true);
    expect(byId["open-guide"]?.manual).toBeFalsy();
    expect(byId["theme"]?.fact).toBe("theme");
    expect(byId["first-task"]?.fact).toBe("task-created");
    expect(byId["finish-task"]?.fact).toBe("task-completed");
    expect(byId["add-person"]?.fact).toBe("people");
    expect(byId["review-spaces"]?.fact).toBe("spaces");
    expect(byId["first-message"]?.fact).toBe("message-sent");
  });
});

describe("stepsFor: who gets which steps, and which phase they exist in", () => {
  it("a guest gets only the steps that apply to a guest (no tasks to write, no people to add)", () => {
    expect(ids(stepsFor("everyone"))).toEqual(["install", "theme", "open-guide"]);
  });

  it("staff add the first message and the two task steps (a guest is not in «الشركة», so no «عام» step for them)", () => {
    expect(ids(stepsFor("staff"))).toEqual(["install", "theme", "first-message", "first-task", "finish-task", "open-guide"]);
  });

  it("managers get the people steps, first (a new owner's first job is the team)", () => {
    expect(ids(stepsFor("managers"))).toEqual(["add-person", "review-spaces", "install", "theme", "first-message", "first-task", "finish-task", "open-guide"]);
  });

  it("before phase 2 there is nothing to show, phase 2 has everything but the chat's step, and later phases change nothing about today's steps", () => {
    expect(stepsFor("managers", 1)).toEqual([]);
    expect(ids(stepsFor("managers", 2))).toEqual(ids(stepsFor("managers")).filter((id) => id !== "first-message"));
    expect(ids(stepsFor("managers", 3))).toEqual(ids(stepsFor("managers")));
    expect(ids(stepsFor("managers", 9))).toEqual(ids(stepsFor("managers")));
  });

  it("a step of a later phase is held back until its phase (the registry is data, not code)", () => {
    const later: FirstStepDef = {
      id: "send-message",
      titleKey: "guide.first.install.title",
      hintKey: "guide.first.install.hint",
      href: "/chat",
      availableFrom: 3,
      audience: "staff",
    };
    const registry = [...FIRST_STEPS, later];
    expect(ids(stepsFor("staff", 2, registry))).not.toContain("send-message");
    expect(ids(stepsFor("staff", 3, registry))).toContain("send-message");
    expect(ids(stepsFor("everyone", 3, registry))).not.toContain("send-message");
  });
});

describe("toViews: what the card is told", () => {
  const defs = stepsFor("managers");

  it("marks the data steps from the facts and never marks a device step done on the server", () => {
    const views = toViews(defs, { theme: true, "task-created": true, "task-completed": false, people: true, spaces: false, "message-sent": true });
    const done = Object.fromEntries(views.map((v) => [v.id, v.done]));
    expect(done).toEqual({
      "add-person": true,
      "review-spaces": false,
      install: false,
      theme: true,
      "first-message": true,
      "first-task": true,
      "finish-task": false,
      "open-guide": false,
    });
  });

  it("says which steps the device decides, and which one the person may confirm by hand", () => {
    const views = toViews(defs, {});
    const byId = Object.fromEntries(views.map((v) => [v.id, v]));
    expect(byId["install"]).toMatchObject({ client: true, manual: true });
    expect(byId["open-guide"]).toMatchObject({ client: true, manual: false });
    expect(byId["theme"]).toMatchObject({ client: false, manual: false });
  });

  it("carries only plain data (keys, link, flags): nothing the browser could not receive", () => {
    for (const view of toViews(defs, {})) {
      expect(Object.keys(view).sort()).toEqual(["client", "done", "hintKey", "href", "id", "manual", "titleKey"]);
    }
  });

  it("a fact that is missing counts as not done", () => {
    for (const view of toViews(stepsFor("staff"), {})) expect(view.done).toBe(false);
  });
});

describe("the device's memory: stepDone, allStepsDone, progressOf", () => {
  const views = toViews(stepsFor("staff"), { theme: true });

  it("a step is done when the server says so or the device remembers it", () => {
    expect(stepDone(views.find((v) => v.id === "theme")!, local())).toBe(true);
    expect(stepDone(views.find((v) => v.id === "install")!, local())).toBe(false);
    expect(stepDone(views.find((v) => v.id === "install")!, local({ done: ["install"] }))).toBe(true);
    // a remembered id never completes a step that is decided by data
    expect(stepDone(views.find((v) => v.id === "first-task")!, local({ done: ["first-task"] }))).toBe(false);
  });

  it("counts the steps done and the total", () => {
    expect(progressOf(views, local())).toEqual({ done: 1, total: 6 });
    expect(progressOf(views, local({ done: ["install", "open-guide"] }))).toEqual({ done: 3, total: 6 });
  });

  it("everything is done only when every step is: the card then disappears", () => {
    expect(allStepsDone(views, local())).toBe(false);
    const all = toViews(stepsFor("staff"), { theme: true, "task-created": true, "task-completed": true, "message-sent": true });
    expect(allStepsDone(all, local({ done: ["install"] }))).toBe(false);
    expect(allStepsDone(all, local({ done: ["install", "open-guide"] }))).toBe(true);
  });

  it("an empty list is never 'all done' (there is no card to dismiss, and nothing to celebrate)", () => {
    expect(allStepsDone([], local())).toBe(false);
    expect(progressOf([], local())).toEqual({ done: 0, total: 0 });
  });
});
