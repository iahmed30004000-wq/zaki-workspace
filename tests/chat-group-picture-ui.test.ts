import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «صورة المجموعة» on the screen: ONE face component draws the picture or the emoji everywhere a group is drawn, the edit dialog lets a manager pick or remove the picture, and the
 * hook talks to the picture route. Pinned by source (the behaviour is in tests/db/group-picture.test.ts).
 */
const ROOT = path.resolve(__dirname, "..");
const SRC = (file: string) => readFileSync(path.join(ROOT, "src", file), "utf8");

describe("group picture UI", () => {
  it("the list row, the group pane and the arrange sheet all draw through GroupFace", () => {
    for (const file of ["row", "arrange"]) expect(SRC(`components/chat/v2/list/group-${file}.tsx`)).toContain("<GroupFace");
    expect(SRC("components/chat/v2/list/group-topics-pane.tsx")).toContain("<GroupFace");
    expect(SRC("components/chat/v2/list/group-face.tsx")).toContain("data-group-image");
  });

  it("the picture comes from the live groups, not from the pick the pane was opened with", () => {
    expect(SRC("components/chat/v2/list/group-topics-pane.tsx")).toContain("groups.find((g) => g.id === group.id)?.imageUrl");
  });

  it("the edit dialog offers add / change / remove and sends the file through the hook", () => {
    const dialog = SRC("components/chat/v2/list/group-dialogs.tsx");
    for (const key of ["chatgrp.picture_add", "chatgrp.picture_change", "chatgrp.picture_remove", "data-group-picture-input"]) expect(dialog).toContain(key);
    expect(dialog).toContain("picture.mutate(");
    expect(dialog).toContain("clearPicture.mutate(");
    const hook = SRC("lib/chat/v2/use-space-groups.ts");
    expect(hook).toContain("/picture");
    expect(hook).toContain("compressImage(");
  });

  it("the server keeps the emoji and the picture apart: the DTO carries both", () => {
    expect(SRC("server/chat/groups.ts")).toContain("imageUrl: g.imageUrl");
    expect(SRC("server/chat/group-picture.ts")).toContain('assertFeatureOn(ctx.orgId, "groupPictures")');
  });
});
