import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GROUP_EMOJIS } from "@/components/chat/v2/list/group-dialogs";
import { AR } from "@/lib/i18n/dict";

/** Editing a group: its name and its picture (an emoji, replacing the fixed 📁 — a manager picks one from a row of choices or types any). */
const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8").replace(/\r\n/g, "\n");

describe("the emoji choices of a group", () => {
  it("are a handful of distinct emojis the server accepts (at most 16 characters each), starting with the old folder", () => {
    expect(GROUP_EMOJIS[0]).toBe("📁");
    expect(new Set(GROUP_EMOJIS).size).toBe(GROUP_EMOJIS.length);
    expect(GROUP_EMOJIS.length).toBeGreaterThanOrEqual(16);
    for (const e of GROUP_EMOJIS) expect(e.length).toBeLessThanOrEqual(16);
  });
});

describe("where a manager edits a group", () => {
  const pane = SRC("components/chat/v2/list/group-topics-pane.tsx");
  const dialogs = SRC("components/chat/v2/list/group-dialogs.tsx");
  const hook = SRC("lib/chat/v2/use-space-groups.ts");

  it("the group's own screen has a pencil for a manager, never for «عام» (it is no group) and never for a person who cannot arrange", () => {
    expect(pane).toMatch(/canManage && group\.id !== null \? \(\s*<button[\s\S]*?data-group-edit/);
    expect(pane).toContain("EditTopicGroupDialog");
    expect(pane).toContain("editing && group.id !== null");
  });

  it("the dialog saves the name and the emoji through PATCH /api/groups/:id and tells the screen what to show", () => {
    expect(hook).toContain("apiPatch(`/api/groups/${encodeURIComponent(groupId)}`, rest)");
    expect(hook).toContain("return { create, update, move, reorder, picture, clearPicture, refresh }");
    expect(dialogs).toContain("update.mutate(");
    expect(dialogs).toContain("onSaved?.({ name: clean, emoji: nextEmoji })");
    // an empty box takes the picture off (null), it never sends an empty string
    expect(dialogs).toContain('emoji.trim() === "" ? null : emoji.trim()');
  });

  it("both lists that open a group keep the new name and picture", () => {
    expect(SRC("components/chat/v2/list/chat-list-column.tsx")).toContain("onEdited={(next) => setTopicGroup((open) => (open ? { ...open, ...next } : open))}");
    expect(SRC("components/chat/v2/forum/forum-view.tsx")).toContain("onEdited={(next) => setOpen((now) => (now ? { ...now, ...next } : now))}");
  });

  it("the new-group dialog uses the same choices, and every word is in the dictionary", () => {
    expect(dialogs).toContain('<EmojiChoices id="new-group-emoji"');
    expect(dialogs).toContain('<EmojiChoices id="edit-group-emoji"');
    for (const key of ["chatgrp.edit", "chatgrp.edit_title", "chatgrp.save", "chatgrp.emoji", "chatgrp.name"]) expect(AR[key], key).toBeTruthy();
  });
});
