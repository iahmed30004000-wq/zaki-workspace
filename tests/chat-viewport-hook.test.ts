import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { useMessageViewport } from "@/lib/chat/viewport/use-message-viewport";
import { OVERSCAN } from "@/lib/chat/viewport/config";
import { buildRows } from "@/lib/chat/viewport/rows";
import { estimateRowHeight } from "@/lib/chat/viewport/sizes";
import { makeConversation } from "./chat-history-model.test";

(globalThis as { React?: typeof React }).React = React;

const SRC = path.resolve(__dirname, "../src");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

/**
 * C1.7 — the viewport hook is built on @tanstack/react-virtual with the settings the spec fixes. Its scrolling needs a browser (the
 * owner's list in docs/restructure/pr/C1.6.md); what a unit test can pin is the configuration, the first render, and that the old
 * screen does not use any of it yet.
 */
describe("the viewport hook's configuration", () => {
  const source = read("lib/chat/viewport/use-message-viewport.ts");

  it("uses @tanstack/react-virtual with overscan 10, the message id as the item key, and measured heights", () => {
    expect(OVERSCAN).toBe(10);
    expect(source).toMatch(/from "@tanstack\/react-virtual"/);
    expect(source).toMatch(/overscan:\s*OVERSCAN/);
    expect(source).toMatch(/getItemKey/);
    expect(source).toMatch(/rows\[index\]\?\.key/);
    expect(source).toMatch(/measureElement/);
    expect(source).toMatch(/^"use client";/);
  });

  it("keeps today's two rules, imported (not copied): onNewest and isAtBottom from conversation/client.ts", () => {
    const arrival = read("lib/chat/viewport/arrival.ts");
    expect(arrival).toMatch(/import \{[^}]*\bonNewest\b[^}]*\} from "@\/lib\/chat\/conversation\/client"/);
    expect(source).toMatch(/import \{[^}]*\bisAtBottom\b[^}]*\} from "@\/lib\/chat\/conversation\/client"/);
  });

  it("holds a MESSAGE row as the anchor, takes the scroller by a callback ref, and gives up a landing that never finds its row", () => {
    expect(source).toMatch(/type === "message"/);
    expect(source).toMatch(/scrollRef = useCallback\(\(node: HTMLDivElement \| null\)/);
    expect(source).toMatch(/pendingExpired/);
    expect(source).toMatch(/scrollRowIndex/);
  });

  it("restores the anchor in a layout effect (before paint), so a prepend never flashes", () => {
    expect(source).toMatch(/useLayoutEffect/);
    expect(source).toMatch(/restoredScrollTop/);
    expect(source).toMatch(/captureAnchor/);
  });
});

describe("the first render (no scroll element yet: the server render, and the very first client render)", () => {
  it("is the total of the estimated heights, and no row is drawn before there is something to measure against", () => {
    const rows = buildRows(makeConversation(30, 1), {});
    const Probe = () => {
      const v = useMessageViewport({ rows, hasNewer: false, scroll: null });
      return createElement("pre", null, JSON.stringify({ total: v.totalSize, items: v.items.length, atBottom: v.atBottom, newBelow: v.newBelow }));
    };
    const html = renderToStaticMarkup(createElement(Probe));
    const out = JSON.parse(html.replace(/^<pre>/, "").replace(/<\/pre>$/, "").replace(/&quot;/g, '"')) as { total: number; items: number; atBottom: boolean; newBelow: number };
    expect(out.total).toBe(rows.reduce((s, r) => s + estimateRowHeight(r), 0));
    expect(out.items).toBe(0);
    expect(out.newBelow).toBe(0);
    expect(typeof out.atBottom).toBe("boolean");
  });
});

describe("the old screen is untouched", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("nothing outside src/lib/chat/ (and the C2 folders, later) imports the new history / viewport modules yet", () => {
    const uses = /@\/lib\/chat\/(history|viewport)\/|@\/lib\/chat\/cache\/(pages|trim)\b/;
    const allowed = /^(lib\/chat\/(history|viewport|cache)\/|components\/chat\/v2\/|app\/\(app\)\/chat\/)/;
    const offenders = walk(SRC)
      .map((f) => ({ file: path.relative(SRC, f).split(path.sep).join("/"), text: readFileSync(f, "utf8") }))
      .filter(({ file }) => !allowed.test(file))
      .filter(({ text }) => uses.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
    const screen = read("components/chat/conversation/conversation-screen.tsx");
    expect(screen).not.toMatch(/lib\/chat\/(history|viewport)/);
  });
});

describe("what the hooks keep apart", () => {
  const viewport = read("lib/chat/viewport/use-message-viewport.ts");
  const history = read("lib/chat/history/use-conversation-history.ts");

  it("the viewport forgets the last conversation's counter, bottom and anchor when the conversation changes, and never follows the bottom over a restored anchor", () => {
    expect(viewport).toMatch(/resetKey/);
    expect(viewport).toMatch(/!arrived && !restored/);
  });

  it("every run that replaces the windows is numbered and only the latest may write; a jump never overtakes the opening", () => {
    expect(history).toMatch(/runs\.current/);
    expect(history).toMatch(/current\s*=\s*\(\)\s*=>/);
    expect(history).toMatch(/!readyRef\.current/);
    // `around` is read when the conversation opens, it is not a dependency of the opening
    expect(history).toMatch(/\[qc, conversationId, attempt, signals\]/);
  });

  it("the cap is looked at whenever the screen reports where it is, not only when the messages change", () => {
    expect(history).toMatch(/trimMessages\(qc, activeId\.current, firstVisibleMessageId\)/);
  });
});
