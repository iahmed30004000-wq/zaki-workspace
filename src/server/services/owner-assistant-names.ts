import { db } from "@/server/db";
import { capText, refsInText, restoreRefs, type RefTable } from "@/server/ai/redact";

/**
 * «مساعد المالك» — PUTTING THE REAL NAMES BACK, for the owner's eyes only.
 *
 * The model only ever saw «موظف 3», T5, S2 ...; the screen shows the owner «أحمد», «#12 تجهيز العرض», «مساحة التسويق». The names
 * are read from the database here, by id, ONLY for ids that are in the conversation's table of references and inside the owner's
 * own company, and they go to the owner's browser and nowhere else (never into a stored message, never back to the model).
 */

export interface NameBook {
  users: Map<string, string>;
  tasks: Map<string, { number: number; title: string }>;
  spaces: Map<string, string>;
  projects: Map<string, string>;
}

export interface WantedIds {
  users?: Iterable<string>;
  tasks?: Iterable<string>;
  spaces?: Iterable<string>;
  projects?: Iterable<string>;
}

const list = (ids: Iterable<string> | undefined) => [...new Set(ids ?? [])];

/** The names of these ids inside the company (an id of another company simply has no name here). */
export async function loadNames(orgId: string, wanted: WantedIds): Promise<NameBook> {
  const users = list(wanted.users);
  const tasks = list(wanted.tasks);
  const spaces = list(wanted.spaces);
  const projects = list(wanted.projects);
  const [userRows, taskRows, spaceRows, projectRows] = await Promise.all([
    users.length
      ? db.organizationMember.findMany({
          // all-statuses: a person who left still has a name in an old answer
          where: { organizationId: orgId, userId: { in: users } },
          select: { userId: true, user: { select: { name: true } } },
        })
      : [],
    // task-visibility: an owner-level aggregate (numbers or names the owner board already shows); its audience is narrowed in A1.3 (policy/board.ts)
    tasks.length ? db.task.findMany({ where: { orgId, id: { in: tasks } }, select: { id: true, number: true, title: true } }) : [],
    spaces.length ? db.workspace.findMany({ where: { organizationId: orgId, id: { in: spaces } }, select: { id: true, name: true } }) : [],
    projects.length ? db.project.findMany({ where: { workspace: { organizationId: orgId }, id: { in: projects } }, select: { id: true, name: true } }) : [],
  ]);
  return {
    users: new Map(userRows.map((r) => [r.userId, r.user.name])),
    tasks: new Map(taskRows.map((r) => [r.id, { number: r.number, title: capText(r.title, 80) }])),
    spaces: new Map(spaceRows.map((r) => [r.id, r.name])),
    projects: new Map(projectRows.map((r) => [r.id, r.name])),
  };
}

export const taskText = (t: { number: number; title: string }) => `#${t.number} ${t.title}`;

export interface Restorer {
  restore(text: string): string;
  book: NameBook;
}

/** A function that turns the references in any of `texts` (and in `more`) back into real names, using the conversation's table. */
export async function restorerFor(orgId: string, table: RefTable, texts: readonly string[], more: WantedIds = {}): Promise<Restorer> {
  const refs = new Set(texts.flatMap((t) => refsInText(t)));
  const pick = (kind: string) => [...refs].filter((r) => r.startsWith(kind)).map((r) => table[r]).filter((id): id is string => typeof id === "string");
  const book = await loadNames(orgId, {
    users: [...pick("U"), ...list(more.users)],
    tasks: [...pick("T"), ...list(more.tasks)],
    spaces: [...pick("S"), ...list(more.spaces)],
    projects: [...pick("P"), ...list(more.projects)],
  });
  const show = (ref: string): string | undefined => {
    const id = table[ref];
    if (!id) return undefined;
    if (ref.startsWith("U")) return book.users.get(id);
    if (ref.startsWith("T")) {
      const t = book.tasks.get(id);
      return t ? taskText(t) : undefined;
    }
    if (ref.startsWith("S")) return book.spaces.get(id);
    return book.projects.get(id);
  };
  return { restore: (text) => restoreRefs(text, show), book };
}
