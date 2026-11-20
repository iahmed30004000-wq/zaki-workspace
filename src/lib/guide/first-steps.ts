/**
 * The first-steps card for a new account («خطواتك الأولى»): which steps exist, for whom, and how
 * the card reads their state. A pure module; the facts that decide a step come from the database
 * (src/server/services/first-steps.ts) and the rest from the device (src/lib/guide/storage.ts).
 *
 * Each step has:
 *   audience       who it applies to - a guest is never asked to add a task, only a people manager
 *                  is asked to add a person
 *   availableFrom  the phase of the product in which the step exists. Only the steps whose phase has
 *                  come are shown, so a later phase adds its steps here (e.g. «ابعت أول رسالة» with
 *                  the chat of phase 3) without anything to switch off today.
 *   fact           what decides it from real data, or nothing: then the DEVICE decides (the app was
 *                  installed on this phone, the guide was opened here)
 *   manual         the person may also confirm it by hand with «تم»
 */
import { canRead, type Audience } from "./audience";
import type { FirstStepsLocal } from "./storage";

/** The phase this build belongs to. */
export const CURRENT_PHASE = 3;

/** Things the database can tell about a person. */
export type Fact = "theme" | "task-created" | "task-completed" | "people" | "spaces" | "message-sent";

export interface FirstStepDef {
  id: string;
  titleKey: string;
  hintKey: string;
  href: string;
  availableFrom: number;
  audience: Audience;
  fact?: Fact;
  manual?: boolean;
}

/** In the order they are shown. A people manager starts with the team, everybody else with the app. */
export const FIRST_STEPS: readonly FirstStepDef[] = [
  {
    id: "add-person",
    titleKey: "guide.first.add-person.title",
    hintKey: "guide.first.add-person.hint",
    href: "/members",
    availableFrom: 2,
    audience: "managers",
    fact: "people",
  },
  {
    id: "review-spaces",
    titleKey: "guide.first.review-spaces.title",
    hintKey: "guide.first.review-spaces.hint",
    href: "/projects",
    availableFrom: 2,
    audience: "managers",
    fact: "spaces",
  },
  {
    id: "install",
    titleKey: "guide.first.install.title",
    hintKey: "guide.first.install.hint",
    href: "/guide/install",
    availableFrom: 2,
    audience: "everyone",
    manual: true,
  },
  {
    id: "theme",
    titleKey: "guide.first.theme.title",
    hintKey: "guide.first.theme.hint",
    href: "/guide/themes",
    availableFrom: 2,
    audience: "everyone",
    fact: "theme",
  },
  {
    // phase 3 (the chat): say hello in the company's «عام». A guest is not in «الشركة», so staff only
    id: "first-message",
    titleKey: "guide.first.first-message.title",
    hintKey: "guide.first.first-message.hint",
    href: "/chat",
    availableFrom: 3,
    audience: "staff",
    fact: "message-sent",
  },
  {
    id: "first-task",
    titleKey: "guide.first.first-task.title",
    hintKey: "guide.first.first-task.hint",
    // «اليوم» by name: with the new map «/» alone is the landing page and may be the chat (N1.8)
    href: "/?view=today",
    availableFrom: 2,
    audience: "staff",
    fact: "task-created",
  },
  {
    id: "finish-task",
    titleKey: "guide.first.finish-task.title",
    hintKey: "guide.first.finish-task.hint",
    href: "/my-work",
    availableFrom: 2,
    audience: "staff",
    fact: "task-completed",
  },
  {
    id: "open-guide",
    titleKey: "guide.first.open-guide.title",
    hintKey: "guide.first.open-guide.hint",
    href: "/guide",
    availableFrom: 2,
    audience: "everyone",
  },
];

/** The steps this viewer is shown in this phase (a registry can be passed for tests or a later phase). */
export function stepsFor(
  audience: Audience,
  phase: number = CURRENT_PHASE,
  registry: readonly FirstStepDef[] = FIRST_STEPS,
): FirstStepDef[] {
  return registry.filter((step) => step.availableFrom <= phase && canRead(audience, step.audience));
}

/** A step as the card receives it: plain data, safe to hand to the browser. */
export interface FirstStepView {
  id: string;
  titleKey: string;
  hintKey: string;
  href: string;
  /** Decided by real data (true/false) or, for a device step, always false here: the device says. */
  done: boolean;
  /** The device decides this step (it has no fact in the database). */
  client: boolean;
  /** The person may confirm it by hand with «تم». */
  manual: boolean;
}

export function toViews(defs: readonly FirstStepDef[], facts: Partial<Record<Fact, boolean>>): FirstStepView[] {
  return defs.map((def) => ({
    id: def.id,
    titleKey: def.titleKey,
    hintKey: def.hintKey,
    href: def.href,
    done: def.fact ? facts[def.fact] === true : false,
    client: def.fact === undefined,
    manual: def.manual === true,
  }));
}

/** Done on the server's word, or - for a step the device decides - on the device's. */
export function stepDone(step: FirstStepView, local: FirstStepsLocal): boolean {
  return step.done || (step.client && local.done.includes(step.id));
}

export function progressOf(steps: readonly FirstStepView[], local: FirstStepsLocal): { done: number; total: number } {
  return { done: steps.filter((s) => stepDone(s, local)).length, total: steps.length };
}

/** Every step done. An empty list is not "all done": there is no card to finish. */
export function allStepsDone(steps: readonly FirstStepView[], local: FirstStepsLocal): boolean {
  return steps.length > 0 && steps.every((s) => stepDone(s, local));
}
