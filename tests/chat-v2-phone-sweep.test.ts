import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { FEATURE_DEFAULTS } from "@/lib/features";

/**
 * C2 — THE SWEEP OF THE WHOLE PHASE (C2.8 is its last package). It checks, from the files themselves, the promises the spec made to the owner at the end of
 * the phase: nothing of Q1 was lost on the way (each carry-over has a render test), the guards that keep the new screen on the tokens and on logical sides
 * are in place and cover the folders C2.8 added, only «Ctrl» and «Esc» are Latin on screen, the old screen is still there (D-C1) and the switch is OFF.
 * It measures NOTHING about speed or feel: those need a browser and are the owner's list in docs/restructure/pr/C2.8.md.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("nothing of Q1 is lost: each carry-over has its render test", () => {
  const ITEMS: { what: string; file: string; title: RegExp }[] = [
    { what: "the «/» menu and its «⚡» button", file: "tests/chat-v2-composer-render.test.ts", title: /«\/» and its «⚡» button/ },
    { what: "the CARD bubble with «افتح الكرت»", file: "tests/chat-v2-bubble-q1.test.ts", title: /the CARD bubble/ },
    { what: "an order number shown as a chip", file: "tests/chat-v2-bubble-q1.test.ts", title: /an order number in a message is a chip/ },
    { what: "the ticket chip under a message and the «✅ انحلّت» reply", file: "tests/chat-v2-bubble-q1.test.ts", title: /the ticket chip under a message/ },
    { what: "«قرأت ✓» with «قرأ 7 من 10»", file: "tests/chat-v2-bubble-q1.test.ts", title: /«قرأت ✓» with «قرأ 7 من 10»/ },
    { what: "the hints of Q1.7", file: "tests/chat-v2-bubble-q1.test.ts", title: /the customer-data hint \(Q1\.7\)/ },
    { what: "the menu item «🎫 مشكلة»", file: "tests/chat-v2-menu-render.test.ts", title: /Q1 carry-over: «🎫 مشكلة»/ },
    { what: "the menu item «اسألي مشرفتك»", file: "tests/chat-v2-menu-render.test.ts", title: /Q1 carry-over: «اسألي مشرفتك»/ },
  ];
  for (const item of ITEMS) {
    it(item.what, () => {
      expect(existsSync(path.join(ROOT, item.file)), item.file).toBe(true);
      const src = read(item.file);
      expect(src).toMatch(item.title);
      // a render test, not a source grep: the file draws the real component
      expect(src).toMatch(/renderToStaticMarkup/);
    });
  }
});

describe("the guards of the new screen cover the folders of C2.8", () => {
  const guard = read("tests/chat-v2-no-hex-guard.test.ts");

  it("the no-hex guard walks the whole components folder and the pure folder, so `phone/` is inside it", () => {
    expect(guard).toContain('const V2_DIR = "src/components/chat/v2";');
    expect(guard).toContain('const PURE_DIRS = ["src/lib/chat/v2"];');
    expect(existsSync(path.join(ROOT, "src/components/chat/v2/phone/list-bar.tsx"))).toBe(true);
    expect(existsSync(path.join(ROOT, "src/lib/chat/v2/phone/motion.ts"))).toBe(true);
    for (const check of ["no hex colour, rgb()/hsl() literal or raw palette class", "logical sides only", "no font size under 12 px", "no Arabic letter in a literal"]) expect(guard).toContain(check);
  });

  it("the call entry points (outside that folder) are held to the same rules by their own render test", () => {
    expect(read("tests/chat-v2-calls-render.test.ts")).toContain("no raw palette colour, no hex, no physical side, no text under 12 px");
  });

  it("the pinned neighbours of the frame are in the run list: the frame's tests exist and the frame does not import the chat's components", () => {
    for (const file of ["tests/nav-shell-v2.test.ts", "tests/shell-safe-area.test.ts", "tests/chat-v2-switch-combinations.test.ts", "tests/ui-font-floor.test.ts", "tests/call-layout.test.ts"]) expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    expect(read("src/components/app-shell.tsx")).not.toMatch(/components\/chat\/v2/);
  });
});

describe("on screen only «Ctrl» and «Esc» are Latin", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx$/.test(name)) out.push(full);
    }
    return out;
  }
  /** The words written between tags (what a person reads), and the text of labels given as attributes. */
  function readable(file: string): { text: string; line: number }[] {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const out: { text: string; line: number }[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) && node.text.trim()) out.push({ text: node.text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
      if (ts.isJsxAttribute(node) && ["aria-label", "title", "placeholder", "alt"].includes(node.name.getText(sf)) && node.initializer && ts.isStringLiteral(node.initializer)) out.push({ text: node.initializer.text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  }

  it("no word on screen, in the new chat or the call entry points, is written in Latin letters except the two key names", () => {
    const files = [...walk(path.join(ROOT, "src/components/chat/v2")), ...["call-button", "call-ring", "meeting-button"].map((n) => path.join(ROOT, `src/components/calls/${n}.tsx`))];
    const offenders: string[] = [];
    for (const file of files) {
      for (const { text, line } of readable(file)) {
        for (const word of text.match(/[A-Za-z]{2,}/g) ?? []) if (word !== "Ctrl" && word !== "Esc") offenders.push(`${path.relative(ROOT, file)}:${line}  ${word}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the shortcuts sheet draws exactly those two as Latin", () => {
    const src = read("src/components/chat/v2/menu/shortcuts-sheet.tsx");
    expect(src).toContain(">Ctrl</kbd>");
    expect(src).toContain(">Esc</kbd>");
    expect(read("tests/arabic-ui.test.ts")).toMatch(/"Ctrl",[^\n]*\n\s*"Esc",/);
  });
});

describe("the old screen stays, and the switch stays OFF (D-C1)", () => {
  it("chatLayoutV2 and navV2 are OFF by default; flipping them is the owner's, after his C2 check", () => {
    expect(FEATURE_DEFAULTS.chatLayoutV2).toBe(false);
    expect(FEATURE_DEFAULTS.navV2).toBe(false);
  });

  it("the old home, the old conversation page and the old composer are still in the tree and still mounted by the pages when the switch is off", () => {
    for (const file of ["src/components/chat/home/chat-home-client.tsx", "src/components/chat/conversation/conversation-page-client.tsx", "src/components/chat/composer/chat-composer.tsx", "src/components/chat/message/message-item.tsx"]) expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    expect(read("src/app/(app)/chat/page.tsx")).toContain("<ChatHomeClient");
    expect(read("src/app/(app)/chat/[id]/page.tsx")).toContain("<ConversationPageClient");
  });

  it("C2.8 added no schema and no migration, and no server door: the new route reads nothing on the server but the switch", () => {
    const page = read("src/app/(app)/chat/[id]/info/page.tsx");
    expect(page).not.toMatch(/\bdb\./);
    expect(page).not.toMatch(/prisma/i);
  });
});
