import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// The pages and components are TSX; under vitest their JSX compiles to React.createElement (global React).
(globalThis as { React?: typeof React }).React = React;

// A page calls redirect(); a client row calls useRouter(). Neither needs a running Next app here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import { AR } from "@/lib/i18n/dict";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { CrmView, CustomersTab, OpportunitiesTab } from "@/components/crm-view";
import { ideaError } from "@/components/ideas-view";
import { ApiError } from "@/lib/api-client";
import { Logo } from "@/components/logo";
import {
  arabicPlural,
  fmtAgo,
  fmtDMY,
  fmtDateTime,
  fmtLongDate,
  fmtNumber,
  fmtRelative,
  fmtShort,
  fmtSize,
  fmtTime,
  formatDate,
  monthName,
  weekdayLong,
  weekdayName,
} from "@/lib/format";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const ARABIC_LETTER = /[؀-ۿ]/;
const ARABIC_INDIC_DIGIT = /[٠-٩]/;

// ---------------------------------------------------------------------------------------------
// 1. The dictionary
// ---------------------------------------------------------------------------------------------

/** Every ar.json and ar.<feature>.json fragment, as the app merges them. */
function dictionaryFiles(): { file: string; data: Record<string, string> }[] {
  const dir = path.join(SRC, "lib", "i18n");
  return readdirSync(dir)
    // hyphenated fragments too (ar.chat-errors.json, ar.chat-files.json …): the old [a-z]+ skipped every one
    .filter((f) => /^ar(\.[a-z-]+)?\.json$/.test(f))
    .map((file) => ({ file, data: JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Record<string, string> }));
}

/**
 * The only Latin text a translated string may carry. Each entry is a name or a literal the reader has
 * to match with something outside this app (a bot to search for in Telegram, a setting name in the
 * server's environment, a JSON field a sender must write). Everything else must be Arabic.
 */
const LATIN_IN_DICTIONARY = [
  "Zaki Workspace", // the product name on screen (the owner's decision)
  "Google Drive", // provider names, as the providers spell them
  "Google Cloud",
  "Google",
  "BotFather", // the exact bot to look for in Telegram
  "/newbot", // the command to send it
  "webhook", // the word n8n and Telegram themselves use for the receiving address
  "https://", // what an address must start with
  "x-zaki-token", // the legacy header name a sender may still use
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "ENCRYPTION_KEY", // the server setting the owner keeps safe: the backup's encryption key
  "Coolify", // the panel where that setting lives (provider name)
  "Node", // the program the restore script runs with
  "/api/integrations/google/callback", // the address to give Google's console
  "drive.file", // the access scope to ask for
  "workspaceId", // JSON fields an n8n sender must write
  "projectId",
  "boardId",
  "title",
];

function latinLeft(value: string, allowed: readonly string[]): string[] {
  let rest = value.replace(/\{[^{}]+\}/g, " "); // {placeholders}
  for (const phrase of [...allowed].sort((a, b) => b.length - a.length)) rest = rest.split(phrase).join(" ");
  return rest.match(/[A-Za-z]{2,}/g) ?? [];
}

describe("the Arabic dictionary", () => {
  const files = dictionaryFiles();

  it("finds the dictionary (so the checks below are not vacuous)", () => {
    expect(files.map((f) => f.file)).toEqual(expect.arrayContaining(["ar.json", "ar.enums.json"]));
    expect(files.reduce((n, f) => n + Object.keys(f.data).length, 0)).toBeGreaterThan(800);
  });

  it("no translated string carries a Latin word except the short, justified list", () => {
    const offenders: string[] = [];
    for (const { file, data } of files) {
      for (const [key, value] of Object.entries(data)) {
        const left = latinLeft(value, LATIN_IN_DICTIONARY);
        if (left.length) offenders.push(`${file} ${key}: ${left.join(" ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the allow-list is short and every entry is really used (a stale entry would hide new English)", () => {
    const all = files.flatMap((f) => Object.values(f.data)).join("\n");
    expect(LATIN_IN_DICTIONARY.length).toBeLessThan(25);
    for (const phrase of LATIN_IN_DICTIONARY) expect(all, phrase).toContain(phrase);
  });

  it("digits are the Western 0-9 in every dictionary file (the dates and numbers the code writes are too)", () => {
    for (const { file, data } of files) {
      for (const [key, value] of Object.entries(data)) expect(value, `${file} ${key}`).not.toMatch(ARABIC_INDIC_DIGIT);
    }
  });

  it("the wrong or garbled wording that was corrected stays corrected", () => {
    const wrong: [string, string][] = [
      ["للمالية", "«للمالية» where it means «للمالك» (the owner)"],
      ["القمة", "a task column is «العمود», not «القمة» (summit)"],
      ["عداك قلّة", "nonsense in the idea placeholder"],
      ["ولاية", "«ولاية» (a state) in place of «قسم» or «مكان»"],
      ["اسبوع", "«أسبوع» is written with a hamza"],
      ["التايم لاين", "Arabized English; the page is «الجدول الزمني»"],
      ["بمستحِق", "garbled «due»"],
      ["المرجّ إليها", "garbled «the message you reply to»"],
      ["ميراث مؤسسي", "«موروث من المؤسسة»"],
      ["إثنين", "«اثنين» is written without a hamza"],
      ["سلماه", "garbled «sent him»"],
      ["أدوّره", "the instruction to the reader must be in the imperative"],
      ["اقرأ المفاتيح من البيئة", "garbled hint in the Google subtitle"],
      ["تضيّف", "«تضيّع» (lose)"],
      ["مُعيين", "garbled «assigned»"],
      ["صفّر كلماتهم", "«صفّر كلمات مرورهم»"],
      ["منشأة في", "«منشأة» is a facility; the date is «أُنشئت في»"],
      ["نافذة المشروع", "«window» translated literally; it is the project's duration"],
      ["مشاريع حية", "«live projects» translated literally; they are active projects"],
      ["، اللغة", "there is no language to choose: Arabic is the only one"],
    ];
    const offenders: string[] = [];
    for (const { file, data } of files) {
      for (const [key, value] of Object.entries(data)) {
        for (const [bad, why] of wrong) if (value.includes(bad)) offenders.push(`${file} ${key} contains «${bad}»: ${why}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(AR["dept.admin_only"]).toContain("للمالك");
    expect(AR["dept.workspace"]).toBe("المساحة");
    expect(AR["task.empty"]).toContain("العمود");
    expect(AR["goal.weekly"]).toBe("أسبوعي");
    expect(AR["timeline.title"]).toBe("الجدول الزمني");
  });

  it("every refusal the server throws has an Arabic sentence (the screens show t(key), never the key)", () => {
    const missing = new Map<string, string>();
    const THROWN = /new (?:ForbiddenError|NotFoundError|ValidationError|UnauthorizedError)\(\s*["'`]([a-z][\w.]*)(?::[^"'`]*)?["'`]/g;
    for (const file of walkTs(SRC).filter((f) => !/[\\/](lib[\\/]i18n)[\\/]/.test(f))) {
      for (const m of readFileSync(file, "utf8").matchAll(THROWN)) {
        const key = m[1] as string;
        // the ideas screen turns idea.<reason> into ideas.<reason> itself (ideaError)
        if (key.startsWith("idea.")) continue;
        // a protocol code, not a sentence: every screen answers it from the HTTP status (members.err_session, ...)
        if (key === "auth.required") continue;
        if (!(key in AR) && !missing.has(key)) missing.set(key, rel(file));
      }
    }
    expect([...missing.entries()].map(([key, file]) => `${key} (${file})`)).toEqual([]);
  });

  it("a string that is just a placeholder or a bare key is never the translation", () => {
    for (const { file, data } of files) {
      for (const [key, value] of Object.entries(data)) {
        expect(value, `${file} ${key}`).not.toBe(key);
        if (!/^(app\.name|enum\.none)$/.test(key)) expect(value.trim().length, `${file} ${key}`).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Dates and numbers
// ---------------------------------------------------------------------------------------------

/** Local-time constructor: the checks give the same answer in every time zone. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const NOW = at(2026, 10, 22, 15, 30); // a Thursday

describe("dates and numbers speak Arabic with Western digits", () => {
  it("has twelve month names and seven weekday names, all Arabic and all different", () => {
    const months = Array.from({ length: 12 }, (_, i) => monthName(i));
    expect(new Set(months).size).toBe(12);
    for (const m of months) expect(m).toMatch(/^[؀-ۿ ]+$/);
    expect(monthName(9)).toBe("تشرين الأول");
    expect(monthName(0)).toBe("كانون الثاني");
    expect(monthName(12)).toBe(monthName(0)); // wraps
    const days = Array.from({ length: 7 }, (_, i) => weekdayName(i));
    expect(new Set(days).size).toBe(7);
    for (const d of days) expect(d).toMatch(/^[؀-ۿ ]+$/);
    expect(weekdayLong(4)).toBe("الخميس");
    expect(weekdayLong(1)).toBe("الاثنين");
  });

  it("writes day, month and year (and the time) in Arabic", () => {
    expect(fmtDMY(NOW)).toBe("22 تشرين الأول 2026");
    expect(fmtShort(NOW)).toBe("22 تشرين الأول");
    expect(fmtTime(NOW)).toBe("15:30");
    expect(fmtTime(at(2026, 1, 5, 7, 5))).toBe("07:05");
    expect(fmtDateTime(NOW)).toBe("22 تشرين الأول 2026، 15:30");
    expect(fmtLongDate(NOW)).toBe("الخميس 22 تشرين الأول 2026");
  });

  it("ignores a locale that is not Arabic (the old English and French names are gone) and survives bad input", () => {
    expect(fmtDMY(NOW, "en")).toBe(fmtDMY(NOW));
    expect(fmtShort(NOW, "fr")).toBe(fmtShort(NOW));
    expect(formatDate(NOW, "en")).toBe(fmtShort(NOW));
    expect(monthName(2, "fr")).toBe(monthName(2));
    expect(fmtDMY(null)).toBe("");
    expect(fmtDMY("not a date")).toBe("");
    expect(fmtTime(undefined)).toBe("");
    expect(fmtLongDate("")).toBe("");
    expect(formatDate(null, "ar")).toBe("");
  });

  it("says today, yesterday and tomorrow in the owner's words", () => {
    expect(fmtRelative(at(2026, 10, 22, 1), NOW)).toBe("اليوم");
    expect(fmtRelative(at(2026, 10, 22, 23, 59), NOW)).toBe("اليوم");
    expect(fmtRelative(at(2026, 10, 21, 23, 59), NOW)).toBe("أمس");
    expect(fmtRelative(at(2026, 10, 23, 0, 1), NOW)).toBe("بكرا");
    // a moment at 00:01 is still "today" for somebody at 00:00 the same day
    expect(fmtRelative(at(2026, 10, 22, 23, 59), at(2026, 10, 22, 0, 1))).toBe("اليوم");
  });

  it("counts days with the right Arabic number form: two, three to ten, eleven and more", () => {
    expect(fmtRelative(at(2026, 10, 20), NOW)).toBe("قبل يومين");
    expect(fmtRelative(at(2026, 10, 24), NOW)).toBe("بعد يومين");
    expect(fmtRelative(at(2026, 10, 19), NOW)).toBe("قبل 3 أيام");
    expect(fmtRelative(at(2026, 10, 25), NOW)).toBe("بعد 3 أيام");
    expect(fmtRelative(at(2026, 10, 12), NOW)).toBe("قبل 10 أيام");
    expect(fmtRelative(at(2026, 11, 1), NOW)).toBe("بعد 10 أيام");
    expect(fmtRelative(at(2026, 10, 11), NOW)).toBe("قبل 11 يومًا");
    expect(fmtRelative(at(2026, 11, 2), NOW)).toBe("بعد 11 يومًا");
    expect(fmtRelative(at(2026, 9, 25), NOW)).toBe("قبل 27 يومًا");
  });

  it("falls back to the date itself when it is a month or more away (with the year only when it differs)", () => {
    expect(fmtRelative(at(2026, 12, 25), NOW)).toBe("25 كانون الأول");
    expect(fmtRelative(at(2027, 1, 5), NOW)).toBe("5 كانون الثاني 2027");
    expect(fmtRelative(at(2026, 8, 1), NOW)).toBe("1 آب");
  });

  it("takes ISO strings and timestamps too, and is empty for nothing", () => {
    expect(fmtRelative("2026-10-23T12:00:00", NOW)).toBe("بكرا");
    expect(fmtRelative(at(2026, 10, 21).getTime(), NOW)).toBe("أمس");
    expect(fmtRelative(null, NOW)).toBe("");
    expect(fmtRelative(undefined, NOW)).toBe("");
    expect(fmtRelative("garbage", NOW)).toBe("");
  });

  it("counts a moment from now: minutes, hours, days (the same phrases as the team screen)", () => {
    const ago = (ms: number) => fmtAgo(new Date(NOW.getTime() - ms), NOW);
    expect(ago(20_000)).toBe(AR["members.ago.now"]);
    expect(ago(5 * 60_000)).toBe("قبل 5 دقائق");
    expect(ago(60_000 * 2)).toBe("قبل دقيقتين");
    expect(ago(3 * 3600_000)).toBe("قبل 3 ساعات");
    expect(ago(2 * 86_400_000)).toBe("قبل يومين");
    expect(ago(31 * 86_400_000)).toBe("قبل شهر");
    expect(fmtAgo(null, NOW)).toBe("");
    expect(fmtAgo(new Date(NOW.getTime() + 5 * 60_000), NOW)).toBe(AR["members.ago.now"]); // a clock that runs ahead
  });

  it("knows which Arabic number form a count needs", () => {
    expect([1, 2, 3, 10, 11, 99, 100, 102, 103, 111].map(arabicPlural)).toEqual([
      "one",
      "two",
      "few",
      "few",
      "many",
      "many",
      "many",
      "many", // 102: the written numeral takes the singular noun, as 11 and 99 do
      "few",
      "many",
    ]);
  });

  it("writes file sizes in Arabic units and groups numbers with a plain comma", () => {
    expect(fmtSize(0)).toBe("0 بايت");
    expect(fmtSize(512)).toBe("512 بايت");
    expect(fmtSize(1024 * 340)).toBe("340 كيلوبايت");
    expect(fmtSize(1024 * 1024 * 1.5)).toBe("1.5 ميغابايت");
    expect(fmtSize(-5)).toBe("");
    expect(fmtSize(Number.NaN)).toBe("");
    expect(fmtNumber(1234567)).toBe("1,234,567");
    expect(fmtNumber(42)).toBe("42");
    expect(fmtNumber(null)).toBe("");
  });

  it("never writes a Latin letter or an Arabic-Indic digit, whatever it is given", () => {
    const outputs = [
      fmtDMY(NOW), fmtShort(NOW), fmtTime(NOW), fmtDateTime(NOW), fmtLongDate(NOW), formatDate(NOW, "en"),
      fmtRelative(at(2026, 10, 19), NOW), fmtRelative(at(2026, 10, 25), NOW), fmtRelative(at(2027, 1, 5), NOW),
      fmtAgo(new Date(NOW.getTime() - 7 * 3600_000), NOW), fmtSize(5_000_000), fmtNumber(1234),
      ...Array.from({ length: 12 }, (_, i) => monthName(i)),
      ...Array.from({ length: 7 }, (_, i) => weekdayName(i) + weekdayLong(i)),
    ];
    for (const out of outputs) {
      expect(out, out).not.toMatch(/[A-Za-z]/);
      expect(out, out).not.toMatch(ARABIC_INDIC_DIGIT);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3. The screens: no English in the source that reaches them
// ---------------------------------------------------------------------------------------------

/**
 * Files other Phase 2 agents (or Phase 1) own and are still rewriting while this suite is written.
 * They answer to the same rules; the coordinator removes this list once they have landed.
 */
const OTHER_OWNERS_FILES = new Set<string>([]);
const OTHER_OWNERS_DIRS: string[] = [];

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkTsx(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, "/");
const SCREEN_FILES = walkTsx(SRC).filter((f) => {
  const r = rel(f);
  return !OTHER_OWNERS_FILES.has(r) && !OTHER_OWNERS_DIRS.some((d) => r.startsWith(d));
});

/** Latin text that may stay on a screen. Short on purpose; each entry says why. */
const LATIN_ON_SCREEN = [
  "Zaki Workspace", // the product name
  "Zaki",
  "Workspace",
  "Telegram", // provider names
  "WhatsApp",
  "Google Drive",
  "Google",
  "OMS",
  "Ctrl", // the name of a key on the keyboard shortcut hint
  "Esc",
  "OP", // the prefix of an opportunity's number (OP-12), like T12 for a ticket
];

const VISIBLE_ATTRIBUTES = new Set(["aria-label", "aria-description", "aria-placeholder", "placeholder", "title", "alt", "label"]);
const RAW_ENUM_NAMES = /^(status|priority|stage|role|orgRole|kind|period|direction|state|event|type)$/;

/** A code sample or a placeholder example is code, not prose. */
function codeLike(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && !/\s/.test(t) && /[/:.\d]/.test(t);
}

interface Finding {
  where: string;
  what: string;
}

function inCodeElement(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isJsxElement(n)) {
      const tag = n.openingElement.tagName.getText();
      if (tag === "code" || tag === "pre") return true;
    }
  }
  return false;
}

/** Is this literal a value the JSX it sits in can print (a branch of ?: / ?? / ||, a template part, an arrow's result)? */
function printedByJsx(literal: ts.Node): boolean {
  let n: ts.Node = literal;
  for (;;) {
    const p: ts.Node | undefined = n.parent;
    if (!p) return false;
    if (ts.isJsxExpression(p)) return ts.isJsxAttribute(p.parent) ? VISIBLE_ATTRIBUTES.has(p.parent.name.getText()) : true;
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p)) {
      n = p;
      continue;
    }
    if (ts.isConditionalExpression(p)) {
      if (p.condition === n) return false;
      n = p;
      continue;
    }
    if (ts.isBinaryExpression(p)) {
      const k = p.operatorToken.kind;
      const value = k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.AmpersandAmpersandToken;
      if (!value) return false;
      if (p.left === n && k !== ts.SyntaxKind.QuestionQuestionToken) return false;
      n = p;
      continue;
    }
    if (ts.isTemplateSpan(p)) {
      n = p.parent;
      continue;
    }
    if (ts.isTemplateExpression(p)) {
      n = p;
      continue;
    }
    if (ts.isArrowFunction(p) && p.body === n) {
      n = p;
      continue;
    }
    return false;
  }
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
}

/** `{x.status}` / `{x?.priority}` / `{status}`: a bare property whose name says it is an enum. */
function rawEnumName(expr: ts.Expression): string | null {
  const e = unwrap(expr);
  if (ts.isPropertyAccessExpression(e)) return RAW_ENUM_NAMES.test(e.name.text) ? e.name.text : null;
  if (ts.isIdentifier(e)) return RAW_ENUM_NAMES.test(e.text) ? e.text : null;
  return null;
}

function scanScreen(file: string, allowed: readonly string[]): Finding[] {
  return scanSource(file, readFileSync(file, "utf8"), allowed);
}

function scanSource(file: string, text: string, allowed: readonly string[]): Finding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Finding[] = [];
  const where = (n: ts.Node) => `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const latin = (s: string) => latinLeft(s, allowed);

  function visit(node: ts.Node): void {
    // text between tags
    if (ts.isJsxText(node)) {
      const found = latin(node.text);
      if (found.length) out.push({ where: where(node), what: `text «${node.text.trim().slice(0, 50)}» has ${found.join(" ")}` });
    }
    // attributes a person reads or hears (a screen reader reads aria-label aloud)
    if (ts.isJsxAttribute(node) && VISIBLE_ATTRIBUTES.has(node.name.getText(sf))) {
      const init = node.initializer;
      let literal: string | null = null;
      let expression: ts.Expression | null = null;
      if (init && ts.isStringLiteral(init)) literal = init.text;
      else if (init && ts.isJsxExpression(init) && init.expression) {
        if (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) literal = init.expression.text;
        else expression = init.expression;
      }
      if (literal !== null && !codeLike(literal)) {
        const found = latin(literal);
        if (found.length) out.push({ where: where(node), what: `${node.name.getText(sf)}="${literal}" has ${found.join(" ")}` });
      }
      if (expression) {
        const raw = rawEnumName(expression);
        if (raw) out.push({ where: where(node), what: `${node.name.getText(sf)} shows the raw .${raw}` });
      }
    }
    // a value printed between tags: {cond ? "Yes" : "No"}, {x ?? "None"}, {`${n} items`}
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      !ts.isJsxAttribute(node.parent)
    ) {
      const probe = ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) ? node.parent : node;
      if (printedByJsx(probe) && !inCodeElement(node) && !codeLike(node.text)) {
        const found = latin(node.text);
        if (found.length) out.push({ where: where(node), what: `printed text «${node.text.slice(0, 50)}» has ${found.join(" ")}` });
      }
    }
    // {x.status} between tags
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      const raw = rawEnumName(node.expression);
      if (raw) out.push({ where: where(node), what: `prints the raw .${raw}` });
    }
    // toast("..."), confirm("...")
    if (ts.isCallExpression(node) && /^(toast|confirm|alert|window\.confirm|window\.alert|prompt)$/.test(node.expression.getText(sf))) {
      const a = node.arguments[0];
      if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) {
        const found = latin(a.text);
        if (found.length) out.push({ where: where(node), what: `${node.expression.getText(sf)}("${a.text.slice(0, 50)}") has ${found.join(" ")}` });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

describe("no English reaches a screen", () => {
  it("looks at the screens (so the checks below are not vacuous)", () => {
    const names = SCREEN_FILES.map(rel);
    expect(names.length).toBeGreaterThan(40);
    for (const expected of ["components/board-view.tsx", "components/task-detail.tsx", "app/(app)/projects/page.tsx", "app/(app)/tasks/[id]/page.tsx", "components/crm-view.tsx"]) {
      expect(names, expected).toContain(expected);
    }
    // nothing is left out any more: the shell, Today and every component directory are screens too
    for (const expected of ["components/app-shell.tsx", "app/(app)/page.tsx", "components/shell/top-bar.tsx", "components/today/today-hero.tsx", "components/guide/first-steps-client.tsx"]) {
      expect(names, expected).toContain(expected);
    }
  });

  it("the scanner does catch English and a raw enum, and lets Arabic, brands and code through (a self-test on small samples)", () => {
    const scan = (code: string) => scanSource(path.join(SRC, "components", "__sample__.tsx"), code, LATIN_ON_SCREEN).map((f) => f.what);
    // English the reader would see
    expect(scan("export const A = () => <p>Unassigned</p>;")).toHaveLength(1);
    expect(scan(`export const A = () => <input placeholder="Task title" />;`)).toHaveLength(1);
    expect(scan(`export const A = () => <button aria-label="Close" />;`)).toHaveLength(1);
    expect(scan(`export const A = ({ n }: { n?: string }) => <p>{n ?? "Unassigned"}</p>;`)).toHaveLength(1);
    expect(scan(`export const A = ({ ok }: { ok: boolean }) => <p>{ok ? "Done" : "Open"}</p>;`)).toHaveLength(2);
    expect(scan("export const A = ({ n }: { n: number }) => <p>{`${n} tasks`}</p>;")).toHaveLength(1);
    expect(scan(`declare const toast: (m: string) => void; toast("Saved");`)).toHaveLength(1);
    expect(scan(`export const A = ({ ok }: { ok: boolean }) => <i title={ok ? "Yes" : "No"} />;`)).toHaveLength(2);
    expect(scan("export const A = ({ n }: { n: number }) => <i aria-label={`${n} tasks`} />;")).toHaveLength(1);
    // an enum through its raw key
    expect(scan("export const A = ({ p }: { p: { status: string } }) => <b>{p.status}</b>;")).toHaveLength(1);
    expect(scan("export const A = ({ t }: { t: { priority: string } }) => <i title={t.priority} />;")).toHaveLength(1);
    // what is fine
    expect(scan(`declare const t: (k: string) => string; export const A = () => <p>{t("task.empty")}</p>;`)).toEqual([]);
    expect(scan("export const A = () => <p>مهمة جديدة Zaki Workspace</p>;")).toEqual([]);
    expect(scan(`export const A = () => <input placeholder="https://n8n.example.com/webhook/zaki" />;`)).toEqual([]);
    expect(scan("export const A = () => <code>{`POST /api/x`}</code>;")).toEqual([]);
    expect(
      scan(`declare function labelOf(s: string): string; export const A = ({ p }: { p: { status: string } }) => <b className={p.status === "OPEN" ? "a" : "b"}>{labelOf(p.status)}</b>;`),
    ).toEqual([]);
    // the helpers
    expect(latinLeft("Zaki Workspace Telegram", LATIN_ON_SCREEN)).toEqual([]);
    expect(latinLeft("مهمة {name}", LATIN_ON_SCREEN)).toEqual([]);
    expect(codeLike("https://n8n.example.com/webhook/zaki")).toBe(true);
    expect(codeLike("Task title")).toBe(false);
  });

  it("no JSX text, label, placeholder, tooltip, printed value or message contains an English word", () => {
    const findings = SCREEN_FILES.flatMap((f) => scanScreen(f, LATIN_ON_SCREEN));
    expect(findings.map((f) => `${f.where}  ${f.what}`)).toEqual([]);
  });

  it("the allow-list stays short: brand names, provider names, two key names and one code prefix", () => {
    expect(LATIN_ON_SCREEN.length).toBeLessThan(14);
  });

  it("no screen prints a status, priority, stage, role, kind or period through its raw key", () => {
    // included in the scan above; kept as its own check so a failure names the rule
    const findings = SCREEN_FILES.flatMap((f) => scanScreen(f, LATIN_ON_SCREEN)).filter((f) => /raw \./.test(f.what));
    expect(findings.map((f) => `${f.where}  ${f.what}`)).toEqual([]);
  });

  it("no screen builds an enum's label key by hand: it asks enumLabel, which also copes with a value it has not seen", () => {
    const BY_HAND = /\bt\(\s*`(priority\.|ticket\.status_|camp\.status_|crm\.stage_|ideas\.status\.|telegram\.type\.|role\.|ws\.role_)\$\{/;
    const offenders: string[] = [];
    for (const file of SCREEN_FILES) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (BY_HAND.test(line)) offenders.push(`${rel(file)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("no French or English month or weekday names, and no locale-dependent number or date formatting, outside lib/format", () => {
    const files = [...walkTsx(SRC), ...walkTs(SRC)].filter((f) => rel(f) !== "lib/format.ts" && rel(f) !== "lib/zoned-time.ts");
    const offenders: string[] = [];
    const NAMES = /\b(janvier|f[ée]vrier|mars|avril|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre|January|February|April|June|July|August|September|October|November|December|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/;
    for (const file of files) {
      const r = rel(file);
      if (OTHER_OWNERS_FILES.has(r) || OTHER_OWNERS_DIRS.some((d) => r.startsWith(d))) continue;
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, "");
          if (NAMES.test(code) && /["'`]/.test(code)) offenders.push(`${r}:${i + 1} names a month or a weekday in French or English`);
          if (/\.toLocale(Date|Time)?String\(|\bIntl\./.test(code)) offenders.push(`${r}:${i + 1} formats with the browser's locale (digits and names would differ per device)`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("no Latin byte unit (B, KB, MB) is written for a file size", () => {
    const offenders: string[] = [];
    for (const file of SCREEN_FILES) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/\$\{[^}]+\}\s*(B|KB|MB|GB)\b/.test(line) || /\.toFixed\(\d\)\}\s*(KB|MB)/.test(line)) offenders.push(`${rel(file)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkTs(full, out);
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 4. The brand and the pages that moved
// ---------------------------------------------------------------------------------------------

describe("the name on screen", () => {
  it("the logo reads Zaki Workspace, not Zakai.io / Intelligent Systems", () => {
    const markup = renderToStaticMarkup(createElement(Logo));
    expect(markup).toContain("Zaki Workspace");
    expect(markup).not.toMatch(/Zakai|Intelligent|\.io/);
  });
});

describe("a refused idea action says why, in Arabic", () => {
  const t = (key: string) => AR[key] ?? key;
  const refused = (messageKey?: string) => new ApiError("forbidden", 403, undefined, messageKey);

  it("turns the server's idea.<reason> into the dictionary's ideas.<reason>", () => {
    expect(ideaError(refused("idea.not_owner"), t)).toBe(AR["ideas.not_owner"]);
    expect(ideaError(refused("idea.already_converted"), t)).toBe(AR["ideas.already_converted"]);
    expect(ideaError(refused("idea.bad_title"), t)).toBe(AR["ideas.bad_title"]);
    expect(ideaError(refused("idea.invalid_transition:NEW->ACCEPTED"), t)).toBe(AR["ideas.invalid_transition"]);
  });

  it("never shows a raw key: no sentence for it is the general refusal, and anything else the general error", () => {
    expect(ideaError(refused("idea.something_new"), t)).toBe(AR["forbidden"]);
    expect(ideaError(refused(), t)).toBe(AR["forbidden"]);
    expect(ideaError(new ApiError("internal", 500), t)).toBe(AR["common.error"]);
    expect(ideaError(new Error("boom"), t)).toBe(AR["common.error"]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. The CRM follows crm.edit
// ---------------------------------------------------------------------------------------------

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

function render(element: ReactElement, client = new QueryClient()): string {
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))));
}

const CUSTOMER = { id: "c1", name: "شركة النور", company: "النور للتجارة", email: "info@example.com", phone: "0790000000", notes: null, creator: { id: "u1", name: "أحمد" }, createdAt: "2026-10-01T00:00:00.000Z" };
const OPPORTUNITY = {
  id: "o1",
  number: 7,
  title: "عرض توريد",
  value: 12500,
  stage: "NEGOTIATION",
  expectedCloseAt: null,
  notes: null,
  customer: { id: "c1", name: "شركة النور", company: null },
  owner: { id: "u1", name: "أحمد" },
  createdAt: "2026-10-02T00:00:00.000Z",
};

function crmClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(["crm", "customers"], { customers: [CUSTOMER] });
  client.setQueryData(["crm", "opportunities"], { opportunities: [OPPORTUNITY] });
  return client;
}

describe("the CRM view without crm.edit (a person who may read, not change)", () => {
  const noop = () => {};

  it("shows the customers but no 'new customer' button", () => {
    const editor = render(createElement(CrmView, { canEdit: true, canSeePrices: true }), crmClient());
    const reader = render(createElement(CrmView, { canEdit: false, canSeePrices: true }), crmClient());
    expect(editor).toContain(AR["crm.newCustomer"]);
    expect(reader).not.toContain(AR["crm.newCustomer"]);
    expect(reader).toContain(CUSTOMER.name);
    expect(reader).toContain(AR["crm.customers"]);
  });

  it("customer cards have edit and delete buttons only for an editor", () => {
    const rows = [CUSTOMER];
    const editor = render(createElement(CustomersTab, { rows, loading: false, canEdit: true, onEdit: noop, onDelete: noop }));
    const reader = render(createElement(CustomersTab, { rows, loading: false, canEdit: false, onEdit: noop, onDelete: noop }));
    expect(editor).toContain(`aria-label="${AR["common.edit"]}"`);
    expect(editor).toContain(`aria-label="${AR["common.delete"]}"`);
    expect(reader).not.toContain(`aria-label="${AR["common.edit"]}"`);
    expect(reader).not.toContain(`aria-label="${AR["common.delete"]}"`);
    expect(reader).toContain(CUSTOMER.name);
    expect(reader).toContain(CUSTOMER.email);
  });

  it("opportunity rows: the stage is a select only for an editor, plain text for a reader; the amount is a plain number", () => {
    const rows = [OPPORTUNITY];
    const props = { rows, loading: false, onEdit: noop, onDelete: noop, onStageChange: noop };
    const editor = render(createElement(OpportunitiesTab, { ...props, canEdit: true }));
    const reader = render(createElement(OpportunitiesTab, { ...props, canEdit: false }));
    expect(editor).toContain("<select");
    expect(editor).toContain(`aria-label="${AR["common.edit"]}"`);
    expect(editor).toContain(`aria-label="${AR["common.delete"]}"`);
    expect(reader).not.toContain("<select");
    expect(reader).not.toContain(`aria-label="${AR["common.edit"]}"`);
    expect(reader).not.toContain(`aria-label="${AR["common.delete"]}"`);
    // the stage and the amount are still shown to the reader, in Arabic and with Western digits
    expect(reader).toContain(AR["crm.stage_negotiation"]);
    expect(reader).toContain("12,500");
    expect(reader).not.toContain(`12,500 ${AR["crm.currency"]}`); // «العملة» is the word for "the currency", not a unit
    expect(reader).toContain("OP-7");
  });

  it("an amount the server hid is a dash, never a number (no `prices.view`)", () => {
    const rows = [{ ...OPPORTUNITY, value: null }];
    const props = { rows, loading: false, canEdit: false, onEdit: noop, onDelete: noop, onStageChange: noop };
    const html = render(createElement(OpportunitiesTab, props));
    expect(html).toContain(AR["enum.none"]);
    expect(html).not.toContain("12,500");
    // the rest of the row is still there: the deal is readable without its money
    expect(html).toContain(OPPORTUNITY.title);
    expect(html).toContain("OP-7");
  });

  it("a person who cannot edit gets no 'new opportunity' button either (the CRM view as a whole)", () => {
    const client = crmClient();
    const reader = render(createElement(CrmView, { canEdit: false, canSeePrices: true }), client);
    expect(reader).not.toContain(AR["crm.newOpportunity"]);
    expect(reader).not.toContain(AR["crm.newCustomer"]);
  });
});
