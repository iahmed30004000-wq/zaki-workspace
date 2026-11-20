/**
 * «جديد» — WHAT A PERSON MAY START FROM THE GOLD BUTTON, AND IN WHICH ORDER.
 *
 * Pure (no React, no Next, no server imports), like places.ts: the (app) layout computes the person's
 * list on the server from their rank and switches, the wheel draws it, and the tests read it directly.
 *
 * Every action opens something that already exists — nothing here creates anything by itself:
 *   task      Today's quick add (`/?new=task` opens its sheet)
 *   project   the projects page's «مشروع جديد» form (`/projects?new=project`)
 *   doc       «ملف»: the library, its upload button ready (`/files?new=upload`)
 *   document  «مستند»: the space's text documents, the new document's title box ready (`/documents?new=document`)
 *   message   the chat's «محادثة جديدة» dialog, opened in place by the wheel
 *   watch     «نتفرّج سوا»: its page, the link box ready (`/watch?new=watch`)
 *   space     the «مساحة عمل جديدة» form of the space switcher, opened in place by the wheel
 *   person    the team page's «إضافة شخص» form (`/members?new=person`)
 *
 * ⚠️ Like the map, this is discoverability only: each form is refused by the server on its own.
 * 🔧 When a form's rule changes, change its `requires` here too (tests/shell-new-actions.test.ts pins it).
 */
import { opensOnCards, type SpaceLayout } from "../cards/shared";
import { canOpenPlace, canOpenTab, type NavSubject } from "./places";

export const NEW_ACTIONS = ["task", "project", "doc", "document", "message", "watch", "space", "person"] as const;
export type NewActionKey = (typeof NEW_ACTIONS)[number];

/** The query parameter a page reads to open its own form (`useNewIntent`). */
export const NEW_PARAM = "new";

/** Where an action goes when it is a page's own form; null when the wheel opens it in place. */
export const NEW_HREF: Record<NewActionKey, string | null> = {
  task: "/?new=task",
  project: "/projects?new=project",
  doc: "/files?new=upload",
  document: "/documents?new=document",
  message: null,
  watch: "/watch?new=watch",
  space: null,
  person: "/members?new=person",
};

/**
 * W1.8 — «مهمة» in a space of CARDS (`opensOnCards`): «اليوم» is not drawn there, «/» sends the person to `/cards` and a query would be dropped on the way,
 * so the intent travels to the cards page itself, which opens the task sheet (src/app/(app)/cards/page.tsx).
 */
export const CARDS_TASK_HREF = "/cards?new=task";

/**
 * Where an action goes. On the new map (`navV2`) «/» alone may be the company's landing page and send the person to the chat (N1.8), which would
 * drop the intent of «مهمة» (`/?new=task`): there the address is «اليوم»'s own, `/?view=today&new=task`. In a space of cards (`layout`) «مهمة» keeps its
 * intent on `/cards` (W1.8). Every other address is the same.
 */
export function newHrefFor(key: NewActionKey, v2 = false, layout?: SpaceLayout): string | null {
  if (key === "task" && opensOnCards(layout)) return CARDS_TASK_HREF;
  if (v2 && key === "task") return "/?view=today&new=task";
  return NEW_HREF[key];
}

/** The intents the cards page serves: the task sheet. (A project, a file… are not started from a space of cards.) */
export const CARDS_INTENTS: readonly NewActionKey[] = ["task"];

/**
 * The `?new=` of a page's search parameters when the cards page serves it (`task`), else null. A repeated parameter counts by its first value.
 */
export function cardsIntentOf(searchParams: Record<string, string | string[] | undefined> | undefined): NewActionKey | null {
  const raw = searchParams?.[NEW_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && isNewAction(value) && CARDS_INTENTS.includes(value) ? value : null;
}

/**
 * Where a space of cards sends a person who asked for «اليوم» (or the chat): `/cards`, and with a served intent `/cards?new=task`, so «جديد → مهمة» still
 * opens the sheet. The only value that ever reaches the address is one of `CARDS_INTENTS`, never what the visitor typed.
 */
export function cardsHomeHref(searchParams: Record<string, string | string[] | undefined> | undefined): string {
  const intent = cardsIntentOf(searchParams);
  return intent ? `/cards?${NEW_PARAM}=${intent}` : "/cards";
}

const staff = (s: NavSubject) => s.role !== "GUEST";
const holds = (s: NavSubject, cap: string) => staff(s) && s.caps.includes(cap);

/**
 * Who is offered each action. An external partner (guest) is offered none: the wheel is not drawn for
 * them at all (they are put in a space by a person, and start nothing company-wide).
 *   task, project   staff holding that row's «يضيف ويعدّل» box of the section grid (a project needs a space they
 *                   belong to: the form lists those)
 *   doc             whoever has the library and its «يضيف ويعدّل» box
 *   document        staff whose map shows «المستندات» (its switch `spaceDocs` on, a space that has the tab); the
 *                   page offers the title box only to a writer of the space they are in, and the server decides again
 *   message         any staff member (the chat is everybody's place)
 *   watch           staff with the «نتفرّج سوا» row's «يضيف ويعدّل» box (the place is the staff's)
 *   space           `spaces.create`
 *   person          `users.manage`
 */
const REQUIRES: Record<NewActionKey, (s: NavSubject) => boolean> = {
  task: (s) => holds(s, "tasks.edit"),
  project: (s) => holds(s, "projects.edit"),
  doc: (s) => holds(s, "files.edit") && canOpenTab(s, "files"),
  document: (s) => staff(s) && canOpenTab(s, "documents"),
  message: staff,
  watch: (s) => holds(s, "watch.edit") && canOpenPlace(s, "watch"),
  space: (s) => holds(s, "spaces.create"),
  person: (s) => holds(s, "users.manage"),
};

/** The actions this person is offered, in the wheel's own order. */
export function newActionsFor(subject: NavSubject): NewActionKey[] {
  return NEW_ACTIONS.filter((key) => REQUIRES[key](subject));
}

export function isNewAction(value: unknown): value is NewActionKey {
  return typeof value === "string" && (NEW_ACTIONS as readonly string[]).includes(value);
}

/**
 * The last action used comes first (the thing a person adds most is one press away); the rest keep the
 * wheel's order. Anything stored that is not offered any more is ignored.
 */
export function orderByLastUsed(offered: readonly NewActionKey[], last: unknown): NewActionKey[] {
  if (!isNewAction(last) || !offered.includes(last)) return [...offered];
  return [last, ...offered.filter((key) => key !== last)];
}

/** The device-local memory of the last action (a convenience: losing it only restores the default order). */
export const NEW_LAST_KEY = "zk.new.last";
