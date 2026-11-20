/**
 * N1.5 — the trail under a place: `المساحة › المشروع › اللوحة › المهمة`. Pure (no React, no server imports): the project page, the board page, the
 * timeline and the task read the same builders, and `src/components/shell/breadcrumbs.tsx` draws what they return.
 *
 * Every crumb but the last is a link (the way back); the last is the page itself and is not one. A crumb without a name is dropped, never drawn empty.
 */
export interface Crumb {
  label: string;
  /** Absent on the page itself (the last crumb). */
  href?: string;
}

export interface TrailPlaces {
  /** The space's name; its crumb leads to the place's «المشاريع». */
  spaceName: string;
  projectId: string;
  projectName: string;
}

const PROJECTS_HREF = "/projects";

/** Tidies a trail: a crumb with no name goes, the last one is never a link. */
export function finishTrail(crumbs: readonly Crumb[]): Crumb[] {
  const named = crumbs.filter((c) => c.label.trim() !== "");
  return named.map((c, i) => (i === named.length - 1 ? { label: c.label } : c));
}

/** The head every trail starts with: the space, then the project. */
const head = (p: TrailPlaces): Crumb[] => [
  { label: p.spaceName, href: PROJECTS_HREF },
  { label: p.projectName, href: `/projects/${p.projectId}` },
];

/**
 * A project page: `المساحة › المشروع`, then the tab's name when it is not the board's, or the board's own name when the board tab shows one of several
 * (so «المساحة › المشروع › اللوحة» reads the same on the project page and on the board's own page).
 */
export function projectTrail(p: TrailPlaces, leaf?: string | null): Crumb[] {
  return finishTrail([...head(p), ...(leaf ? [{ label: leaf }] : [])]);
}

/** A board's own page: `المساحة › المشروع › اللوحة`. */
export function boardTrail(p: TrailPlaces, boardName: string): Crumb[] {
  return finishTrail([...head(p), { label: boardName }]);
}

/** A task: `المساحة › المشروع › اللوحة › المهمة` — the board crumb leads back to the board the task was opened from. */
export function taskTrail(p: TrailPlaces, board: { id: string; name: string }, taskKey: string): Crumb[] {
  return finishTrail([...head(p), { label: board.name, href: `/boards/${board.id}` }, { label: taskKey }]);
}
