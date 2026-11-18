import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { Button, BUTTON_VARIANTS } from "../src/components/ui/button";
import { Badge, BADGE_TONES } from "../src/components/ui/badge";
import { ListRow } from "../src/components/ui/list-row";
import { Segmented } from "../src/components/ui/segmented";
import { Switch } from "../src/components/ui/switch";
import { Avatar, markAvatarFailed, resetFailedAvatars } from "../src/components/ui/avatar";

/** D1.2: the button set and the primitives. Render tests; no screen changes behaviour in this step. */
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("the button set", () => {
  it("has the seven variants of D1 §4 and the API is the old one", () => {
    expect([...BUTTON_VARIANTS]).toEqual(["primary", "tonal", "secondary", "ghost", "danger", "link", "fab"]);
    expect(html(React.createElement(Button, null, "x"))).toContain("bg-accent");
  });
  it("primary is the filled accent, tonal a tint of it, danger is for destruction", () => {
    expect(html(React.createElement(Button, { variant: "primary" }, "x"))).toMatch(/bg-accent text-accent-fg/);
    expect(html(React.createElement(Button, { variant: "tonal" }, "x"))).toMatch(/bg-accent\/12 text-accent/);
    expect(html(React.createElement(Button, { variant: "danger" }, "x"))).toMatch(/bg-danger text-danger-fg/);
  });
  it("a link is inline text, an icon button is a round ghost, a fab is a 56 px round accent with a shadow", () => {
    expect(html(React.createElement(Button, { variant: "link" }, "x"))).toMatch(/text-accent/);
    expect(html(React.createElement(Button, { variant: "ghost", size: "icon" }, "x"))).toMatch(/rounded-full/);
    const fab = html(React.createElement(Button, { variant: "fab" }, "x"));
    expect(fab).toMatch(/size-14/);
    expect(fab).toMatch(/rounded-full/);
    expect(fab).toMatch(/shadow-card/);
  });
  it("every button is at least 44 px on a phone and has a visible focus ring", () => {
    for (const v of ["primary", "tonal", "secondary", "ghost", "danger"] as const) {
      const m = html(React.createElement(Button, { variant: v }, "x"));
      expect(m, v).toMatch(/h-11/);
      expect(m, v).toMatch(/focus-visible:outline/);
    }
  });
});

describe("the primitives", () => {
  it("a badge has a tone each; the accent one is for what is new, the muted one uses its own token", () => {
    expect([...BADGE_TONES].sort()).toEqual(["accent", "danger", "info", "muted", "neutral", "ok", "warn"]);
    expect(html(React.createElement(Badge, { tone: "accent" }, "3"))).toMatch(/bg-accent text-accent-fg/);
    expect(html(React.createElement(Badge, { tone: "muted" }, "3"))).toMatch(/bg-badge-muted/);
    expect(html(React.createElement(Badge, null, "3"))).toMatch(/tabular-nums/);
  });
  it("a list row has a title, a second line and a trailing slot, and the selected one uses the selected-row tokens", () => {
    const row = html(React.createElement(ListRow, { title: "سلمى", subtitle: "مرحبا", trailing: "10:30", selected: true }));
    expect(row).toContain("سلمى");
    expect(row).toContain("مرحبا");
    expect(row).toContain("10:30");
    expect(row).toMatch(/bg-selected-row text-selected-row-fg/);
    expect(html(React.createElement(ListRow, { title: "x" }))).not.toMatch(/bg-selected-row/);
  });
  it("a segmented control is a radio group with one checked option", () => {
    const m = html(React.createElement(Segmented, { value: "b", label: "العرض", onChange: () => undefined, options: [{ value: "a", label: "أ" }, { value: "b", label: "ب" }] }));
    expect(m).toContain('role="radiogroup"');
    expect(m.match(/role="radio"/g)).toHaveLength(2);
    expect(m.match(/aria-checked="true"/g)).toHaveLength(1);
  });
  it("a switch says whether it is on", () => {
    expect(html(React.createElement(Switch, { checked: true, onChange: () => undefined, label: "ميزة" }))).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(html(React.createElement(Switch, { checked: false, onChange: () => undefined, label: "ميزة" }))).toMatch(/aria-checked="false"/);
  });
});

describe("the avatar", () => {
  beforeEach(() => resetFailedAvatars());
  it("draws its picture, and the initials once that address has failed (and does not ask for it again)", () => {
    const src = "/api/avatars/u1?v=f1";
    expect(html(React.createElement(Avatar, { name: "سلمى الأحمد", src }))).toContain("<img");
    markAvatarFailed(src);
    const m = html(React.createElement(Avatar, { name: "سلمى الأحمد", src }));
    expect(m).not.toContain("<img");
    expect(m).toContain("hsl(");
  });
  it("never draws an address that is not ours", () => {
    expect(html(React.createElement(Avatar, { name: "x", src: "https://evil.example/a.png" }))).not.toContain("<img");
  });
});

describe("the typography of the working screens", () => {
  const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
  it("has the variable scale and the five sizes", () => {
    expect(css).toContain("--chat-font-scale: 1");
    for (const c of [".text-chat", ".text-chat-secondary", ".text-chat-meta", ".text-bar-title", ".text-page-title"]) expect(css, c).toContain(c);
    expect(css).toMatch(/font-size: calc\(15px \* var\(--chat-font-scale\)\)/);
    expect(css).toMatch(/line-height: 1\.45/);
  });
});

describe("the guard: a screen does not invent its own filled-accent button", () => {
  // The count of files that still draw a raw `<button className="… bg-accent …">`. It may only go DOWN (a screen moves to <Button>); a new one fails here.
  const BASELINE_FILES = 27;
  function walk(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".tsx")) out.push(p);
    }
    return out;
  }
  it("— at most the screens that already did (move one to <Button> and lower the number)", () => {
    const own = new Set(["ui" + path.sep + "button.tsx", "ui" + path.sep + "segmented.tsx", "ui" + path.sep + "switch.tsx"]);
    const root = path.join(process.cwd(), "src");
    const raw = walk(root).filter((f) => {
      if ([...own].some((o) => f.endsWith(o))) return false;
      return /<button[^>]*className=[^>]*bg-accent[^/]/.test(readFileSync(f, "utf8"));
    });
    expect(raw.length, raw.map((f) => path.relative(root, f)).join("\n")).toBeLessThanOrEqual(BASELINE_FILES);
  });
});
