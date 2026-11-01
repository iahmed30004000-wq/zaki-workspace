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
  usePathname: () => "/manufacturing/orders",
}));

import { AR } from "@/lib/i18n/dict";
import { MaterialPage } from "@/components/manufacturing/material-page";
import { OrdersPage } from "@/components/manufacturing/orders-view";
import { RecipesPage } from "@/components/manufacturing/recipes-view";
import { ReportsPage } from "@/components/manufacturing/reports-view";
import { MfgSubTabs, MfgTabs } from "@/components/manufacturing/ui";
import { ToastProvider } from "@/components/ui/toast";
import { reportCsv } from "@/lib/manufacturing/csv";
import type { OrderItem, OrdersView, RecipesView, ReportsView } from "@/lib/manufacturing/production-view";
import type { MaterialDetail } from "@/lib/manufacturing/view";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const t = (key: string) => AR[key] ?? key;
const wrap = (el: ReturnType<typeof createElement>) => render(createElement(ToastProvider, null, el));

function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((x) => PALETTE_COLOUR.test(x)), "palette colours").toEqual([]);
  expect(tokens.filter((x) => PHYSICAL_UTILITY.test(x)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
}

describe("the tabs of the area", () => {
  it("stock · recipes · orders · reports are tabs of this one area, not places of the menu", () => {
    const markup = render(createElement(MfgSubTabs, { current: "orders" }));
    const text = textOf(markup);
    for (const key of ["mfg.sub.materials", "mfg.sub.recipes", "mfg.sub.orders", "mfg.sub.reports"]) expect(text).toContain(t(key));
    expect(markup).toContain('href="/manufacturing/recipes"');
    expect(markup).toContain('href="/manufacturing/orders"');
    expect(markup).toContain('href="/manufacturing/reports"');
    expect(markup).toContain('aria-current="page"');
    // the first row is unchanged and the second only appears when asked for
    expect(render(createElement(MfgTabs, { current: "stock" }))).not.toContain("/manufacturing/recipes");
    expect(render(createElement(MfgTabs, { current: "stock", sub: "recipes" }))).toContain("/manufacturing/recipes");
    expect(read("src/lib/nav/places.ts")).toContain('owns: ["/manufacturing"]');
  });
});

const detail = (over: Partial<MaterialDetail> = {}): MaterialDetail => ({
  id: "m1",
  spaceId: "s1",
  spaceName: "المصنع",
  name: "طحين",
  code: null,
  baseUnit: "غرام",
  lowStockMicro: null,
  low: false,
  archived: false,
  balanceMicro: 200_000_000,
  unpricedMicro: 0,
  units: [],
  suppliers: [],
  canEdit: true,
  canCost: false,
  cost: null,
  lots: [],
  movements: [],
  counts: [],
  ...over,
});
const lot = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  receivedOn: "2026-10-30",
  expiresOn: null,
  qtyMicro: 100_000_000,
  enteredQtyMicro: 100_000_000,
  enteredUnitLabel: "غرام",
  supplier: null,
  note: null,
  proof: null,
  proofNote: "الإيصال ضاع",
  createdBy: "سمير",
  createdAt: new Date().toISOString(),
  cost: null,
  reversed: false,
  costPending: true,
  costedLater: null,
  canFillCost: false,
  correctionCount: 0,
  priceHistory: [],
  canCorrectPrice: false,
  ...over,
});
const showCost = { currency: "JOD", valueMinor: 1_000, averageText: "0.020", formula: { value: "1.000", qty: "50", average: "0.020" } };

describe("a receipt without a price", () => {
  it("a keeper without the cost has a «receive without a price» button, and the form says what that means with its fix", () => {
    const keeper = wrap(createElement(MaterialPage, { initial: detail({ canEdit: true, canCost: false }) }));
    expect(keeper).toContain(`>${t("mfg.receive_unpriced")}</button>`);
    expect(keeper).not.toContain(`>${t("mfg.receive")}</button>`);
    const buyer = wrap(createElement(MaterialPage, { initial: detail({ canEdit: true, canCost: true, cost: showCost }) }));
    expect(buyer).toContain(`>${t("mfg.receive")}</button>`);
    expect(buyer).not.toContain(`>${t("mfg.receive_unpriced")}</button>`);
    // the strings that carry the warning and its fix exist, and are Arabic
    for (const key of ["mfg.unpriced_warn", "mfg.unpriced_fix", "mfg.lot_unpriced", "mfg.lot_unpriced_fix", "mfg.lot_unpriced_fix_cost", "mfg.cost_once_warn", "mfg.cost_once_fix"]) {
      expect(AR[key], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("a lot without a price is flagged ⚠️ with its 🔧 for everybody; only a cost holder gets the button that fills it, and no price is shown for it", () => {
    const flagged = wrap(createElement(MaterialPage, { initial: detail({ unpricedMicro: 100_000_000, lots: [lot()] }) }));
    const text = textOf(flagged);
    expect(text).toContain(t("mfg.lot_unpriced"));
    expect(text).toContain(t("mfg.lot_unpriced_fix"));
    expect(text).toContain("⚠️");
    expect(text).toContain("🔧");
    expect(flagged).not.toContain(`>${t("mfg.cost_fill")}</button>`);
    const buyer = wrap(createElement(MaterialPage, { initial: detail({ canCost: true, cost: showCost, unpricedMicro: 100_000_000, lots: [lot({ canFillCost: true })] }) }));
    expect(buyer).toContain(`>${t("mfg.cost_fill")}</button>`);
    expect(textOf(buyer)).toContain(t("mfg.lot_unpriced_fix_cost"));
    // the average box says the unpriced stock is outside it
    expect(textOf(buyer)).toContain(AR["mfg.average_excludes"]!.replace("{qty}", "100").replace("{unit}", "غرام"));
    // once priced, the flag is gone and who priced it is named (never the price, to anybody who may not read it)
    const later = textOf(wrap(createElement(MaterialPage, { initial: detail({ lots: [lot({ costPending: false, costedLater: { by: "سمير", at: new Date().toISOString() } })] }) })));
    expect(later).not.toContain(t("mfg.lot_unpriced"));
    expect(later).toContain("سمير");
  });
});

const recipesView = (over: Partial<RecipesView> = {}): RecipesView => ({
  spaceId: "s1",
  spaceName: "المصنع",
  canEdit: true,
  canCost: false,
  recipes: [
    {
      id: "r1",
      archived: false,
      current: {
        id: "v2",
        version: 2,
        name: "برطمان كريم",
        outputUnit: "برطمان",
        note: null,
        createdBy: "سمير",
        createdAt: new Date().toISOString(),
        lines: [{ id: "l1", materialId: "m1", materialName: "طحين", baseUnit: "غرام", qtyMicro: 30_000_000, enteredQtyMicro: 30_000_000, enteredUnitLabel: "غرام", materialArchived: false }],
      },
      versions: [
        {
          id: "v2",
          version: 2,
          name: "برطمان كريم",
          outputUnit: "برطمان",
          note: null,
          createdBy: "سمير",
          createdAt: new Date().toISOString(),
          lines: [{ id: "l1", materialId: "m1", materialName: "طحين", baseUnit: "غرام", qtyMicro: 30_000_000, enteredQtyMicro: 30_000_000, enteredUnitLabel: "غرام", materialArchived: false }],
        },
        {
          id: "v1",
          version: 1,
          name: "برطمان كريم",
          outputUnit: "برطمان",
          note: null,
          createdBy: "سمير",
          createdAt: new Date().toISOString(),
          lines: [{ id: "l0", materialId: "m1", materialName: "طحين", baseUnit: "غرام", qtyMicro: 25_000_000, enteredQtyMicro: 25_000_000, enteredUnitLabel: "غرام", materialArchived: false }],
        },
      ],
      finished: null,
      canStock: false,
    },
  ],
  materials: [{ id: "m1", name: "طحين", baseUnit: "غرام", units: [] }],
  ...over,
});

describe("recipes", () => {
  it("shows the finished item, the lines per output unit and the older versions; a recipe holds no price", () => {
    const markup = wrap(createElement(RecipesPage, { initial: recipesView() }));
    const text = textOf(markup);
    expect(text).toContain("برطمان كريم");
    expect(text).toContain(t("mfg.recipe_version").replace("{n}", "2"));
    expect(text).toContain(t("mfg.recipe_per_unit").replace("{unit}", "برطمان"));
    expect(text).toContain("30");
    expect(text).toContain(t("mfg.recipe_versions_old").replace("{n}", "1"));
    expect(markup).toContain(`>${t("mfg.recipe_new_version")}</button>`);
    expect(text).not.toMatch(/JOD|دينار/);
  });

  it("a viewer has no buttons; an archived recipe offers restore, not a new version", () => {
    const viewer = wrap(createElement(RecipesPage, { initial: recipesView({ canEdit: false }) }));
    expect(viewer).not.toContain(`>${t("mfg.recipe_new_version")}</button>`);
    expect(viewer).not.toContain(t("mfg.recipe_new"));
    expect(textOf(viewer)).toContain(t("mfg.read_only"));
    const base = recipesView();
    const archived = wrap(createElement(RecipesPage, { initial: { ...base, recipes: [{ ...base.recipes[0]!, archived: true }] } }));
    // archived recipes are hidden until asked for
    expect(textOf(archived)).not.toContain("برطمان كريم");
    expect(textOf(archived)).toContain(t("mfg.show_archived"));
  });

  it("is clean of palette colours, physical directions and raw hex", () => {
    expectClean(wrap(createElement(RecipesPage, { initial: recipesView() })));
  });
});

const order = (over: Partial<OrderItem> = {}): OrderItem => ({
  id: "o1",
  seq: 3,
  status: "DRAFT",
  recipeId: "r1",
  recipeName: "برطمان كريم",
  version: 2,
  outputUnit: "برطمان",
  plannedMicro: 5_000_000,
  actualMicro: null,
  wasteMicro: null,
  wasteNote: null,
  note: null,
  createdBy: "سمير",
  createdAt: new Date().toISOString(),
  issuedAt: null,
  finishedAt: null,
  closedAt: null,
  closeNote: null,
  lines: [{ id: "ol1", materialId: "m1", materialName: "طحين", baseUnit: "غرام", perUnitMicro: 30_000_000, requiredMicro: 150_000_000, balanceMicro: 200_000_000, unpricedMicro: 0, issuedMicro: 0, enough: true }],
  costIncomplete: false,
  cost: null,
  canIssue: true,
  canComplete: false,
  canCancel: true,
  canReturn: false,
  canEditDraft: true,
  recipeStocked: false,
  finished: null,
  ...over,
});
const ordersView = (orders: OrderItem[], over: Partial<OrdersView> = {}): OrdersView => ({ spaceId: "s1", spaceName: "المصنع", canEdit: true, canCost: false, orders, recipes: [{ id: "r1", name: "برطمان كريم", outputUnit: "برطمان", version: 2, stocked: false }], ...over });

describe("production orders", () => {
  it("a draft shows what it needs and has, and the issue step says it moves stock by itself, with its fix", () => {
    const text = textOf(wrap(createElement(OrdersPage, { initial: ordersView([order()]) })));
    expect(text).toContain(t("mfg.order_n").replace("{n}", "3"));
    expect(text).toContain(t("mfg.order_status.DRAFT"));
    expect(text).toContain(t("mfg.order_required"));
    expect(text).toContain(t("mfg.order_have"));
    expect(text).toContain(`⚠️ ${t("mfg.order_issue_warn")}`);
    expect(text).toContain(`🔧 ${t("mfg.order_issue_fix")}`);
    expect(text).toContain(t("mfg.order_issue"));
  });

  it("a short material blocks the issue button and says so", () => {
    const short = order({ lines: [{ ...order().lines[0]!, balanceMicro: 100_000_000, enough: false }] });
    const markup = wrap(createElement(OrdersPage, { initial: ordersView([short]) }));
    expect(textOf(markup)).toContain(t("mfg.order_issue_blocked"));
    expect(markup).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${t("mfg.order_issue")}</button>`));
  });

  it("an issued order offers complete and return, never issue; a finished one offers nothing", () => {
    const issued = wrap(createElement(OrdersPage, { initial: ordersView([order({ status: "ISSUED", canIssue: false, canCancel: false, canComplete: true, canReturn: true })]) }));
    expect(issued).toContain(`>${t("mfg.order_complete")}</button>`);
    expect(issued).toContain(`>${t("mfg.order_return")}</button>`);
    expect(issued).not.toContain(`>${t("mfg.order_issue")}</button>`);
    const done = wrap(createElement(OrdersPage, { initial: ordersView([order({ status: "COMPLETED", actualMicro: 5_000_000, canIssue: false, canCancel: false })]) }));
    expect(done).not.toContain(`>${t("mfg.order_complete")}</button>`);
    expect(done).not.toContain(`>${t("mfg.order_return")}</button>`);
  });

  it("the cost shows its formula and the cost of one unit, only to a cost holder; an incomplete cost says so with its fix and never shows a number it did not have", () => {
    const cost = {
      totals: [{ currency: "JOD", totalMinor: 4_500, perUnitText: "0.900" }],
      lines: [
        {
          materialName: "طحين",
          baseUnit: "غرام",
          currency: "JOD",
          qtyMicro: 150_000_000,
          pieces: [
            { lotReceivedOn: "2026-10-30", qtyMicro: 100_000_000, unitText: "0.010", amountMinor: 1_000 },
            { lotReceivedOn: "2026-10-31", qtyMicro: 50_000_000, unitText: null, amountMinor: null },
          ],
        },
      ],
      frozen: false,
    };
    const done = order({ status: "COMPLETED", actualMicro: 5_000_000, canIssue: false, canCancel: false, cost, costIncomplete: true });
    const text = textOf(wrap(createElement(OrdersPage, { initial: ordersView([done], { canCost: true }) })));
    expect(text).toContain(t("mfg.order_cost_formula"));
    expect(text).toContain("4.500");
    expect(text).toContain("0.900");
    expect(text).toContain("÷");
    expect(text).toContain(t("mfg.order_cost_no_price"));
    expect(text).toContain(`⚠️ ${t("mfg.order_cost_incomplete")}`);
    expect(text).toContain(`🔧 ${t("mfg.order_cost_incomplete_fix")}`);
    // without the cost: the flag, no money
    const plain = textOf(wrap(createElement(OrdersPage, { initial: ordersView([{ ...done, cost: null }]) })));
    expect(plain).toContain(t("mfg.order_cost_incomplete"));
    expect(plain).not.toContain("4.500");
    expect(plain).not.toContain(t("mfg.order_cost_formula"));
    expect(plain).toContain(t("mfg.no_cost_note"));
  });

  it("is clean of palette colours, physical directions and raw hex", () => {
    expectClean(wrap(createElement(OrdersPage, { initial: ordersView([order(), order({ id: "o2", status: "ISSUED", canIssue: false, canComplete: true, canReturn: true })], { canCost: true }) })));
  });
});

const reports = (over: Partial<ReportsView> = {}): ReportsView => ({
  spaceId: "s1",
  spaceName: "المصنع",
  canCost: false,
  period: { from: "2026-10-01", to: "2026-10-31" },
  valuation: [{ materialId: "m1", name: "طحين", baseUnit: "غرام", qtyMicro: 50_000_000, unpricedMicro: 0, cost: null }],
  valuationTotals: null,
  consumption: [{ materialId: "m1", name: "طحين", baseUnit: "غرام", qtyMicro: 150_000_000, viaOrdersMicro: 150_000_000, cost: null }],
  orders: [{ orderId: "o1", seq: 1, status: "COMPLETED", recipeName: "برطمان", outputUnit: "برطمان", plannedMicro: 5_000_000, actualMicro: 5_000_000, day: "2026-10-20", costIncomplete: false, cost: null }],
  low: [{ materialId: "m1", name: "طحين", baseUnit: "غرام", qtyMicro: 50_000_000, lowStockMicro: 60_000_000 }],
  ...over,
});

describe("reports", () => {
  it("a person without the cost reads quantities and is told money is not theirs; each report has its CSV link", () => {
    const markup = wrap(createElement(ReportsPage, { initial: reports() }));
    const text = textOf(markup);
    for (const key of ["mfg.report.valuation", "mfg.report.consumption", "mfg.report.orders", "mfg.report.low", "mfg.report_no_money"]) expect(text).toContain(t(key));
    expect(text).not.toMatch(/JOD|دينار/);
    for (const kind of ["valuation", "consumption", "orders", "low"]) expect(markup).toContain(`report=${kind}&amp;from=2026-10-01&amp;to=2026-10-31`);
    expect(text).toContain(`🔧 ${t("mfg.low_fix_short")}`);
  });

  it("a cost holder reads the value with its formula, the total, and the cost of the orders", () => {
    const priced = reports({
      canCost: true,
      valuation: [{ materialId: "m1", name: "طحين", baseUnit: "غرام", qtyMicro: 50_000_000, unpricedMicro: 25_000_000, cost: { currency: "JOD", valueMinor: 1_000, averageText: "0.020", formula: { value: "1.000", qty: "50", average: "0.020" } } }],
      valuationTotals: [{ currency: "JOD", valueMinor: 1_000 }],
      orders: [{ orderId: "o1", seq: 1, status: "COMPLETED", recipeName: "برطمان", outputUnit: "برطمان", plannedMicro: 5_000_000, actualMicro: 5_000_000, day: "2026-10-20", costIncomplete: false, cost: { totals: [{ currency: "JOD", totalMinor: 4_500, perUnitText: "0.900" }] } }],
    });
    const text = textOf(wrap(createElement(ReportsPage, { initial: priced })));
    expect(text).toContain("1.000 ÷ 50 = 0.020");
    expect(text).toContain("4.500");
    expect(text).toContain("0.900");
    expect(text).toContain(AR["mfg.report_unpriced"]!.replace("{qty}", "25").replace("{unit}", "غرام"));
    expect(text).not.toContain(t("mfg.report_no_money"));
  });

  it("is clean of palette colours, physical directions and raw hex", () => {
    expectClean(wrap(createElement(ReportsPage, { initial: reports() })));
  });
});

describe("the report files are built from what the viewer reads", () => {
  const say = (key: string) => AR[key] ?? key;
  it("have no price column for a person without the cost, and are formula-safe", () => {
    for (const kind of ["valuation", "consumption", "orders", "low"] as const) {
      const file = reportCsv(kind, reports(), say);
      expect(file, kind).not.toContain(say("mfg.csv.currency"));
      expect(file, kind).not.toContain(say("mfg.csv.cost"));
      expect(file, kind).not.toContain(say("mfg.csv.per_unit"));
    }
    const hostile = reports({ valuation: [{ materialId: "m1", name: "=1+1", baseUnit: "غرام", qtyMicro: 1_000_000, unpricedMicro: 0, cost: null }] });
    expect(reportCsv("valuation", hostile, say)).toContain("'=1+1");
  });

  it("carry the value, the average, the cost and the cost per unit for a cost holder", () => {
    const priced = reports({
      canCost: true,
      valuation: [{ materialId: "m1", name: "طحين", baseUnit: "غرام", qtyMicro: 50_000_000, unpricedMicro: 0, cost: { currency: "JOD", valueMinor: 1_000, averageText: "0.020", formula: null } }],
      valuationTotals: [{ currency: "JOD", valueMinor: 1_000 }],
      consumption: [{ materialId: "m1", name: "طحين", baseUnit: "غرام", qtyMicro: 150_000_000, viaOrdersMicro: 0, cost: { currency: "JOD", totalMinor: 2_000, incomplete: true } }],
      orders: [{ orderId: "o1", seq: 1, status: "COMPLETED", recipeName: "برطمان", outputUnit: "برطمان", plannedMicro: 5_000_000, actualMicro: 5_000_000, day: "2026-10-20", costIncomplete: true, cost: { totals: [{ currency: "JOD", totalMinor: 4_500, perUnitText: "0.900" }] } }],
    });
    expect(reportCsv("valuation", priced, say)).toContain("0.020");
    expect(reportCsv("valuation", priced, say)).toContain(say("mfg.csv.total_row"));
    expect(reportCsv("consumption", priced, say)).toContain(say("mfg.csv.incomplete"));
    const orders = reportCsv("orders", priced, say);
    expect(orders).toContain("4.500");
    expect(orders).toContain("0.900");
    expect(orders).toContain(say("mfg.csv.incomplete"));
  });
});

describe("it is wired in, and only where it should be", () => {
  it("every new page answers «not found» to a partner and a person without the capability, before reading anything", () => {
    for (const folder of ["recipes", "orders", "reports"]) {
      const source = read(`src/app/(app)/manufacturing/${folder}/page.tsx`);
      expect(source, folder).toContain("pageActor()");
      expect(source, folder).toMatch(/actor\.isExternal \|\| !actorCan\(actor, "manufacturing\.view"\)\) notFound\(\)/);
      expect(source, folder).toContain('actorFeatureOn(actor, "mfgLedger")');
      expect(source, folder).not.toContain("currentUser(");
    }
  });

  it("every route of the slice goes through the actor and the service, and no route reads the database itself", () => {
    const routes = [
      "lots/[id]/cost",
      "recipes",
      "recipes/[id]",
      "recipes/[id]/versions",
      "orders",
      "orders/[id]/issue",
      "orders/[id]/complete",
      "orders/[id]/cancel",
      "orders/[id]/return",
      "orders/[id]",
      "lots/[id]/correct",
      "recipes/[id]/finished-stock",
      "reports",
      "reports/csv",
    ];
    for (const route of routes) {
      const source = read(`src/app/api/manufacturing/${route}/route.ts`);
      expect(source, route).toContain("requireActor()");
      expect(source, route).toContain("withApi");
      expect(source, route).not.toMatch(/from "@\/server\/db"/);
    }
  });

  it("nothing in the slice is linked to the OMS: no import of it, no outgoing request", () => {
    for (const file of ["manufacturing-costing.ts", "manufacturing-production.ts", "manufacturing-reports.ts", "manufacturing-order-cost.ts"]) {
      const source = read(`src/server/services/${file}`);
      expect(source, file).not.toMatch(/\bfetch\(|webhook|oms|salesflow/i);
    }
  });

  it("no money or arithmetic on floats: the pure files use bigint and never Number() on an amount", () => {
    const source = read("src/lib/manufacturing/costing.ts");
    expect(source).not.toMatch(/parseFloat|toFixed|Math\.round|Number\(/);
  });
});

// ───────────────────────────────────────── slice 3 ─────────────────────────────────────────

const step = (over: Record<string, unknown> = {}) => ({ seq: 0, unitCostMinor: 20, totalCostMinor: 2_000, currency: "JOD", by: "سمير", at: new Date().toISOString(), reason: null, current: false, ...over });

describe("a wrong late price", () => {
  it("a cost holder gets «صحّح السعر» and the history with every reason; nobody else gets the button or a price, only that it was corrected", () => {
    const priced = lot({ costPending: false, cost: { currency: "JOD", unitCostMinor: 40, totalCostMinor: 4_000 }, costedLater: { by: "سمير", at: new Date().toISOString() }, correctionCount: 1, canCorrectPrice: true, priceHistory: [step(), step({ seq: 1, unitCostMinor: 40, totalCostMinor: 4_000, reason: "الفاتورة غير", current: true })] });
    const buyer = wrap(createElement(MaterialPage, { initial: detail({ canCost: true, cost: showCost, lots: [priced] }) }));
    expect(buyer).toContain(`>${t("mfg.price_correct")}</button>`);
    const text = textOf(buyer);
    expect(text).toContain(t("mfg.price_history"));
    expect(text).toContain(t("mfg.price_first"));
    expect(text).toContain(t("mfg.price_correction_n").replace("{n}", "1"));
    expect(text).toContain("الفاتورة غير");
    expect(text).toContain(t("mfg.price_current"));
    // the keeper: a count, no button, no history, no price
    const keeper = wrap(createElement(MaterialPage, { initial: detail({ lots: [{ ...priced, cost: null, canCorrectPrice: false, priceHistory: [] }] }) }));
    expect(keeper).not.toContain(`>${t("mfg.price_correct")}</button>`);
    expect(textOf(keeper)).toContain(t("mfg.price_corrections_count").replace("{n}", "1"));
    expect(textOf(keeper)).not.toContain("الفاتورة غير");
    expect(textOf(keeper)).not.toContain(t("mfg.price_history"));
  });

  it("the correction form asks for the reason, says the past is not re-priced (⚠️ with its 🔧), and every string is Arabic", () => {
    for (const key of ["mfg.price_correct", "mfg.price_correct_warn", "mfg.price_correct_fix", "mfg.f.correct_reason", "mfg.price_correct_save", "mfg.e.correction_same", "mfg.e.correction_not_priced", "mfg.order_cost_frozen_warn", "mfg.order_cost_frozen_fix"]) {
      expect(AR[key], key).toMatch(/[؀-ۿ]/);
    }
    const source = read("src/components/manufacturing/stock-forms.tsx");
    expect(source).toContain("mfg.price_correct_warn");
    expect(source).toContain("mfg.price_correct_fix");
    expect(source).toContain("mfg.f.correct_reason");
  });
});

describe("a draft order can be edited", () => {
  it("only a draft offers «عدّل المسودة», and only to somebody who may edit", () => {
    const draft = wrap(createElement(OrdersPage, { initial: ordersView([order()]) }));
    expect(draft).toContain(`>${t("mfg.order_edit")}</button>`);
    const issued = wrap(createElement(OrdersPage, { initial: ordersView([order({ status: "ISSUED", canIssue: false, canCancel: false, canComplete: true, canReturn: true, canEditDraft: false })]) }));
    expect(issued).not.toContain(`>${t("mfg.order_edit")}</button>`);
    const viewer = wrap(createElement(OrdersPage, { initial: ordersView([order({ canIssue: false, canCancel: false, canEditDraft: false })], { canEdit: false }) }));
    expect(viewer).not.toContain(`>${t("mfg.order_edit")}</button>`);
  });
});

describe("finished goods", () => {
  it("a recipe that keeps no finished stock offers the button; one that does names the material and links to it", () => {
    const base = recipesView();
    const open = wrap(createElement(RecipesPage, { initial: { ...base, recipes: [{ ...base.recipes[0]!, canStock: true }] } }));
    expect(open).toContain(`>${t("mfg.finished_on")}</button>`);
    expect(textOf(open)).toContain(t("mfg.finished_on_hint"));
    const linked = wrap(createElement(RecipesPage, { initial: { ...base, recipes: [{ ...base.recipes[0]!, finished: { materialId: "m9", name: "برطمان كريم" }, canStock: false }] } }));
    expect(linked).not.toContain(`>${t("mfg.finished_on")}</button>`);
    expect(linked).toContain('href="/manufacturing/materials/m9"');
    // a viewer has no button
    const viewer = wrap(createElement(RecipesPage, { initial: { ...base, canEdit: false, recipes: [{ ...base.recipes[0]!, canStock: false }] } }));
    expect(viewer).not.toContain(`>${t("mfg.finished_on")}</button>`);
  });

  it("a completed order says where its output went, and warns when the lot waits for a price (⚠️ with its 🔧); a frozen cost says the past is not re-priced", () => {
    const done = order({ status: "COMPLETED", actualMicro: 5_000_000, canIssue: false, canCancel: false, canEditDraft: false, recipeStocked: true, finished: { materialId: "m9", materialName: "برطمان كريم", qtyMicro: 5_000_000, costPending: true } });
    const text = textOf(wrap(createElement(OrdersPage, { initial: ordersView([done]) })));
    expect(text).toContain(t("mfg.order_finished_in").replace("{qty}", "5").replace("{name}", "برطمان كريم"));
    expect(text).toContain(`⚠️ ${t("mfg.order_finished_pending")}`);
    expect(text).toContain(`🔧 ${t("mfg.order_finished_pending_fix")}`);
    expect(text).toContain(`⚠️ ${t("mfg.order_finished_warn")}`);
    expect(text).toContain(`🔧 ${t("mfg.order_finished_fix")}`);
    // a person without the cost never reads a price here, only the quantity and the flag
    expect(text).not.toMatch(/JOD|دينار/);
    const frozen = order({
      status: "COMPLETED",
      actualMicro: 5_000_000,
      canIssue: false,
      canCancel: false,
      canEditDraft: false,
      cost: { totals: [{ currency: "JOD", totalMinor: 1_000, perUnitText: "0.200" }], lines: [{ materialName: "طحين", baseUnit: "غرام", currency: "JOD", qtyMicro: 50_000_000, pieces: [{ lotReceivedOn: "2026-10-30", qtyMicro: 50_000_000, unitText: "0.020", amountMinor: 1_000 }] }], frozen: true },
    });
    const seen = textOf(wrap(createElement(OrdersPage, { initial: ordersView([frozen], { canCost: true }) })));
    expect(seen).toContain(`⚠️ ${t("mfg.order_cost_frozen_warn")}`);
    expect(seen).toContain(`🔧 ${t("mfg.order_cost_frozen_fix")}`);
    expect(seen).toContain(t("mfg.order_cost_frozen"));
  });
});
