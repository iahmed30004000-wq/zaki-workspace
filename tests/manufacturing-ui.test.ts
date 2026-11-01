import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/manufacturing",
}));

import { AR } from "@/lib/i18n/dict";
import { MfgView } from "@/components/manufacturing/mfg-view";
import { MaterialPage } from "@/components/manufacturing/material-page";
import { MfgTabs } from "@/components/manufacturing/ui";
import { ToastProvider } from "@/components/ui/toast";
import { materialsCsv } from "@/lib/manufacturing/csv";
import type { CountItem, MaterialDetail, MaterialListItem, MfgOverview } from "@/lib/manufacturing/view";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const t = (key: string) => AR[key] ?? key;

/** The rules every screen of the feature keeps: theme tokens only, logical (RTL-safe) directions, no raw hex. */
function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((x) => PALETTE_COLOUR.test(x)), "palette colours").toEqual([]);
  expect(tokens.filter((x) => PHYSICAL_UTILITY.test(x)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
}

const showCost = { currency: "JOD", valueMinor: 260_000, averageText: "1.300", formula: { value: "260.000", qty: "200", average: "1.300" } };
const material = (over: Partial<MaterialListItem> = {}): MaterialListItem => ({
  id: "m1",
  name: "علب وسط",
  code: "001",
  baseUnit: "علبة",
  balanceMicro: 200_000_000,
  lowStockMicro: null,
  low: false,
  archived: false,
  pendingCount: false,
  unpricedMicro: 0,
  cost: null,
  ...over,
});
const overview = (over: Partial<MfgOverview> = {}): MfgOverview => ({ spaceId: "s1", spaceName: "المصنع", canEdit: true, canCost: false, materials: [material()], suppliers: [], pending: [], ...over });

const wrap = (el: ReturnType<typeof createElement>) => render(createElement(ToastProvider, null, el));

describe("the front page", () => {
  it("shows the materials with their balance and the honest note that this is stock and cost, not accounting", () => {
    const markup = wrap(createElement(MfgView, { initial: overview() }));
    const text = textOf(markup);
    expect(text).toContain("علب وسط");
    expect(text).toContain("200");
    expect(text).toContain(t("mfg.not_accounting"));
    expect(text).toContain(t("mfg.not_accounting_fix"));
    expect(markup).toContain("⚠️");
    expect(markup).toContain("🔧");
    expectClean(markup);
  });

  it("a low material gets the ⚠️ with its 🔧 under it, on the row and in the banner", () => {
    const markup = wrap(createElement(MfgView, { initial: overview({ materials: [material({ low: true, lowStockMicro: 300_000_000 })] }) }));
    const text = textOf(markup);
    expect(text).toContain(t("mfg.low"));
    expect(text).toContain(t("mfg.low_fix_short"));
    expect(text).toContain(t("mfg.low_fix"));
    expect(text).toContain("⚠️");
    expect(text).toContain("🔧");
  });

  it("without the cost no price, no value and no average is drawn, and the person is told why", () => {
    const text = textOf(wrap(createElement(MfgView, { initial: overview({ canCost: false }) })));
    expect(text).toContain(t("mfg.no_cost_note"));
    expect(text).not.toContain(t("mfg.value"));
  });

  it("with the cost the value of the stock is drawn", () => {
    const text = textOf(wrap(createElement(MfgView, { initial: overview({ canCost: true, materials: [material({ cost: showCost })] }) })));
    expect(text).toContain(t("mfg.value"));
    expect(text).toContain("260.000");
    expect(text).toContain(t("mfg.cur.JOD"));
  });

  it("a viewer is told it is read-only and gets no add button", () => {
    const markup = wrap(createElement(MfgView, { initial: overview({ canEdit: false }) }));
    expect(textOf(markup)).toContain(t("mfg.read_only"));
    expect(textOf(markup)).not.toContain(t("mfg.material_new"));
  });

  it("an empty ledger says what to do next", () => {
    const text = textOf(wrap(createElement(MfgView, { initial: overview({ materials: [] }) })));
    expect(text).toContain(t("mfg.empty"));
    expect(text).toContain(t("mfg.empty_hint"));
  });

  it("a stocktake waits for a second person: the counter sees the warning, a second editor sees the two buttons", () => {
    const base: CountItem = { id: "c1", materialId: "m1", materialName: "علب وسط", baseUnit: "علبة", countedMicro: 8_000_000, expectedMicro: 10_000_000, diffMicro: -2_000_000, note: null, status: "PENDING", countedBy: "سمير", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: new Date().toISOString(), canDecide: false };
    const button = (label: string) => `>${label}</button>`;
    const counter = wrap(createElement(MfgView, { initial: overview({ pending: [base] }) }));
    expect(textOf(counter)).toContain(t("mfg.needs_second"));
    expect(counter).not.toContain(button(t("mfg.approve")));
    const second = wrap(createElement(MfgView, { initial: overview({ pending: [{ ...base, canDecide: true }] }) }));
    expect(second).toContain(button(t("mfg.approve")));
    expect(second).toContain(button(t("mfg.reject")));
    expect(textOf(second)).not.toContain(t("mfg.needs_second"));
  });
});

describe("the tabs", () => {
  it("«اللوحات» and «مخزون التصنيع», the current one marked", () => {
    const markup = render(createElement(MfgTabs, { current: "stock" }));
    expect(textOf(markup)).toContain(t("nav.place.cards"));
    expect(textOf(markup)).toContain(t("nav.tab.mfg"));
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('href="/manufacturing"');
    expect(markup).toContain('href="/cards"');
  });
});

const detail = (over: Partial<MaterialDetail> = {}): MaterialDetail => ({
  id: "m1",
  spaceId: "s1",
  spaceName: "المصنع",
  name: "علب وسط",
  code: null,
  baseUnit: "علبة",
  lowStockMicro: null,
  low: false,
  archived: false,
  balanceMicro: 72_000_000,
  unpricedMicro: 0,
  units: [{ id: "u1", label: "كرتونة", num: 24, den: 1, archived: false }],
  suppliers: [],
  canEdit: true,
  canCost: false,
  cost: null,
  lots: [],
  movements: [],
  counts: [],
  ...over,
});

describe("one material", () => {
  it("shows the balance as the sum of the movements, in the base unit and in each conversion", () => {
    const text = textOf(wrap(createElement(MaterialPage, { initial: detail() })));
    expect(text).toContain(t("mfg.balance_formula"));
    expect(text).toContain("72");
    expect(text).toContain("3 كرتونة");
    expect(text).toContain("1 كرتونة = 24 علبة");
  });

  it("the formula box shows the weighted average with how it was reached, only with the cost", () => {
    const withCost = textOf(wrap(createElement(MaterialPage, { initial: detail({ canCost: true, cost: showCost }) })));
    expect(withCost).toContain("260.000 ÷ 200 = 1.300");
    expect(withCost).toContain(t("mfg.formula_explain"));
    const without = textOf(wrap(createElement(MaterialPage, { initial: detail() })));
    expect(without).not.toContain("260.000");
    expect(without).not.toContain(t("mfg.formula"));
    expect(without).toContain(t("mfg.no_cost_note"));
  });

  it("a lot without a photo is flagged with its fix; one with a photo links to the ledger's own door", () => {
    const lot = (over: Record<string, unknown>) => ({
      id: "l1",
      receivedOn: "2026-10-30",
      expiresOn: null,
      qtyMicro: 72_000_000,
      enteredQtyMicro: 3_000_000,
      enteredUnitLabel: "كرتونة",
      supplier: null,
      note: null,
      proof: null,
      proofNote: "الإيصال ضاع",
      createdBy: "سمير",
      createdAt: new Date().toISOString(),
      cost: null,
      reversed: false,
      costPending: false,
      costedLater: null,
      canFillCost: false,
      correctionCount: 0,
      priceHistory: [],
      canCorrectPrice: false,
      ...over,
    });
    const flagged = textOf(wrap(createElement(MaterialPage, { initial: detail({ lots: [lot({})] }) })));
    expect(flagged).toContain(t("mfg.no_proof"));
    expect(flagged).toContain("الإيصال ضاع");
    expect(flagged).toContain(t("mfg.no_proof_fix"));
    const photo = wrap(createElement(MaterialPage, { initial: detail({ lots: [lot({ proof: { id: "f1", name: "r.jpg", mimeType: "image/jpeg", url: "/api/files/f1/raw" }, proofNote: null })] }) }));
    expect(photo).toContain('href="/api/files/f1/raw"');
    expect(textOf(photo)).not.toContain(t("mfg.no_proof"));
  });

  it("every movement can be reversed once, never edited: a reverse button and no edit button", () => {
    const move = { id: "g1", kind: "ISSUE" as const, qtyMicro: -4_000_000, reason: "صرف للتشغيل", lotId: null, reversesId: null, reversedById: null, createdBy: "سمير", createdAt: new Date().toISOString(), valueMinor: null, canReverse: true };
    const text = textOf(wrap(createElement(MaterialPage, { initial: detail({ movements: [move, { ...move, id: "g2", reversedById: "g3", canReverse: false }] }) })));
    expect(text).toContain(t("mfg.movements_hint"));
    expect(text).toContain(t("mfg.kind.ISSUE"));
    expect(text).toContain(t("mfg.reverse"));
    expect(text).toContain(t("mfg.reversed"));
  });

  it("a viewer has no forms; a keeper without the cost cannot receive and is told why", () => {
    const viewer = wrap(createElement(MaterialPage, { initial: detail({ canEdit: false }) }));
    expect(textOf(viewer)).toContain(t("mfg.read_only"));
    expect(viewer).not.toContain(`>${t("mfg.issue")}</button>`);
    const keeper = wrap(createElement(MaterialPage, { initial: detail({ canEdit: true, canCost: false }) }));
    expect(keeper).toContain(`>${t("mfg.issue")}</button>`);
    expect(keeper).not.toContain(`>${t("mfg.receive")}</button>`);
    expect(textOf(keeper)).toContain(t("mfg.receive_needs_cost"));
    const buyer = wrap(createElement(MaterialPage, { initial: detail({ canEdit: true, canCost: true, cost: showCost }) }));
    expect(buyer).toContain(`>${t("mfg.receive")}</button>`);
  });

  it("is clean of palette colours, physical directions and raw hex", () => {
    expectClean(wrap(createElement(MaterialPage, { initial: detail({ canCost: true, cost: showCost, low: true, lowStockMicro: 100_000_000 }) })));
    expectClean(wrap(createElement(MfgView, { initial: overview({ canCost: true, materials: [material({ cost: showCost, low: true })] }) })));
  });
});

describe("the CSV a screen links to is built from what the viewer reads", () => {
  it("has the price columns only when the viewer holds the cost", () => {
    const say = (key: string) => AR[key] ?? key;
    const plain = materialsCsv({ canCost: false, materials: [material()] }, say);
    expect(plain).not.toContain(t("mfg.csv.value"));
    expect(plain).toContain(t("mfg.csv.balance"));
    const priced = materialsCsv({ canCost: true, materials: [material({ cost: showCost })] }, say);
    expect(priced).toContain(t("mfg.csv.average"));
    expect(priced).toContain("260.000");
    // a typed name that starts with a formula character is neutralised
    expect(materialsCsv({ canCost: false, materials: [material({ name: "=1+1" })] }, say)).toContain("'=1+1");
  });
});

describe("it is wired in, and only where it should be", () => {
  it("a manufacturing space shows the tab on the cards page; the menu has no new place for it", () => {
    const cards = read("src/app/(app)/cards/page.tsx");
    expect(cards).toContain('space.layout === "MANUFACTURING"');
    expect(cards).toContain("manufacturing.view");
    expect(cards).toContain("mfgLedger");
    expect(cards).toContain("stockTab={stockTab}");
    const places = read("src/lib/nav/places.ts");
    expect(places).toContain('owns: ["/manufacturing"]');
  });

  it("both pages answer «not found» to a partner and to a person without the capability, before reading anything", () => {
    for (const file of ["src/app/(app)/manufacturing/page.tsx", "src/app/(app)/manufacturing/materials/[id]/page.tsx"]) {
      const source = read(file);
      expect(source, file).toContain("pageActor()");
      expect(source, file).toMatch(/actor\.isExternal \|\| !actorCan\(actor, "manufacturing\.view"\)\) notFound\(\)/);
      expect(source, file).not.toContain("currentUser(");
    }
  });
});
