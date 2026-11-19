import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F1.4 — FEWER `router.refresh()`, NO RELOAD IN THE SPACE-EDIT BUTTON. A refresh re-runs the whole server tree (the layout
 * too); it stays only where a server-rendered page must draw again. Where the data is client-fetched (TanStack Query), the
 * query is invalidated instead. No behaviour changes. Source-text pins, like the other guard tests.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs).flatMap((name) => walk(`${rel}/${name}`));
}

const count = (source: string, needle: string) => source.split(needle).length - 1;

/**
 * The most `router.refresh()` calls each file of this package may hold. Lower a number when a refresh goes; raising one needs
 * a reason in the PR file (a server-rendered page that must draw again).
 */
const REFRESH_CEILING: Record<string, number> = {
  "src/components/workspace-edit-button.tsx": 1,
  "src/components/cards/card-page.tsx": 0,
  "src/components/documents/document-page.tsx": 1,
  "src/components/documents/documents-view.tsx": 1,
  "src/components/knowledge/sheet-view.tsx": 3,
  "src/components/ideas-view.tsx": 2,
  "src/components/org-name-form.tsx": 1,
  "src/components/approvals/detail-view.tsx": 3,
  "src/components/approvals/request-form.tsx": 1,
  "src/components/approvals/form-builder.tsx": 1,
  "src/components/approvals/form-archive-button.tsx": 1,
  "src/components/watch/watch-room.tsx": 1,
  "src/components/manufacturing/material-page.tsx": 5,
  "src/components/manufacturing/mfg-view.tsx": 3,
  "src/components/manufacturing/orders-view.tsx": 1,
  "src/components/manufacturing/recipes-view.tsx": 1,
  "src/components/rewards/pin-button.tsx": 1,
  "src/components/rewards/reward-card.tsx": 1,
  "src/components/team-development/notes-panel.tsx": 1,
  "src/components/team-development/person-skills.tsx": 1,
  "src/components/team-development/plan-panel.tsx": 2,
  "src/components/team-development/reviews-panel.tsx": 1,
  "src/components/team-development/settings-panel.tsx": 3,
  "src/components/team-development/skill-catalogue.tsx": 2,
  "src/components/team-development/supervisor-picker.tsx": 1,
};

const DIRECTORIES = [
  "src/components/manufacturing",
  "src/components/team-development",
  "src/components/rewards",
  "src/components/documents",
];

describe("F1.4 — the space-edit button never reloads the page", () => {
  const source = read("src/components/workspace-edit-button.tsx");

  it("has no window.location.reload()", () => {
    expect(source).not.toMatch(/location\s*\.\s*reload\s*\(/);
  });

  it("still refreshes the company's spaces list (the switcher) and re-draws the server page softly", () => {
    expect(source).toContain('invalidateQueries({ queryKey: ["orgs"] })');
    expect(count(source, "router.refresh()")).toBe(1);
  });
});

describe("F1.4 — the card page's delete invalidates the client-fetched list instead of refreshing", () => {
  const source = read("src/components/cards/card-page.tsx");

  it("asks the cards list to refetch and does not refresh the server tree", () => {
    expect(source).toContain('queryKey: ["cards"]');
    expect(count(source, "router.refresh()")).toBe(0);
  });

  it("still leaves for the list after the delete", () => {
    expect(source).toContain('router.push("/cards")');
  });
});

describe("F1.4 — a ceiling on router.refresh() in the files of this package", () => {
  const files = [...Object.keys(REFRESH_CEILING), ...DIRECTORIES.flatMap(walk)].filter(
    (f, i, all) => all.indexOf(f) === i && /\.tsx?$/.test(f),
  );

  it("no file holds more than its ceiling (a file not in the table holds none)", () => {
    const over = files
      .map((f) => ({ f, n: count(read(f), "router.refresh()"), max: REFRESH_CEILING[f] ?? 0 }))
      .filter((x) => x.n > x.max)
      .map((x) => `${x.f}: ${x.n} > ${x.max}`);
    expect(over).toEqual([]);
  });

  it("the package holds at most 39 router.refresh() in all, and no window.location.reload()", () => {
    const total = files.reduce((sum, f) => sum + count(read(f), "router.refresh()"), 0);
    expect(total).toBeLessThanOrEqual(Object.values(REFRESH_CEILING).reduce((a, b) => a + b, 0));
    expect(total).toBeLessThanOrEqual(39);
    for (const f of files) expect(read(f), f).not.toMatch(/location\s*\.\s*reload\s*\(/);
  });
});
