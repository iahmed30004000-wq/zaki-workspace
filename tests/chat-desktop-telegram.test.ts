import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import {
  clampListWidth,
  isRailWidth,
  LIST_WIDTH_DEFAULT,
  LIST_WIDTH_MAX,
  LIST_WIDTH_MIN,
  LIST_RAIL_WIDTH,
  readListWidth,
  saveListWidth,
  widthFromKey,
  widthFromPointer,
} from "@/lib/chat/v2/list-width";

/**
 * The owner's chat on a computer, the way Telegram's is (2026-11-22): a button beside the header's actions that shows and hides the profile panel on the side.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

describe("the profile panel's own button in the conversation header", () => {
  const header = read("src/components/chat/v2/pane/pane-header.tsx");

  it("a real button that shows and hides the panel: it toggles `infoOpen`, says whether it is open, and is a computer's button (the phone's panel is a screen of its own)", () => {
    const at = header.indexOf("data-header-info-toggle");
    expect(at).toBeGreaterThan(-1);
    const button = header.slice(header.lastIndexOf("<button", at), header.indexOf("</button>", at));
    expect(button).toContain("onClick={a.toggleInfo}");
    expect(button).toContain("aria-pressed={a.infoOpen}");
    expect(button).toContain("max-md:hidden");
    expect(button).toContain("PanelRight");
  });

  it("it sits after the search and the call, before «⋮»", () => {
    const search = header.indexOf("data-header-search");
    const toggle = header.indexOf("data-header-info-toggle");
    const menu = header.indexOf("data-header-menu");
    expect(search).toBeLessThan(toggle);
    expect(toggle).toBeLessThan(menu);
  });

  it("it has words in Arabic, and they say what the press does", () => {
    expect(AR["chatprof.header.toggle"]).toBeTruthy();
    expect(AR["chatprof.header.toggle"]).toContain("البروفايل");
  });
});


describe("the list's width: dragged wide like Telegram's, and narrow it becomes a rail of pictures", () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  };

  it("the numbers: the rail is 72, the narrowest list 300, the widest 720 (it was 480)", () => {
    expect(LIST_RAIL_WIDTH).toBe(72);
    expect(LIST_WIDTH_MIN).toBe(300);
    expect(LIST_WIDTH_MAX).toBe(720);
    expect(LIST_WIDTH_DEFAULT).toBe(360);
  });

  it("a drag that is too narrow for a list snaps to the rail, one in between is a list, a huge one stops at the widest", () => {
    expect(clampListWidth(40)).toBe(LIST_RAIL_WIDTH);
    expect(clampListWidth(150)).toBe(LIST_RAIL_WIDTH);
    expect(clampListWidth(230)).toBe(LIST_WIDTH_MIN);
    expect(clampListWidth(500)).toBe(500);
    expect(clampListWidth(5000)).toBe(LIST_WIDTH_MAX);
    expect(clampListWidth(Number.NaN)).toBe(LIST_WIDTH_DEFAULT);
    expect(isRailWidth(LIST_RAIL_WIDTH)).toBe(true);
    expect(isRailWidth(LIST_WIDTH_MIN)).toBe(false);
  });

  it("the pointer decides the width the same way (right-to-left: from the right edge)", () => {
    const rect = { left: 100, right: 1100 };
    expect(widthFromPointer(1050, rect, true)).toBe(LIST_RAIL_WIDTH);
    expect(widthFromPointer(600, rect, true)).toBe(500);
  });

  it("the keyboard: narrowing a 300 list gives the rail, widening the rail gives 300; End is the widest, Home the rail", () => {
    expect(widthFromKey(300, "ArrowRight", true)).toBe(LIST_RAIL_WIDTH);
    expect(widthFromKey(LIST_RAIL_WIDTH, "ArrowLeft", true)).toBe(LIST_WIDTH_MIN);
    expect(widthFromKey(400, "End", true)).toBe(LIST_WIDTH_MAX);
    expect(widthFromKey(400, "Home", true)).toBe(LIST_RAIL_WIDTH);
  });

  it("the rail is remembered on this device (a two-digit value is accepted when it is the rail's)", () => {
    const s = store();
    saveListWidth(LIST_RAIL_WIDTH, s);
    expect(readListWidth(s)).toBe(LIST_RAIL_WIDTH);
    saveListWidth(640, s);
    expect(readListWidth(s)).toBe(640);
    s.setItem("zk-chat-list-w", "55");
    expect(readListWidth(s)).toBe(LIST_WIDTH_DEFAULT);
  });
});

describe("the list as a rail, and the «المؤرشفة» row", () => {
  const column = read("src/components/chat/v2/list/chat-list-column.tsx");
  const row = read("src/components/chat/v2/list/chat-row.tsx");

  it("the column knows when it is a rail and then draws pictures only: no search header, no folder column", () => {
    expect(column).toContain("isRailWidth(width)");
    expect(column).toContain("rail ? null : <FolderRail");
    expect(column).toMatch(/rail \? null : \(\s*<ListHeader/);
  });

  it("a row in rail form is the picture, a number for what is unread, the name as its tooltip and label, and still a link", () => {
    expect(row).toContain("data-rail");
    expect(row).toContain("data-rail-badge");
    expect(row).toMatch(/title=\{row\.title\}/);
    expect(row).toContain("rail?: boolean");
  });

  it("«المحادثات المؤرشفة»: a row at the top of the list with its count (only when there are archived chats, no search, folder «الكل»); a press opens the archive folder", () => {
    expect(column).toContain("data-archived-entry");
    expect(column).toMatch(/archived && !rail && !words && folder === "all"/);
    expect(column).toContain('setFolderKey("archived")');
    expect(AR["chatui.list.archived_entry"]).toBe("المحادثات المؤرشفة");
  });
});
