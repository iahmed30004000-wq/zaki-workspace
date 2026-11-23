import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { holdersAfter } from "@/lib/tasks/holders-after";

/**
 * «مهامه المفتوحة»: the dialog speaks only to `/api/tasks/bulk-assign`, is offered right after a removal (a suspension, an offboarding, a person taken out of a space) and by a button
 * on a person who is not active, and every word it shows is in the Arabic dictionary. The pure rule of who holds a card afterwards is pinned here without a database.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("the dialog", () => {
  const dialog = read("src/components/members/open-cards-dialog.tsx");

  it("asks the list and sends the action through the one route", () => {
    expect(dialog).toContain("/api/tasks/bulk-assign?from=");
    expect(dialog).toContain('apiPost<BulkResult>("/api/tasks/bulk-assign"');
  });

  it("every key it uses is in the dictionary", () => {
    const keys = [...dialog.matchAll(/t\("(bulk\.[a-z_]+)"/g)].map((m) => m[1] as string);
    expect(keys.length).toBeGreaterThan(8);
    for (const key of new Set(keys)) expect(AR[key], key).toBeTruthy();
  });

  it("is drawn from the member card (after a suspension or offboarding, and by a button) and from the space's people list (after a removal)", () => {
    const sheet = read("src/components/members/member-sheet.tsx");
    expect(sheet).toContain("OpenCardsDialog");
    expect(sheet).toContain('setCards("auto")');
    expect(sheet).toContain('setCards("manual")');
    const people = read("src/components/space-settings/people-panel.tsx");
    expect(people).toContain("<OpenCardsDialog");
    expect(people).toContain("workspaceId={workspaceId}");
    expect(people).toContain("silentWhenEmpty");
  });
});

describe("who holds a card afterwards", () => {
  it("the first stays first, the newcomer takes the place, nobody is listed twice", () => {
    const row = { assigneeId: "alice", coAssignees: [{ userId: "bob" }] };
    expect(holdersAfter(row, "alice", "carol")).toEqual(["carol", "bob"]);
    expect(holdersAfter(row, "bob", "carol")).toEqual(["alice", "carol"]);
    expect(holdersAfter(row, "alice", "bob")).toEqual(["bob"]);
    expect(holdersAfter(row, "alice", null)).toEqual(["bob"]);
    expect(holdersAfter({ assigneeId: "alice", coAssignees: [] }, "alice", null)).toEqual([]);
  });
});
