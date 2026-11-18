import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C1.4 — ONE module owns every write to the chat cache. The chat keys are `["chat","list"]`, `["chat","space",id]`,
 * `["chat","conv",id,"header"]` and `["chat","conv",id,"messages"]` (`src/lib/chat/cache/keys.ts`); only the files of
 * `src/lib/chat/cache/` may call `setQueryData` / `setQueriesData` on them. A component that wrote its own copy of a
 * message would be a second writer: the unread numbers, the tombstones and the device copy would each have two truths.
 * A source-text test, because no runtime check can see a call made from a component nobody has written yet.
 */

const SRC = path.resolve(__dirname, "../src");
const CACHE_DIR = "lib/chat/cache/";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((f) => ({ file: path.relative(SRC, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));
const outside = files.filter((f) => !f.file.startsWith(CACHE_DIR));
const inside = files.filter((f) => f.file.startsWith(CACHE_DIR));

const WRITE = /\bsetQuer(?:y|ies)Data\b/;
/** the family: a key whose first element is the literal "chat", or anything built by the cache's own key helper */
const CHAT_KEY = /\[\s*["']chat["']\s*[,\]]|\bchatKeys\b|\bCHAT_KEY|\bchatKey\b/;

/** the text of each call: from the name to the matching close parenthesis */
function calls(text: string): string[] {
  const found: string[] = [];
  const re = /\bsetQuer(?:y|ies)Data\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = text.indexOf("(", m.index);
    if (open < 0) continue;
    let depth = 0;
    let end = open;
    for (; end < text.length; end++) {
      const c = text[end];
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
    }
    found.push(text.slice(m.index, end + 1));
  }
  return found;
}

describe("the chat cache has one writer", () => {
  it("scans the source (so the checks below are not vacuous)", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(inside.length).toBeGreaterThan(5);
    // the writer exists and is where the guard says it is
    expect(inside.map((f) => f.file)).toContain("lib/chat/cache/writer.ts");
    expect(inside.some((f) => WRITE.test(f.text))).toBe(true);
  });

  it("no file outside src/lib/chat/cache/ calls setQueryData / setQueriesData on a chat key", () => {
    const offenders: string[] = [];
    for (const { file, text } of outside) {
      for (const call of calls(text)) if (CHAT_KEY.test(call)) offenders.push(`${file}: ${call.replace(/\s+/g, " ").slice(0, 100)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("a file that knows the chat keys does not write at all, whatever the call looks like (a key kept in a variable)", () => {
    const offenders: string[] = [];
    for (const { file, text } of outside) {
      if (WRITE.test(text) && (CHAT_KEY.test(text) || /from "@\/lib\/chat\/cache/.test(text))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the detector itself works: it would see a component that writes a chat key", () => {
    const bad = `const qc = useQueryClient();\nqc.setQueryData(["chat", "list"], (old) => old);\nqc.setQueriesData({ queryKey: chatKeys.list() }, x);`;
    expect(calls(bad).filter((c) => CHAT_KEY.test(c))).toHaveLength(2);
    const fine = `qc.setQueryData(["orgs"], data);\nqc.setQueryData(["quick-chat-people"], data);`;
    expect(calls(fine).filter((c) => CHAT_KEY.test(c))).toHaveLength(0);
  });

  it("the other writes are held to the same rule: nobody outside removes or resets a chat key either", () => {
    const offenders: string[] = [];
    for (const { file, text } of outside) {
      for (const m of text.matchAll(/\b(?:removeQueries|resetQueries)\s*\(\s*\{[^}]*\}/g)) if (CHAT_KEY.test(m[0])) offenders.push(`${file}: ${m[0].slice(0, 80)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the folder exports the whole writer surface from one barrel, and the later packages only ADD files", () => {
    const barrel = inside.find((f) => f.file === "lib/chat/cache/index.ts")?.text ?? "";
    for (const name of ["applySync", "appendMessage", "replaceMessage", "tombstone", "applyReads", "upsertRows", "removeConversation", "scheduleSync", "useChatList", "useChatRow", "useChatHeader", "useChatMessages", "wipeChatCache", "chatKeys"]) {
      expect(barrel, name).toContain(name);
    }
  });
});
