import type { BoardScope } from "@/server/policy/board";
import type { BoardWindow } from "@/lib/owner-board";
import { timeTrackedSection } from "@/server/services/time-section";

/**
 * «لوحة المالك» — THE EXTENSION POINT.  ⚠️ Marked on purpose: this is where a later feature adds its own columns.
 *
 * A «section» is a small, self-contained block of columns for the people table (and the CSV): it says which columns it adds
 * (with the dictionary key of each label AND of its formula line, because every indicator on the board carries its formula)
 * and, for the people on the page, loads their values. The board calls every registered section and renders whatever it
 * returns; an empty registry (today) draws nothing extra and breaks nothing.
 *
 * 🔧 To add a column: create a file next to this one that exports a `BoardSection`, import it below and add it to `BOARD_SECTIONS`.
 *    Nothing else of the board changes. A section must read ONLY the people it is asked for (`ctx.userIds`) and ONLY what falls in
 *    `ctx.window` and `ctx.scope`, and must return numbers, never customer data. Today: «الوقت المسجّل» (`time-section.ts`).
 */

export interface SectionColumn {
  /** Unique across every section (`<section>.<column>`). */
  key: string;
  /** Dictionary key of the column's header. */
  labelKey: string;
  /** Dictionary key of the one Arabic line saying exactly how the number is computed. */
  formulaKey: string;
  /** How a cell is written: a plain count, a duration in minutes written as «س د», or text. */
  kind: "count" | "minutes" | "text";
}

export interface SectionContext {
  orgId: string;
  timeZone: string;
  window: BoardWindow;
  scope: BoardScope;
  /** The people on the page: read only these. */
  userIds: readonly string[];
}

export type SectionCell = number | string | null;

export interface BoardSection {
  id: string;
  columns: readonly SectionColumn[];
  /** The feature switch of the section, when it has one: off, the section is skipped (no column at all, not a column of dashes). */
  enabled?(orgId: string): Promise<boolean>;
  /** Per person: one value per column key. A person missing from the map has no value (shown as «—»). */
  load(ctx: SectionContext): Promise<Map<string, Record<string, SectionCell>>>;
}

/** ⚠️ Registered here: «الوقت المسجّل». 🔧 It follows the board's own gate (the owner, or a `board.team` holder for their scope). */
export const BOARD_SECTIONS: readonly BoardSection[] = [timeTrackedSection];

export interface LoadedSections {
  columns: SectionColumn[];
  /** userId → column key → value. */
  values: Map<string, Record<string, SectionCell>>;
}

/**
 * Runs the sections. A section that fails is skipped (and its columns are not drawn): the board never goes down because an
 * add-on did. Column keys that clash with an earlier section's are dropped, so one add-on can not overwrite another.
 */
export async function loadSections(ctx: SectionContext, sections: readonly BoardSection[] = BOARD_SECTIONS): Promise<LoadedSections> {
  const columns: SectionColumn[] = [];
  const values = new Map<string, Record<string, SectionCell>>();
  const taken = new Set<string>();
  for (const section of sections) {
    let loaded: Map<string, Record<string, SectionCell>>;
    try {
      if (section.enabled && !(await section.enabled(ctx.orgId))) continue;
      loaded = await section.load(ctx);
    } catch {
      continue;
    }
    const mine = section.columns.filter((c) => !taken.has(c.key));
    for (const c of mine) taken.add(c.key);
    columns.push(...mine);
    for (const [userId, row] of loaded) {
      const into = values.get(userId) ?? {};
      for (const c of mine) if (c.key in row) into[c.key] = row[c.key] ?? null;
      values.set(userId, into);
    }
  }
  return { columns, values };
}
