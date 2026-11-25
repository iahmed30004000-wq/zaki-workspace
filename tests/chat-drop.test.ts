import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { dropOnZone } from "@/lib/chat/v2/composer/clipboard-files";
import { AR } from "@/lib/i18n/dict";

/** Dragging files onto the chat. The bug these hold: the pane's own drop listener closed the two zones before React could hand them the files, so every real drop was lost. */
const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

const inZone = (zone: string | null) => ({ closest: (selector: string) => (selector === "[data-drop-zone]" && zone !== null ? { getAttribute: () => zone } : null) });
const FILES = [{ name: "a.png" }, { name: "b.pdf" }] as unknown as File[];

describe("dropOnZone", () => {
  it("says which zone the files were let go on, and hands every one of them", () => {
    expect(dropOnZone(inZone("media"), FILES)).toEqual({ zone: "media", files: FILES });
    expect(dropOnZone(inZone("files"), FILES)).toEqual({ zone: "files", files: FILES });
  });
  it("reads the zone from a word inside it too (a drop's target can be the text node)", () => {
    expect(dropOnZone({ parentElement: inZone("files") }, FILES)?.zone).toBe("files");
  });
  it("is nothing outside the zones, with no files, or for a zone that does not exist", () => {
    expect(dropOnZone(inZone(null), FILES)).toBeNull();
    expect(dropOnZone(inZone("media"), [])).toBeNull();
    expect(dropOnZone(inZone("media"), null)).toBeNull();
    expect(dropOnZone(inZone("other"), FILES)).toBeNull();
    expect(dropOnZone(null, FILES)).toBeNull();
  });
});

describe("where a drop is taken", () => {
  const overlay = read("src/components/chat/v2/composer/drop-overlay.tsx");
  const sheet = read("src/components/chat/v2/composer/attach-sheet.tsx");
  const surface = read("src/components/chat/v2/composer/composer-surface.tsx");
  it("the pane's native listener takes the files itself, before anything closes the zones; the zones have no drop handler of their own to lose them", () => {
    expect(overlay).toContain("dropOnZone(event.target, event.dataTransfer?.files)");
    expect(overlay).not.toContain("onDrop={");
  });
  it("while a conversation is open, a file let go anywhere else is not opened by the browser (that leaves the page and loses the draft)", () => {
    expect(overlay).toContain('window.addEventListener("dragover", refuse)');
    expect(overlay).toContain('window.addEventListener("drop", refuse)');
    expect(overlay).toContain('event.dataTransfer.dropEffect = "none"');
    expect(overlay).toContain("if (event.defaultPrevented ||");
  });
  it("the open attach sheet takes dropped files too: it covers the pane, so the pane never hears of them", () => {
    expect(sheet).toContain("onDragOver={takeDrag}");
    expect(sheet).toContain("onDrop={dropFiles}");
    expect(sheet).toContain('ct("chatui.attachsheet.drop_hint")');
    expect(surface).toContain("onDropFiles={(files) => c.addDropped?.(files, false)}");
    expect(AR["chatui.attachsheet.drop_hint"]).toBeTruthy();
  });
});
