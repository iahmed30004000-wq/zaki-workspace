import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { foldersOf } from "@/lib/chat/list-folders";
import { rowMarks } from "@/lib/chat/row-preview";
import chatUi from "@/lib/i18n/ar.chat-ui.json";

/**
 * C2 — the guard of the new chat screen's folders (`src/components/chat/v2/**`, and the pure files behind it):
 *
 *  - NO hex colour and no raw Tailwind palette class (`text-red-500`, `bg-white`, `text-white`, `bg-black/40` ...): colours are theme tokens only
 *    (`bg-accent`, `text-fg-muted`, `border-border` ...), so every theme restyles the screen;
 *  - logical sides only (start / end, ms / me, ps / pe): no `ml-`, `pr-`, `left-`, `text-right`, `rounded-l` ... — the screen is right-to-left;
 *  - no `text-[10px]` / `text-[11px]` (12 px is the floor), and only Tailwind opacity steps that exist (0, 5, 10 ... 100, or in brackets);
 *  - every word on screen comes from `ar.chat-ui.json` (or another fragment) through `ct()`: no Arabic literal in the code.
 */
const ROOT = path.resolve(__dirname, "..");
const V2_DIR = "src/components/chat/v2";
const PURE_FILES = ["src/lib/chat/list-folders.ts", "src/lib/chat/row-preview.ts"];
const PURE_DIRS = ["src/lib/chat/v2"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, "/");
const v2Files = walk(path.join(ROOT, V2_DIR)).map(rel);
const allFiles = [...v2Files, ...PURE_FILES, ...PURE_DIRS.flatMap((d) => walk(path.join(ROOT, d)).map(rel))];
const text = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{8}\b/;
const RAW_COLOUR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[\d.]/;
const PALETTE_CLASS =
  /(?<![\w-])(?:text|bg|border|ring|from|to|via|fill|stroke|divide|outline|decoration|accent|shadow|placeholder|caret)-(?:(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}|black|white)(?![\w-])/;
const PHYSICAL =
  /(?<![\w-])(?:-?(?:ml|mr|pl|pr|left|right|scroll-ml|scroll-mr)-[\w./[\]-]+|(?:border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)(?:-[\w./[\]-]+)?|text-left|text-right|float-left|float-right)(?![\w-])/;
const TINY_TEXT = /text-\[(?:9|10|11)(?:\.\d+)?px\]/;
const BAD_OPACITY = /(?<![\w-])(?:text|bg|border|ring|from|to|via|fill|stroke|divide|outline|shadow|accent)-[a-z][\w-]*\/(\d+)(?![\w.\]])/g;
const STEPS = new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]);

/** The class strings of a file: every string literal and template part (a class name only ever lives in one). */
function stringsOf(file: string): { text: string; line: number }[] {
  const sf = ts.createSourceFile(file, text(file), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { text: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      out.push({ text: node.text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("the new chat screen's guard", () => {
  it("scans the folder (so the checks below are not vacuous)", () => {
    expect(v2Files.length).toBeGreaterThanOrEqual(14);
    for (const expected of ["src/components/chat/v2/shell/chat-shell.tsx", "src/components/chat/v2/list/chat-list-column.tsx", "src/components/chat/v2/list/chat-row.tsx", "src/components/chat/v2/forum/forum-view.tsx", "src/components/chat/v2/empty-state.tsx", "src/components/chat/v2/row-menu.tsx", "src/components/chat/v2/use-list-width.ts"]) {
      expect(v2Files).toContain(expected);
    }
  });

  it("no hex colour, rgb()/hsl() literal or raw palette class anywhere in it", () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      // the source as written: comments may talk about colours, code may not
      for (const s of stringsOf(file)) {
        if (HEX.test(s.text) || RAW_COLOUR_FN.test(s.text) || PALETTE_CLASS.test(s.text)) offenders.push(`${file}:${s.line}  ${s.text.trim().slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the guard itself catches what it is for (a self-test on small samples)", () => {
    expect(HEX.test("bg-[#fff]")).toBe(true);
    expect(HEX.test("color: #1a2b3c")).toBe(true);
    expect(PALETTE_CLASS.test("text-red-500")).toBe(true);
    expect(PALETTE_CLASS.test("bg-white")).toBe(true);
    expect(PALETTE_CLASS.test("text-white")).toBe(true);
    expect(PALETTE_CLASS.test("border-black")).toBe(true);
    expect(PALETTE_CLASS.test("bg-accent text-accent-fg bg-surface-1 text-fg-muted border-border/60")).toBe(false);
    expect(PHYSICAL.test("ml-2")).toBe(true);
    expect(PHYSICAL.test("pr-3")).toBe(true);
    expect(PHYSICAL.test("left-0")).toBe(true);
    expect(PHYSICAL.test("text-right")).toBe(true);
    expect(PHYSICAL.test("rounded-l-lg")).toBe(true);
    expect(PHYSICAL.test("ms-2 pe-3 start-0 end-4 text-start rounded-s-lg border-e")).toBe(false);
    expect(PHYSICAL.test("flex-1 min-w-0 overflow-clip")).toBe(false);
    expect(TINY_TEXT.test("text-[10px]")).toBe(true);
  });

  it("logical sides only: start / end, never left / right", () => {
    const offenders: string[] = [];
    for (const file of v2Files) {
      for (const s of stringsOf(file)) {
        for (const token of s.text.split(/\s+/)) {
          // a class token (it has no spaces, quotes or Arabic) that names a physical side
          if (/^[\w:./[\]-]+$/.test(token) && PHYSICAL.test(token.replace(/^[\w-]+:/, "")) && !/^(?:left|right)$/.test(token)) offenders.push(`${file}:${s.line}  ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no font size under 12 px and no opacity step Tailwind does not have", () => {
    const offenders: string[] = [];
    for (const file of v2Files) {
      for (const s of stringsOf(file)) {
        if (TINY_TEXT.test(s.text)) offenders.push(`${file}:${s.line}  tiny text`);
        for (const m of s.text.matchAll(BAD_OPACITY)) if (!STEPS.has(Number(m[1]))) offenders.push(`${file}:${s.line}  ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every word is a key of the dictionary: no Arabic letter in a literal of the code (the Arabic comma that joins names is the one exception)", () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      for (const s of stringsOf(file)) {
        const rest = s.text.replace(/[،؟]/g, "");
        if (/[؀-ۿ]/.test(rest)) offenders.push(`${file}:${s.line}  ${s.text.trim().slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the guard does not rest on the folder alone: nothing in the folder imports a raw colour table or a second rail / drawer", () => {
    for (const file of v2Files) {
      const src = text(file);
      expect(src, file).not.toMatch(/from "@\/components\/shell\/(rail|drawer)"/);
      expect(src, file).not.toMatch(/setQuer(?:y|ies)Data/);
    }
  });
});

describe("the strings of the new chat screen", () => {
  const keys = Object.keys(chatUi as Record<string, string>);
  const sources = walk(path.join(ROOT, "src")).map((f) => ({ file: rel(f), src: text(rel(f)) }));

  it("lives in its own fragment, registered in dict.ts, with no Latin letter and Western digits only", () => {
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) expect(AR[key], key).toBe((chatUi as Record<string, string>)[key]);
    for (const [key, value] of Object.entries(chatUi as Record<string, string>)) {
      expect(value.replace(/{[^{}]+}/g, " "), key).not.toMatch(/[A-Za-z]{2,}/);
      expect(value, key).not.toMatch(/[٠-٩]/);
      expect(value, key).not.toMatch(/ـاً/);
    }
  });

  it("every ct('key') of the folder exists", () => {
    const missing: string[] = [];
    for (const file of allFiles) {
      for (const m of text(file).matchAll(/\bct\(\s*["']([a-z][\w.]*)["']/g)) if (!(m[1]! in AR)) missing.push(`${file}  ${m[1]}`);
      for (const m of text(file).matchAll(/\bctCount\(\s*["']([a-z][\w.]*)["']/g)) {
        for (const form of ["one", "two", "few", "many"]) if (!(`${m[1]}.${form}` in AR)) missing.push(`${file}  ${m[1]}.${form}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the keys built at run time exist too: the folders' labels, the marks' names, the ticks, the empty folders", () => {
    for (const folder of foldersOf({ canOversee: true })) expect(AR[folder.labelKey], folder.labelKey).toBeTruthy();
    const marked = rowMarks({ kind: "TOPIC", restricted: true, topicType: "ANNOUNCEMENTS", closed: true, muted: true } as never);
    expect(marked.length).toBe(4);
    for (const mark of [...marked, ...rowMarks({ kind: "TOPIC", teamId: "t" } as never)]) expect(AR[mark.labelKey], mark.labelKey).toBeTruthy();
    for (const tick of ["sent", "delivered", "read"]) expect(AR[`chatui.row.ticks_${tick}`]).toBeTruthy();
    for (const folder of ["unread", "dm", "spaces", "mentions", "company", "all"]) expect(AR[`chatui.empty.${folder}`], folder).toBeTruthy();
  });

  it("no key is dead: each one is used by the code (literally or through the keys built above)", () => {
    const dynamic = [/^chatui\.folder\./, /^chatui\.row\.ticks_/, /^chatui\.empty\./, /^chatui\.row\.(private|team|announcements|closed|muted)$/, /^chatui\.row\.unread\./, /^chatui\.forum\.topics\./];
    const code = sources.filter((s) => !s.file.endsWith(".json") && !s.file.startsWith("src/lib/i18n/")).map((s) => s.src).join("\n");
    const dead = keys.filter((key) => !code.includes(key) && !dynamic.some((re) => re.test(key)));
    expect(dead).toEqual([]);
  });
});
