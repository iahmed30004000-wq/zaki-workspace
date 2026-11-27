import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANDROID_STRINGS, collectWords, kotlinLiteral, renderAndroidStrings } from "@/lib/android-strings";
import { CAPABILITIES, SECTIONS } from "@/server/policy/capabilities";
import { isOffered, PERMISSION_AREAS, SECTION_ACTIONS } from "@/lib/members-ui";
import { ReviewLight, ReviewStatus } from "@prisma/client";
import { ORDER_STATUSES } from "@/lib/manufacturing/production-view";
import { COUNT_STATUSES, CURRENCIES, MOVEMENT_KINDS } from "@/lib/manufacturing/shared";
import { UNPLACED_KINDS } from "@/server/services/move-to-space";
import { SPACE_LAYOUTS } from "@/lib/cards/shared";
import { WORK_STAGES } from "@/lib/work/stage";

const ROOT = path.resolve(__dirname, "..");

/**
 * The phone's copies of the site's words are generated from the dictionary (scripts/build-android-strings.mjs): a word changed on
 * the site and not regenerated fails here, and so does a key the app's code names that the site does not have.
 */
describe("the Android app's generated words", () => {
  for (const file of ANDROID_STRINGS) {
    const words = collectWords(file, (source) => JSON.parse(readFileSync(path.join(ROOT, "src/lib/i18n", source), "utf8")) as Record<string, string>);

    it(`${file.target} is exactly what the script writes from ${file.source}`, () => {
      expect(existsSync(path.join(ROOT, file.target)), "run: npx tsx scripts/build-android-strings.mjs").toBe(true);
      expect(readFileSync(path.join(ROOT, file.target), "utf8")).toBe(renderAndroidStrings(file, words));
    });

    it(`every key the app's ${file.name} reads exists in ${file.source}`, () => {
      const dir = path.join(ROOT, path.dirname(file.target));
      const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : n.endsWith(".kt") ? [path.join(d, n)] : []));
      const missing: string[] = [];
      for (const f of walk(dir)) {
        if (f === path.join(ROOT, file.target)) continue;
        const text = readFileSync(f, "utf8");
        for (const m of text.matchAll(new RegExp(`${file.name}\\.s\\("([^"]+)"`, "g"))) if (!(m[1]! in words)) missing.push(`${m[1]}  (${path.basename(f)})`);
        for (const m of text.matchAll(/\bw\("([^"]+)"/g)) if (!(m[1]! in words)) missing.push(`${m[1]}  (${path.basename(f)})`);
      }
      expect(missing).toEqual([]);
    });
  }

  it("the accounts screen names every permission, section and area in the site's words (never a raw key)", () => {
    const file = ANDROID_STRINGS.find((f) => f.name === "AccountWords")!;
    const words = collectWords(file, (source) => JSON.parse(readFileSync(path.join(ROOT, "src/lib/i18n", source), "utf8")) as Record<string, string>);
    const missing = [
      ...CAPABILITIES.filter(isOffered).map((c) => `members.cap.${c}.title`),
      ...SECTIONS.map((s) => `members.section.${s.id}`),
      ...PERMISSION_AREAS.map((a) => `perm.area.${a.id}`),
      ...SECTION_ACTIONS.map((a) => `members.action.${a}`),
    ].filter((k) => !(k in words));
    expect(missing).toEqual([]);
  });

  it("every value the app turns into a word through a built key has its word in the app's copy (a missing one would show the raw value)", () => {
    const wordsOf = (name: string) => {
      const file = ANDROID_STRINGS.find((f) => f.name === name)!;
      return collectWords(file, (source) => JSON.parse(readFileSync(path.join(ROOT, "src/lib/i18n", source), "utf8")) as Record<string, string>);
    };
    const families: [string, string, readonly string[]][] = [
      ["DevWords", "teamdev.review.status.", Object.values(ReviewStatus)],
      ["DevWords", "teamdev.light.", Object.values(ReviewLight)],
      ["MfgWords", "mfg.order_status.", ORDER_STATUSES],
      ["MfgWords", "mfg.count_status.", COUNT_STATUSES],
      ["MfgWords", "mfg.kind.", MOVEMENT_KINDS],
      ["MfgWords", "mfg.cur.", Object.keys(CURRENCIES)],
      ["SpaceWords", "spaces.unplaced.kind.", UNPLACED_KINDS],
      ["SpaceWords", "cards.space_type.", SPACE_LAYOUTS],
      ["SpaceWords", "enum.WorkStage.", WORK_STAGES],
    ];
    const missing = families.flatMap(([name, prefix, values]) => {
      const words = wordsOf(name);
      return values.map((v) => prefix + v).filter((k) => !(k in words)).map((k) => `${k} (${name})`);
    });
    expect(missing).toEqual([]);
  });

  it("a named extra key is carried from its own fragment, and a missing one is refused", () => {
    const file = { source: "a.json", target: "x.kt", pkg: "p", name: "W", keep: (k: string) => k.startsWith("a."), extra: [{ source: "b.json", keys: ["b.one"] }] };
    const read = (s: string): Record<string, string> => (s === "a.json" ? { "a.x": "1", "z.y": "2" } : { "b.one": "3", "b.two": "4" });
    expect(collectWords(file, read)).toEqual({ "a.x": "1", "b.one": "3" });
    expect(() => collectWords({ ...file, extra: [{ source: "b.json", keys: ["b.gone"] }] }, read)).toThrow(/b.gone/);
  });

  it("a value is a safe Kotlin literal: quotes, backslashes, dollars and line breaks escaped", () => {
    expect(kotlinLiteral('a "b" \\ $x\nc')).toBe('"a \\"b\\" \\\\ \\$x\\nc"');
  });
});
