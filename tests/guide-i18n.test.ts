import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const I18N = path.join(ROOT, "src/lib/i18n");
const guide = JSON.parse(readFileSync(path.join(I18N, "ar.guide.json"), "utf8")) as Record<string, unknown>;

/** The guide's own source: data modules, components, pages and the service. */
const OWN = [
  "src/lib/guide",
  "src/components/guide",
  "src/app/(app)/guide",
  // the phone's doors to the same guide (M2 N6 batch 5): their refusal is the guide's own sentence
  "src/app/api/guide",
  "src/server/services/first-steps.ts",
];

function walk(target: string, out: string[] = []): string[] {
  const full = path.join(ROOT, target);
  if (statSync(full).isFile()) return [target];
  for (const name of readdirSync(full)) {
    const rel = path.posix.join(target, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const ownFiles = OWN.flatMap((t) => walk(t));

describe("ar.guide.json", () => {
  const entries = Object.entries(guide);

  it("is a flat object of strings, every key starting with guide.", () => {
    expect(entries.length).toBeGreaterThan(80);
    for (const [key, value] of entries) {
      expect(key, key).toMatch(/^guide\.[A-Za-z0-9_.-]+$/);
      expect(typeof value, key).toBe("string");
    }
  });

  it("shares no key with another fragment (a later one would silently win)", () => {
    const others = readdirSync(I18N)
      .filter((f) => /^ar(\.[a-z]+)?\.json$/.test(f) && f !== "ar.guide.json")
      .flatMap((f) => Object.keys(JSON.parse(readFileSync(path.join(I18N, f), "utf8")) as Record<string, string>));
    const taken = new Set(others);
    expect(Object.keys(guide).filter((k) => taken.has(k))).toEqual([]);
  });

  it("every value is Arabic, tidy, and has no English word (the brand names n8n and Google Drive excepted)", () => {
    for (const [key, raw] of entries) {
      const value = raw as string;
      expect(value, key).toMatch(/[؀-ۿ]/);
      expect(value, key).toBe(value.trim());
      expect(value, key).not.toMatch(/ {2,}/);
      expect(value, `${key}: straight quotes read as foreign in Arabic text — use « »`).not.toContain('"');
      const withoutPlaceholders = value.replace(/\{\{?[a-z_]+\}?\}/g, "").replace(/n8n/g, "").replace(/Google Drive/g, "");
      expect(withoutPlaceholders, key).not.toMatch(/[A-Za-z]/);
    }
  });

  it("no value ends in a Latin word or a digit (in right-to-left text the full stop would land on the wrong side)", () => {
    for (const [key, raw] of entries) expect(raw as string, key).not.toMatch(/[A-Za-z0-9]\s*[.،:؟!)»]*\s*$/);
  });

  it("uses only the placeholders the code fills: {n}, {done}, {total}, {title}, and driver's {{current}} {{total}}", () => {
    for (const [key, raw] of entries) {
      for (const m of (raw as string).matchAll(/\{\{?([a-z_]+)\}?\}/g)) {
        expect(["n", "done", "total", "title", "current"], `${key}: {${m[1]}}`).toContain(m[1]);
      }
    }
  });

  it("gives the headings the owner asked for, word for word", () => {
    expect(guide["guide.help.what"]).toBe("شو هاي الصفحة؟");
    expect(guide["guide.help.next"]).toBe("الخطوة الجاية");
    expect(guide["guide.help.tour"]).toBe("فرجيني");
    expect(guide["guide.title"]).toBe("الدليل");
  });

  it("has no dead string: every key is used by the guide's own code, and every key the code names exists", () => {
    const named = new Map<string, string>();
    for (const file of ownFiles) {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      for (const m of text.matchAll(/["'`](guide\.[A-Za-z0-9_.-]+)["'`]/g)) {
        if (!named.has(m[1] as string)) named.set(m[1] as string, file);
      }
    }
    const missing = [...named.entries()].filter(([key]) => !(key in guide)).map(([key, file]) => `${key}  (${file})`);
    expect(missing).toEqual([]);
    const dead = Object.keys(guide).filter((key) => !named.has(key));
    expect(dead, "delete these strings or use them").toEqual([]);
  });
});
