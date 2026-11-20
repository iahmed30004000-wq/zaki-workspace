import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { SPACE_SETTINGS_TABS, parseSettingsTab, settingsHref, settingsTabLabelKey, settingsTabsFor, type SettingsFacts } from "@/components/space-settings/tabs";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/**
 * A2.2 — the pure rules of the space settings page (which tab is offered to whom, which address a tab has) and the source pins that need no database:
 * the old dialogs keep their props and their words, the page sits behind the switch, and no new string carries a Latin letter.
 */

const facts = (over: Partial<SettingsFacts> = {}): SettingsFacts => ({ external: false, manager: false, canArchive: false, canDelete: false, ...over });

describe("which tabs a person is offered", () => {
  it("the six tabs, in the order of the plan", () => {
    expect([...SPACE_SETTINGS_TABS]).toEqual(["general", "people", "teams", "chat", "work", "danger"]);
  });

  it("an external partner is offered nothing", () => {
    expect(settingsTabsFor(facts({ external: true, manager: true, canArchive: true, canDelete: true }))).toEqual([]);
  });

  it("a plain member reads the people and the «المقاطع», nothing else", () => {
    expect(settingsTabsFor(facts())).toEqual(["people", "teams"]);
    // the archive / delete flags mean nothing without managing the space
    expect(settingsTabsFor(facts({ canArchive: true, canDelete: true }))).toEqual(["people", "teams"]);
  });

  it("a manager gets every tab but «خطر» until they can archive or delete", () => {
    expect(settingsTabsFor(facts({ manager: true }))).toEqual(["general", "people", "teams", "chat", "work"]);
    expect(settingsTabsFor(facts({ manager: true, canArchive: true }))).toEqual(["general", "people", "teams", "chat", "work", "danger"]);
    expect(settingsTabsFor(facts({ manager: true, canDelete: true }))).toEqual(["general", "people", "teams", "chat", "work", "danger"]);
  });
});

describe("the address of a tab", () => {
  it("an unknown tab, or one the person is not offered, is the first offered tab; nobody offered anything gets null", () => {
    const offered = settingsTabsFor(facts());
    expect(parseSettingsTab("teams", offered)).toBe("teams");
    expect(parseSettingsTab("danger", offered)).toBe("people");
    expect(parseSettingsTab("nonsense", offered)).toBe("people");
    expect(parseSettingsTab(undefined, offered)).toBe("people");
    expect(parseSettingsTab(["work", "teams"], settingsTabsFor(facts({ manager: true })))).toBe("work");
    expect(parseSettingsTab("people", [])).toBeNull();
  });

  it("the first tab is the bare address, the others are ?tab=, and the id is escaped", () => {
    expect(settingsHref("abc")).toBe("/spaces/abc/settings");
    expect(settingsHref("abc", "general")).toBe("/spaces/abc/settings");
    expect(settingsHref("abc", "teams")).toBe("/spaces/abc/settings?tab=teams");
    expect(settingsHref("a b")).toBe("/spaces/a%20b/settings");
  });
});

describe("the words", () => {
  it("every tab has one label, Arabic; the third keeps today's word «المقاطع» (D-N4 is not answered)", () => {
    for (const tab of SPACE_SETTINGS_TABS) expect(AR[settingsTabLabelKey(tab)], tab).toBeTruthy();
    expect(AR["spset.tab.teams"]).toBe("المقاطع");
    expect(AR["spset.tab.general"]).toBe("عام");
    expect(AR["spset.tab.danger"]).toBe("خطر");
  });

  it("no spset string carries a Latin letter or a tanween on an alef", () => {
    const own = Object.entries(AR).filter(([key]) => key.startsWith("spset."));
    expect(own.length).toBeGreaterThan(20);
    for (const [key, value] of own) {
      expect(String(value), key).not.toMatch(/[A-Za-z]/);
      expect(String(value), key).not.toMatch(/ـاً/);
    }
  });
});

describe("the old dialogs keep working (the switch OFF) and the page sits behind the switch", () => {
  it("the edit button keeps its props and never reloads the page (F1.4)", () => {
    const source = read("src/components/workspace-edit-button.tsx");
    expect(source).toMatch(/workspaceId: string;\s*name: string;\s*description: string \| null;/);
    expect(source).not.toContain("location.reload");
    expect(source).toContain("router.refresh()");
  });

  it("the members and teams buttons are still dialogs, now drawing the same panels the tabs draw", () => {
    const members = read("src/components/workspace-members-button.tsx");
    const teams = read("src/components/workspace-teams-button.tsx");
    expect(members).toContain("<Modal");
    expect(members).toContain("WorkspaceMembersPanel");
    expect(teams).toContain("<Modal");
    expect(teams).toContain("WorkspaceTeamsPanel");
    expect(read("src/components/space-settings/people-panel.tsx")).toContain("data-ws-members-panel");
    expect(read("src/components/space-settings/teams-panel.tsx")).toContain("data-ws-teams-panel");
  });

  it("the page answers «not found» without the switch, and for a space the person cannot open", () => {
    const page = read("src/app/(app)/spaces/[id]/settings/page.tsx");
    expect(page).toContain('"controlPanelV2"');
    expect(page).toContain("notFound()");
    expect(page).toContain("pageActor");
  });

  it("the delete button keeps its confirmation by typed name and only adds an optional way out", () => {
    const source = read("src/components/space-delete-button.tsx");
    expect(source).toContain("confirmName: typed");
    expect(source).toContain("onDeleted");
    expect(source).toContain("typed.trim() !== name.trim()");
  });

  it("a space's card offers its settings only when the caller says the switch is on", () => {
    const source = read("src/components/spaces-board.tsx");
    expect(source).toContain("settingsLinks");
    expect(source).toContain("settingsHref(card.id");
  });

  it("the new components keep the guards: theme tokens only, no small text, no reload", () => {
    for (const file of ["people-panel", "teams-panel", "general-tab", "chat-tab", "work-tab", "danger-tab", "settings-tabs"]) {
      const source = read(`src/components/space-settings/${file}.tsx`);
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/text-\[1[01]px\]|bg-black|bg-white|text-white/);
      expect(source, file).not.toContain("location.reload");
    }
  });
});
