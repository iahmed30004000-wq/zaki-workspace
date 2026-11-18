import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";

/**
 * N1.4 — the glossary: ONE name per thing (docs/restructure/N1-navigation.md section 2).
 *
 * Only the fragments this step owns are rewritten (ar.json, ar.shell, ar.members, ar.spaces, ar.guide, ar.ui, ar.today, ar.nav-order,
 * ar.enums, plus the new ar.nav-v2). The other fragments keep their words until their own phase; the test says which words are still waiting
 * and why, so nobody believes the glossary is finished when it is not.
 */

const DIR = path.resolve(__dirname, "../src/lib/i18n");
const OWNED = ["ar.json", "ar.shell.json", "ar.members.json", "ar.spaces.json", "ar.guide.json", "ar.ui.json", "ar.today.json", "ar.nav-order.json", "ar.enums.json", "ar.nav-v2.json"];

const read = (file: string) => JSON.parse(readFileSync(path.join(DIR, file), "utf8")) as Record<string, string>;
const owned = OWNED.map((file) => ({ file, data: read(file) }));
const entries = owned.flatMap(({ file, data }) => Object.entries(data).map(([key, value]) => ({ file, key, value })));

/** The executable glossary: concept → the one name. */
const GLOSSARY: Record<string, string> = {
  "the people directory (a tab and the place of a person with no admin power)": "الناس",
  "an external guest": "ضيف خارجي",
  "a co-owner": "شريك (مالك)",
  "the org ADMIN rank": "مشرف",
  "a space's ADMIN": "مدير المساحة",
  "the LEAD rank": "قائد فريق",
  "/production": "الروتين اليومي",
  "the control panel (owner/admin)": "لوحة التحكم",
  "the personal panel": "لوحتي",
};

describe("one name per thing, in the fragments this step owns", () => {
  it("the people directory is «الناس», as a tab, as the page title and as the place of a person with no admin power", () => {
    expect(AR["nav.tab.team"]).toBe("الناس");
    expect(AR["teams.title"]).toBe("الناس");
    expect(AR["nav.place.people"]).toBe("الناس");
    expect(GLOSSARY["the people directory (a tab and the place of a person with no admin power)"]).toBe("الناس");
  });

  it("a person with the guide's first steps is sent to «الناس», not «الفريق»", () => {
    expect(AR["guide.first.add-person.hint"]).toContain("«الناس»");
    expect(AR["guide.first.add-person.hint"]).not.toContain("«الفريق»");
    expect(AR["guide.page.settings.next"]).toContain("«الناس»");
    expect(AR["guide.page.settings.next"]).not.toContain("«الفريق»");
  });

  it("an external guest is «ضيف خارجي», never «شريك خارجي» (a partner is the co-owner)", () => {
    expect(AR["members.rank_hint_guest"]).toContain("ضيف خارجي");
    expect(AR["members.caps_guest"]).toContain("الضيف الخارجي");
    for (const { file, key, value } of entries) expect(value, `${file} ${key}`).not.toContain("شريك خارجي");
    expect(AR["role.partner"]).toBe("شريك (مالك)");
  });

  it("the space's administrator is «مدير المساحة», never «مدير» alone", () => {
    expect(AR["ws.role_admin"]).toBe("مدير المساحة");
    expect(AR["ws.promote"]).toContain("مدير المساحة");
  });

  it("the LEAD rank keeps «قائد فريق»", () => {
    expect(AR["role.lead"]).toBe("قائد فريق");
  });

  it("the daily routine is «الروتين اليومي» everywhere in the fragments, never «الإنتاج اليومي»", () => {
    expect(AR["nav.production"]).toBe("الروتين اليومي");
    expect(AR["prod.title"]).toBe("الروتين اليومي");
    expect(AR["members.section.production"]).toBe("الروتين اليومي");
    expect(AR["members.cap.production.view.title"]).toContain("الروتين اليومي");
    expect(AR["production.routines_role_denied"]).toContain("الروتين اليومي");
    for (const { file, key, value } of entries) expect(value, `${file} ${key}`).not.toContain("الإنتاج اليومي");
  });

  it("a project's kanban is «لوحة المشروع»; «اللوحات» alone is the place of the card spaces", () => {
    expect(AR["proj.boards"]).toBe("لوحات المشروع");
    expect(AR["proj.cardLine"]).toContain("لوحات المشروع");
    expect(AR["members.cap.tasks.view.hint"]).toContain("لوحة المشروع");
    expect(AR["nav.place.cards"]).toBe("اللوحات");
  });

  it("the dashboards: «لوحة التحكم» and «لوحتي»; «لوحة المتابعة» is retired from the guide", () => {
    expect(AR["guide.page.owner-board.what"]).toContain("لوحة التحكم");
    for (const { file, key, value } of entries) expect(value, `${file} ${key}`).not.toContain("لوحة المتابعة");
    expect(AR["nav.tab.controlPanel"]).toBe("لوحة التحكم");
    expect(AR["nav.tab.boardSelf"]).toBe("لوحتي");
  });

  it("the glossary names are all spelled the way the dictionary spells them", () => {
    expect(GLOSSARY["a space's ADMIN"]).toBe(AR["ws.role_admin"]);
    expect(GLOSSARY["the LEAD rank"]).toBe(AR["role.lead"]);
    expect(GLOSSARY["/production"]).toBe(AR["nav.production"]);
    expect(GLOSSARY["the control panel (owner/admin)"]).toBe(AR["nav.tab.controlPanel"]);
    expect(GLOSSARY["the personal panel"]).toBe(AR["nav.tab.boardSelf"]);
    expect(GLOSSARY["a co-owner"]).toBe(AR["role.partner"]);
  });
});

describe("words still waiting (recorded, not forgotten)", () => {
  // «المقاطع» -> «الفرق» is D-N4, still unanswered by the owner: DECISIONS.md says a decision that changes an existing test is applied only after
  // the answer, and tests/space-sections-copy.test.ts pins «المقاطع».
  it.todo("«المقاطع» becomes «الفرق» (D-N4) after the owner's answer, together with tests/space-sections-copy.test.ts");
  // tests/enums.test.ts and tests/members-ui-render.test.ts pin «مشرف» for the ADMIN rank.
  it.todo("the ADMIN rank becomes «مشرف عام» together with tests/enums.test.ts and tests/members-ui-render.test.ts");
  // tests/wording-arabic.test.ts pins «الشريك الخارجي» in guide.page.internal.what.
  it.todo("guide.page.internal.what says «الضيف الخارجي» together with tests/wording-arabic.test.ts");

  it("the three words above are still what the pinning tests say (so this list cannot go stale unnoticed)", () => {
    expect(AR["spaceteams.title"]).toBe("المقاطع");
    expect(AR["role.admin"]).toBe("مشرف");
    expect(AR["guide.page.internal.what"]).toContain("الشريك الخارجي");
  });
});

describe("ar.nav-v2.json (all the N1 strings)", () => {
  const mine = read("ar.nav-v2.json");

  it("holds no key that another fragment also holds (a later file would silently win)", () => {
    const others = new Set(
      readdirSync(DIR)
        .filter((f) => /^ar(\.[a-z0-9-]+)?\.json$/.test(f) && f !== "ar.nav-v2.json")
        .flatMap((f) => Object.keys(read(f))),
    );
    for (const key of Object.keys(mine)) expect(others.has(key), key).toBe(false);
  });

  it("is Arabic only: no Latin letters, no Arabic-Indic digits, no tanween on alef", () => {
    for (const [key, value] of Object.entries(mine)) {
      expect(value, key).not.toMatch(/[A-Za-z]/);
      expect(value, key).not.toMatch(/[٠-٩۰-۹]/);
      expect(value, key).not.toMatch(/ـاً/);
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("carries the new map's names", () => {
    expect(mine["nav.tab.requests"]).toBe("الطلبات");
    expect(mine["nav.tab.more"]).toBe("المزيد");
    expect(mine["nav.place.people"]).toBe("الناس");
  });
});
