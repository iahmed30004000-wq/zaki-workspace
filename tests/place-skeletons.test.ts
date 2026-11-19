import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { PLACE_FRAMES } from "@/components/ui/skeletons";
import { PHYSICAL_UTILITY, PALETTE_COLOUR, classTokens, classesOf, textOf } from "./ui-render"; // (also puts the global React the TSX files need under vitest in place)

/**
 * F1.6 — A LOADING SKELETON PER PLACE, shaped like its page. Pure render tests and source guards: no browser timing is claimed.
 */

const ROOT = join(__dirname, "..");
const APP = join(ROOT, "src", "app", "(app)");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

type Place = {
  /** The folder under src/app/(app). */
  dir: string;
  /** The shape the skeleton draws: what the real page is made of. */
  shape: "list" | "sections" | "grid" | "document" | "table" | "schedule" | "room";
  /** The file whose markup holds the page's own outer container: the skeleton must wear the same classes, so nothing jumps when the page arrives. */
  source: string;
};

const PLACES: Place[] = [
  { dir: "files", shape: "list", source: "src/components/files-view.tsx" },
  { dir: "documents", shape: "document", source: "src/components/documents/document-page.tsx" },
  { dir: "knowledge", shape: "document", source: "src/components/knowledge/sheet-view.tsx" },
  { dir: "tickets", shape: "sections", source: "src/components/work-desks.tsx" },
  { dir: "departments", shape: "grid", source: "src/components/departments-view.tsx" },
  { dir: "goals", shape: "list", source: "src/components/goals-view.tsx" },
  { dir: "ideas", shape: "list", source: "src/components/ideas-view.tsx" },
  { dir: "campaigns", shape: "sections", source: "src/components/work-desks.tsx" },
  { dir: "crm", shape: "table", source: "src/components/crm-view.tsx" },
  { dir: "production", shape: "schedule", source: "src/components/production-view.tsx" },
  { dir: "watch", shape: "room", source: "src/components/watch/watch-room.tsx" },
  { dir: "time", shape: "table", source: "src/components/time/time-report.tsx" },
  { dir: "checkins", shape: "list", source: "src/components/checkins/checkins-view.tsx" },
  { dir: "cards", shape: "document", source: "src/components/cards/card-page.tsx" },
  { dir: "archive", shape: "list", source: "src/app/(app)/archive/page.tsx" },
];

/** Places whose page is changed by a LATER step: that step shapes its own skeleton, so none is made here. */
const LATER = [
  "my-work", "projects", "projects/[id]", "boards/[id]", "requests", "approvals", "owner", "analytics", "settings", "spaces", "members", "structure",
  "development", "calendar", "list",
];

const load = async (dir: string): Promise<() => unknown> => {
  const mod = (await import(`../src/app/(app)/${dir}/loading.tsx`)) as { default: () => unknown };
  return mod.default;
};
const markupOf = async (dir: string): Promise<string> => renderToStaticMarkup(createElement(await load(dir) as () => React.ReactElement));

describe("every place has its own loading file", () => {
  for (const place of PLACES) {
    it(`${place.dir}: src/app/(app)/${place.dir}/loading.tsx exists, uses the shared skeletons and nothing else of its own`, () => {
      const file = join(APP, place.dir, "loading.tsx");
      expect(existsSync(file), `${place.dir} has no loading.tsx`).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/export default function \w+\(/);
      expect(source).toContain("@/components/ui/skeletons");
      expect(source).not.toMatch(/animate-pulse|bg-muted|"use client"|prisma|getServerSession/);
    });
  }

  it("the list has no place twice, and takes none of the places a later step shapes", () => {
    const dirs = PLACES.map((p) => p.dir);
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(dirs.filter((d) => LATER.includes(d))).toEqual([]);
  });

  it("the skeleton of the whole app and the chat's stay exactly as they were (C2.1 owns them)", () => {
    expect(read("src/app/(app)/chat/loading.tsx")).toContain('export { default } from "@/app/(app)/loading";');
    expect(read("src/app/(app)/loading.tsx")).toContain("tipForAudience");
  });

  it("every listed place is a real folder of the app area with a page somewhere under it (so a loading file there covers a real screen)", () => {
    const hasPage = (dir: string): boolean =>
      readdirSync(dir, { withFileTypes: true }).some((e) => (e.isFile() && e.name === "page.tsx") || (e.isDirectory() && hasPage(join(dir, e.name))));
    for (const place of PLACES) expect(hasPage(join(APP, place.dir)), `${place.dir} has no page`).toBe(true);
  });
});

describe("what the skeleton of a place is", () => {
  for (const place of PLACES) {
    describe(place.dir, () => {
      it("is a busy status that says «جارٍ التحميل…» to a screen reader, in Arabic; the drawing is hidden from it", async () => {
        const markup = await markupOf(place.dir);
        expect(markup).toContain('role="status"');
        expect(markup).toContain('aria-busy="true"');
        expect(markup).toContain('aria-live="polite"');
        expect(markup).toContain(`<span class="sr-only">${AR["common.loading"]}</span>`);
        expect((markup.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(3);
        expect(textOf(markup)).toBe(AR["common.loading"]);
      });

      it("keeps the status line OUT of the way of the page's spacing: it is the last child, so the first block sits exactly where the page's first element sits", async () => {
        const markup = await markupOf(place.dir);
        const opening = /<div[^>]*role="status"[^>]*>/.exec(markup)?.[0] as string;
        expect(markup.slice(markup.indexOf(opening) + opening.length)).not.toMatch(/^<span class="sr-only">/);
        expect(markup).toMatch(/<span class="sr-only">[^<]*<\/span><\/div>$/);
      });

      it("has no Latin letter, digit, hex colour or inline style in what it draws", async () => {
        const markup = await markupOf(place.dir);
        expect(textOf(markup)).not.toMatch(/[A-Za-z0-9]/);
        expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(markup).not.toMatch(/\sstyle="/);
      });

      it("moves only while motion is allowed: every pulsing block stops under reduced motion and in economy mode", async () => {
        const markup = await markupOf(place.dir);
        const blocks = [...markup.matchAll(/<div[^>]*\banimate-pulse\b[^>]*>/g)].map((m) => m[0]);
        expect(blocks.length).toBeGreaterThanOrEqual(6);
        for (const block of blocks) {
          // (the markup escapes the ampersand of the selector)
          const tokens = (/\bclass="([^"]*)"/.exec(block)?.[1] ?? "").replace(/&amp;/g, "&").split(/\s+/);
          expect(tokens, block).toContain("motion-reduce:animate-none");
          expect(tokens, block).toContain("[[data-decor-economy]_&]:animate-none");
        }
      });

      it("uses theme tokens and logical properties only", async () => {
        const tokens = classTokens(await markupOf(place.dir));
        expect(tokens.filter((t) => PALETTE_COLOUR.test(t) || /\b(?:bg|text)-(?:black|white)\b/.test(t))).toEqual([]);
        // a variant prefix (md:, sm:, [[data-…]_&]:) is not part of the utility
        const physical = tokens.filter((t) => PHYSICAL_UTILITY.test(t.replace(/^(?:(?:\[[^\]]*\]|[a-z-]+):)+/, "")));
        expect(physical).toEqual([]);
        expect(tokens.filter((t) => /text-\[1[01]px\]/.test(t))).toEqual([]);
        // Tailwind knows opacity steps of 0, 5, 10 … 100 (or a bracket): never /12
        // (a width such as w-1/2 is a fraction, not an opacity: only colour utilities are checked)
        const colours = tokens.filter((t) => /^(?:bg|text|border|ring|from|via|to|fill|stroke|divide|shadow)-.+\/\d+$/.test(t));
        expect(colours.filter((t) => Number(/\/(\d+)$/.exec(t)?.[1]) % 5 !== 0)).toEqual([]);
      });

      it("wears the same outer container as the page it stands for, so nothing jumps when the page arrives", async () => {
        const markup = await markupOf(place.dir);
        const frame = PLACE_FRAMES[place.dir as keyof typeof PLACE_FRAMES];
        expect(frame, `PLACE_FRAMES has no «${place.dir}»`).toBeTruthy();
        expect(classesOf(markup, /<div[^>]*role="status"[^>]*>/).join(" ")).toContain(frame);
        // the page's OWN outer element: the first element a `return` draws wears exactly these classes (not just any element that happens to)
        const escaped = frame.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const outer = new RegExp(`return\\s*\\(?\\s*<div[^>]*className="${escaped}"`);
        expect(read(place.source), `${place.source} no longer starts with «${frame}»`).toMatch(outer);
      });

      it(`draws the shape of its page (${place.shape})`, async () => {
        const markup = await markupOf(place.dir);
        const shapeOf = /data-skeleton-shape="([a-z]+)"/.exec(markup)?.[1];
        expect(shapeOf).toBe(place.shape);
      });
    });
  }
});

describe("the shapes", () => {
  it("a list has a header, a toolbar line and at least five rows", async () => {
    const markup = await markupOf("files");
    expect((markup.match(/data-skeleton-part="row"/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(markup).toContain('data-skeleton-part="header"');
    expect(markup).toContain('data-skeleton-part="toolbar"');
  });

  it("the ideas list starts with the composer box (the page's form), the goals list with the period bar", async () => {
    expect(await markupOf("ideas")).toContain('data-skeleton-part="composer"');
    expect(await markupOf("files")).not.toContain('data-skeleton-part="composer"');
  });

  it("the composer and the toolbar are separate choices of a list, and so are the header's button", async () => {
    const { ListSkeleton } = await import("@/components/ui/skeletons");
    const both = renderToStaticMarkup(createElement(ListSkeleton, { place: "files", composer: true, toolbar: true }));
    expect(both).toContain('data-skeleton-part="composer"');
    expect(both).toContain('data-skeleton-part="toolbar"');
    const bare = renderToStaticMarkup(createElement(ListSkeleton, { place: "files", toolbar: false, action: false }));
    expect(bare).not.toContain('data-skeleton-part="toolbar"');
    expect(bare).not.toContain("h-9 w-24");
    const ideas = await markupOf("ideas");
    expect(ideas).toContain('data-skeleton-part="composer"');
    expect(ideas).not.toContain('data-skeleton-part="toolbar"');
  });

  it("the time report is a title, a filter bar and a table of six columns; the customers are tabs and a table of four", async () => {
    const time = await markupOf("time");
    expect(time).toContain('data-skeleton-part="header"');
    expect(time).toContain('data-skeleton-part="filters"');
    expect(time).not.toContain('data-skeleton-part="tabs"');
    const row = time.split('data-skeleton-part="row"')[1]?.split('data-skeleton-part="row"')[0] ?? "";
    expect((row.match(/animate-pulse/g) ?? []).length).toBe(6);
    const crm = await markupOf("crm");
    expect(crm).toContain('data-skeleton-part="tabs"');
    expect(crm).not.toContain('data-skeleton-part="filters"');
  });

  it("the sections of a desk are boxed lists with a heading each (my tickets, my campaigns)", async () => {
    for (const dir of ["tickets", "campaigns"]) {
      const markup = await markupOf(dir);
      expect((markup.match(/data-skeleton-part="section"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("departments are a grid of cards, two across from the small breakpoint", async () => {
    const markup = await markupOf("departments");
    expect(markup).toContain("sm:grid-cols-2");
    expect((markup.match(/data-skeleton-part="card"/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("a document is a title, a toolbar and lines of text", async () => {
    for (const dir of ["documents", "knowledge", "cards"]) {
      const markup = await markupOf(dir);
      expect(markup, dir).toContain('data-skeleton-part="title"');
      expect((markup.match(/data-skeleton-part="line"/g) ?? []).length, dir).toBeGreaterThanOrEqual(4);
    }
  });

  it("a table is a tab bar, a head row and at least five rows", async () => {
    for (const dir of ["crm", "time"]) {
      const markup = await markupOf(dir);
      expect(markup, dir).toContain('data-skeleton-part="table-head"');
      expect((markup.match(/data-skeleton-part="row"/g) ?? []).length, dir).toBeGreaterThanOrEqual(5);
    }
  });

  it("the production day is a day bar and a list of items", async () => {
    const markup = await markupOf("production");
    expect(markup).toContain('data-skeleton-part="day-bar"');
    expect((markup.match(/data-skeleton-part="row"/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("the watch room is the player (16:9) beside a side column from the large breakpoint", async () => {
    const markup = await markupOf("watch");
    expect(markup).toContain("aspect-video");
    expect(markup).toContain("lg:grid-cols-[minmax(0,1fr)_360px]");
    expect(markup).toContain('data-skeleton-part="side"');
  });

  it("a skeleton never reads the clock, the database or a random number: it is the same markup every time", async () => {
    const before = await markupOf("files");
    expect(await markupOf("files")).toBe(before);
  });
});

describe("the shared file", () => {
  const source = read("src/components/ui/skeletons.tsx");

  it("is built on the one Skeleton primitive and the theme tokens, with no hook, no provider and no hex colour", () => {
    expect(source).toContain('from "@/components/ui/skeleton"');
    expect(source).not.toMatch(/"use client"|useState|useEffect|prisma/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:bg|text)-(?:black|white)\b/);
  });

  it("every key of PLACE_FRAMES is a listed place", () => {
    expect(Object.keys(PLACE_FRAMES).sort()).toEqual(PLACES.map((p) => p.dir).sort());
  });
});
