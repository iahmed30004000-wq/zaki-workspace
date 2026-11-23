import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { folderSwipe, nextTab } from "@/lib/chat/v2/folder-swipe";
import { moveFolder } from "@/lib/chat/folders";
import type { ChatFolderDef } from "@/lib/chat/prefs";

/**
 * «تبويبات المجلدات» (the owner's item 7): the folders are ONE strip of tabs above the list, on the phone and on the computer (the 72 px column beside the list is gone); a swipe on the list
 * switches folders; a long press on a tab of the person's own offers «تقديم» and «تأخير» besides «تعديل» and «حذف». The rules of the swipe are pure.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const base = { dx: 0, dy: 4, ms: 200, rtl: true, onActionRow: false, rowOpen: false, fromStartEdge: false };

describe("the swipe between folders", () => {
  it("toward the START edge goes to the NEXT folder, toward the END edge to the PREVIOUS one (mirrored in a left-to-right page)", () => {
    expect(folderSwipe({ ...base, dx: 90 })).toBe("next"); // a finger moving right, in the right-to-left page
    expect(folderSwipe({ ...base, dx: -90 })).toBe("prev");
    expect(folderSwipe({ ...base, rtl: false, dx: -90 })).toBe("next");
    expect(folderSwipe({ ...base, rtl: false, dx: 90 })).toBe("prev");
  });

  it("a short move, a slow drag, a mostly vertical one (a scroll) and a tap are no swipe", () => {
    expect(folderSwipe({ ...base, dx: 30 })).toBeNull();
    expect(folderSwipe({ ...base, dx: 120, ms: 1500 })).toBeNull();
    expect(folderSwipe({ ...base, dx: 100, dy: 90 })).toBeNull();
    expect(folderSwipe({ ...base, dx: 0, dy: 0 })).toBeNull();
  });

  it("never steals the swipe BACK (it starts at the start edge) nor the closing of an open row", () => {
    expect(folderSwipe({ ...base, dx: -90, fromStartEdge: true })).toBeNull();
    expect(folderSwipe({ ...base, dx: 90, fromStartEdge: true })).toBeNull();
    expect(folderSwipe({ ...base, dx: 90, rowOpen: true })).toBeNull();
    expect(folderSwipe({ ...base, dx: -90, rowOpen: true })).toBeNull();
  });

  it("on a row that has its own swipe actions the start-edge direction is the row's (pin, mute, archive); the other direction still switches", () => {
    expect(folderSwipe({ ...base, dx: 90, onActionRow: true })).toBeNull();
    expect(folderSwipe({ ...base, dx: -90, onActionRow: true })).toBe("prev");
  });

  it("nextTab picks the neighbour and stops at both ends", () => {
    const tabs = [{ key: "all" }, { key: "unread" }, { key: "dm" }];
    expect(nextTab(tabs, "all", "next")?.key).toBe("unread");
    expect(nextTab(tabs, "dm", "next")).toBeNull();
    expect(nextTab(tabs, "all", "prev")).toBeNull();
    expect(nextTab(tabs, "dm", "prev")?.key).toBe("unread");
    expect(nextTab(tabs, "gone", "next")).toBeNull();
  });
});

const folder = (id: string): ChatFolderDef => ({ id, name: id, include: { conversationIds: [], spaceIds: [] }, exclude: {} });

describe("moving a tab", () => {
  it("one place earlier or later; at the ends nothing moves (the very same list comes back)", () => {
    const list = [folder("a"), folder("b"), folder("c")];
    expect(moveFolder(list, "b", -1).map((f) => f.id)).toEqual(["b", "a", "c"]);
    expect(moveFolder(list, "b", 1).map((f) => f.id)).toEqual(["a", "c", "b"]);
    expect(moveFolder(list, "a", -1)).toBe(list);
    expect(moveFolder(list, "c", 1)).toBe(list);
    expect(moveFolder(list, "zzz", 1)).toBe(list);
  });
});

describe("the screens", () => {
  const column = read("src/components/chat/v2/list/chat-list-column.tsx");
  it("the folders are the strip of tabs above the list on the computer too: no column beside it", () => {
    expect(column).not.toContain("<FolderRail");
    expect(column).toMatch(/\{rail \? null : <FolderTabs folders=\{folders\}/);
    expect(column).toContain("useFolderSwipe");
  });

  it("a long press on a tab of the person's own offers earlier / later besides edit and delete, each one save of the company's list", () => {
    const inline = read("src/components/chat/v2/list/folder-inline.tsx");
    expect(inline).toContain("data-folder-menu-earlier");
    expect(inline).toContain("data-folder-menu-later");
    expect(inline).toContain("moveFolder(");
    for (const key of ["chatfolders.menu_earlier", "chatfolders.menu_later"]) expect(AR[key], key).toBeTruthy();
  });

  it("the app's side rail carries no chat folder (only the app's own places)", () => {
    for (const file of ["src/components/shell/rail.tsx", "src/components/shell/sidebar.tsx"]) expect(read(file)).not.toMatch(/FolderTabs|FolderRail|chat-folders|chatPrefs/);
  });
});
