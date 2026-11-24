import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

(globalThis as { React?: typeof React }).React = React;

import { AttachSheetPanel, type AttachSheetPanelProps } from "@/components/chat/v2/composer/attach-sheet";
import type { PendingFile } from "@/lib/chat/v2/composer/types";

/** «المرفقات» (S6.1): Telegram's attach sheet: the picks as a numbered grid, the caption, send with a count, the glass bar of kinds. */
const noop = () => undefined;
const image = (name: string): PendingFile => ({ file: new File(["x"], name, { type: "image/png" }), kind: "IMAGE", preview: `blob:${name}`, asFile: false });
const doc = (name: string): PendingFile => ({ file: new File(["x"], name, { type: "application/pdf" }), kind: "FILE", preview: null, asFile: true });

function panel(over: Partial<AttachSheetPanelProps>): string {
  return renderToStaticMarkup(
    createElement(AttachSheetPanel, { items: ["media", "file", "poll", "checklist"], files: [], busy: false, caption: "", canSend: false, onCaption: noop, onPick: noop, onRemove: noop, onSend: noop, ...over }),
  );
}

describe("the sheet before anything is picked", () => {
  const html = panel({});
  it("offers the picker of the system and no grid, no caption, no send", () => {
    expect(html).toContain("data-attach-sheet");
    expect(html).toContain("data-attach-pick");
    expect(html).not.toContain("data-attach-grid");
    expect(html).not.toContain("data-attach-caption");
    expect(html).not.toContain("data-attach-send");
  });
  it("draws the glass bar with one button per kind the server allows", () => {
    expect(html).toContain("data-attach-kinds");
    for (const kind of ["media", "file", "poll", "checklist"]) expect(html).toContain(`data-attach-kind="${kind}"`);
    const fewer = panel({ items: ["media", "file"] });
    expect(fewer).not.toContain('data-attach-kind="poll"');
    expect(fewer).not.toContain('data-attach-kind="checklist"');
  });
});

describe("the sheet with picks", () => {
  const html = panel({ files: [image("a.png"), doc("b.pdf"), image("c.png")], caption: "صباح الخير", canSend: true });
  it("shows a numbered tile for each pick, in order, and a tile to add more", () => {
    expect(html.match(/data-attach-tile=/g)).toHaveLength(3);
    expect(html).toContain('data-attach-tile="FILE"');
    for (const n of [1, 2, 3]) expect(html).toContain(`data-attach-number="${n}"`);
    expect(html).toContain("data-attach-more");
    expect(html).not.toContain("data-attach-pick");
  });
  it("carries the caption and a send button with the count on it", () => {
    expect(html).toContain("data-attach-caption");
    expect(html).toContain("صباح الخير");
    const send = html.slice(html.indexOf("data-attach-send"));
    expect(send).toContain(">3<");
    expect(send.slice(0, send.indexOf(">"))).not.toContain("disabled=");
  });
  it("the send button is off while nothing can be sent, and the tiles lose their numbers while sending", () => {
    expect(panel({ files: [image("a.png")], canSend: false })).toMatch(/data-attach-send[^>]*disabled=""/);
    const sending = panel({ files: [image("a.png")], busy: true, canSend: true });
    expect(sending).not.toContain("data-attach-number");
    expect(sending).not.toContain("data-attach-more");
  });
  it("marks the gallery button pressed once there are picks", () => {
    expect(html).toMatch(/data-attach-kind="media"[^>]*aria-pressed="true"/);
  });
});

describe("where the sheet is used", () => {
  const SURFACE = readFileSync(path.resolve(__dirname, "../src/components/chat/v2/composer/composer-surface.tsx"), "utf8");
  const HOST = readFileSync(path.resolve(__dirname, "../src/components/chat/v2/composer/chat-composer-v2.tsx"), "utf8");
  it("replaces the little menu only while «شكل تيليجرام» is on, and never while a message is being edited", () => {
    expect(SURFACE).toContain("{!editing && attachSheet ? (");
    expect(SURFACE).toContain("{!editing && !attachSheet ? <AttachMenu");
    expect(HOST).toContain("attachSheet={detail.tgLook !== false}");
  });
  it("sends through the composer's own submit, so the caption, the album and the offline outbox are the ones already tested", () => {
    expect(SURFACE).toContain("onSend={() => c.submit()}");
    expect(SURFACE).toContain("caption={c.body}");
  });
});
