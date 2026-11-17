import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/cards",
}));

import { AR } from "@/lib/i18n/dict";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { CardTile, type TileActions } from "@/components/cards/card-tile";
import { CardGrid } from "@/components/cards/card-grid";
import { CardEditorForm } from "@/components/cards/card-editor";
import { CardsView } from "@/components/cards/cards-view";
import { CARD_KINDS, GENERIC_CARD_KINDS, KNOWLEDGE_KINDS, type CardItem } from "@/lib/cards/shared";
import { CARD_VIEWS } from "@/lib/cards/view";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, element))),
  );
}

let n = 0;
function card(over: Partial<CardItem> = {}): CardItem {
  n += 1;
  return {
    id: `c${n}`,
    kind: "NOTE",
    title: `عنوان ${n}`,
    body: null,
    data: null,
    color: "none",
    category: null,
    tags: [],
    pinned: false,
    position: n * 1000,
    fileId: null,
    file: null,
    archivedAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
    createdById: "u1",
    createdByName: "سارة",
    ...over,
  };
}

const noop = () => {};
const actions: TileActions = { onEdit: noop, onArchive: noop, onRestore: noop, onPin: noop, onDuplicate: noop, onSend: noop, onTask: noop, onToggleItem: noop };

const note = card({ kind: "NOTE", title: "ملاحظة الاجتماع", body: "نراجع الميزانية يوم الأحد" });
const prompt = card({ kind: "PROMPT", title: "برومبت الإعلان", body: "اكتب عنوانًا قصيرًا للإعلان" });
const list = card({ kind: "LIST", title: "قائمة التسوق", data: { items: [{ text: "حليب", done: true }, { text: "شاي", done: false }] } });
const link = card({ kind: "LINK", title: "الوثائق", data: { url: "https://example.com/docs" } });
const bad = card({ kind: "LINK", title: "رابط تالف", data: { url: "javascript:alert(1)" } });
const file = card({ kind: "FILE", title: "المخطط", fileId: "f1", file: { name: "plan.png", mimeType: "image/png", size: 2048 } });
const pdf = card({ kind: "FILE", title: "العقد", fileId: "f2", file: { name: "contract.pdf", mimeType: "application/pdf", size: 4096 } });
const table = card({ kind: "TABLE", title: "المواصفات", data: { columns: ["الحجم", "اللون"], rows: [["كبير", "أزرق"]] } });

const tile = (c: CardItem, over: Partial<Parameters<typeof CardTile>[0]> = {}) =>
  render(createElement(CardTile, { card: c, density: "tile", canWrite: true, owner: false, actions, ...over }));

describe("a tile per kind", () => {
  it("draws the title, the kind's name and the words of every kind", () => {
    for (const c of [note, prompt, list, link, file, table]) {
      const html = tile(c);
      expect(html, c.kind).toContain(c.title);
      expect(html, c.kind).toContain(AR[`cards.kind.${c.kind}`]!);
      expect(html, c.kind).toContain(`data-kind="${c.kind}"`);
    }
    expect(tile(note)).toContain("نراجع الميزانية");
  });

  it("a prompt has a one-tap copy button, at least 44px high", () => {
    const html = tile(prompt);
    expect(html).toContain(AR["cards.copy"]!);
    expect(html).toMatch(/<button[^>]*min-h-11[^>]*>(?:(?!<\/button>).)*نسخ/s);
    expect(html).toContain("اكتب عنوانًا قصيرًا للإعلان");
  });

  it("a list shows its items with ticks; a person who cannot write sees the boxes disabled", () => {
    const open = tile(list);
    expect(open).toContain("حليب");
    expect(open.match(/type="checkbox"/g)).toHaveLength(2);
    expect(open).toMatch(/checked=""/);
    expect(open).not.toContain("disabled");
    const shut = tile(list, { canWrite: false });
    expect(shut.match(/disabled=""/g)).toHaveLength(2);
  });

  it("a link opens in a new tab with no opener and no referrer; an unsafe address is never an anchor", () => {
    const html = tile(link);
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    const broken = tile(bad);
    expect(broken).not.toContain("javascript:");
    // no anchor to anywhere but the card's own page (its title opens it)
    expect(broken).not.toMatch(/<a [^>]*href="(?!\/cards\/)/);
    expect(broken).toContain(AR["cards.link_invalid"]!);
  });

  it("a file card shows an image preview for an image, a download link for any file, and its size", () => {
    const image = tile(file);
    expect(image).toContain('src="/api/files/f1/raw"');
    expect(image).toContain("/api/files/f1/raw?download=1");
    expect(image).toContain("plan.png");
    const doc = tile(pdf);
    expect(doc).not.toContain("<img");
    expect(doc).toContain("/api/files/f2/raw?download=1");
    expect(tile(card({ kind: "FILE", title: "ضاع", fileId: null, file: null }))).toContain(AR["cards.file_gone"]!);
  });

  it("a data table is a real table with its headers, and says it is not for stock or money", () => {
    const html = tile(table);
    expect(html).toContain("<table");
    expect(html).toContain('scope="col"');
    expect(html).toContain("كبير");
    expect(html).toContain(AR["cards.table_notice"]!);
    expect(AR["cards.table_notice"]).toContain("مخزون");
    expect(AR["cards.table_notice"]).toContain("مبالغ");
    // the warning and its fix are visible together (the owner's rule)
    expect(AR["cards.table_notice"]).toContain("⚠️");
    expect(AR["cards.table_notice"]).toContain("🔧");
  });

  it("the dense row shows one line: the title and a short summary", () => {
    const html = tile(list, { density: "row" });
    expect(html).toContain("قائمة التسوق");
    expect(html).toContain("1 من 2");
    expect(html).not.toContain("<table");
  });

  it("shows category, tags, the pin, and the colour as a theme token class", () => {
    const html = tile(card({ title: "مثبتة", pinned: true, category: "إعلانات", tags: ["مسودة"], color: "warn" }));
    expect(html).toContain("إعلانات");
    expect(html).toContain("مسودة");
    expect(html).toContain(AR["cards.pinned"]!);
    expect(html).toContain("border-warn/40");
  });

  it("the menu is there for a writer, absent for a reader, and the owner's archive offers only «استرجاع»", () => {
    expect(tile(note)).toContain(AR["cards.menu"]!);
    expect(tile(note, { canWrite: false })).not.toContain(AR["cards.menu"]!);
    const archived = tile(note, { archivedView: true, owner: true });
    expect(archived).toContain(AR["cards.restore"]!);
    expect(archived).not.toContain(AR["cards.menu"]!);
    expect(tile(note, { archivedView: true, owner: false })).not.toContain(AR["cards.restore"]!);
  });
});

describe("the grid and its views", () => {
  const cards = [note, prompt, list, link];
  const grid = (view: (typeof CARD_VIEWS)[number], over: Partial<Parameters<typeof CardGrid>[0]> = {}) =>
    render(createElement(CardGrid, { cards, view, canReorder: false, canWrite: true, owner: false, actions, onReorder: noop, ...over }));

  it("the grid is a CSS grid of tiles; the list is dense rows; the columns are one per category", () => {
    expect(grid("grid")).toContain("grid-cols-1");
    expect(grid("grid").match(/<article/g)).toHaveLength(4);
    expect(grid("list")).toContain("flex flex-col gap-2");
    expect(grid("list").match(/<article/g)).toHaveLength(4);
    const columns = grid("columns", { cards: [card({ category: "أ" }), card({ category: "ب" }), card()] });
    expect(columns.match(/<section/g)).toHaveLength(3);
    expect(columns).toContain(AR["cards.no_category"]!);
  });

  it("with drag and drop on, every card has a keyboard-reachable handle named for it, 44px wide", () => {
    const html = grid("grid", { canReorder: true });
    expect(html.match(/aria-label="اسحب لإعادة الترتيب: /g)).toHaveLength(4);
    expect(html).toContain("size-11");
    expect(html).toContain('aria-roledescription="sortable"');
    expect(html).toContain("aria-describedby=\"DndDescribedBy-");
  });

  it("with it off (someone who reads, another sort) there are no handles", () => {
    expect(grid("grid", { canReorder: false })).not.toContain("اسحب لإعادة الترتيب");
  });
});

describe("the editor", () => {
  const editor = (c: CardItem | null) => render(createElement(CardEditorForm, { card: c, categories: ["إعلانات"], onSave: async () => {}, onCancel: noop }));

  it("a new card offers the six kinds, colours, category, tags and pin", () => {
    const html = editor(null);
    for (const kind of GENERIC_CARD_KINDS) expect(html).toContain(AR[`cards.kind.${kind}`]!);
    // the company's knowledge (a product sheet, a general answer) is made at «المنتجات», never from the ordinary card menu
    for (const kind of KNOWLEDGE_KINDS) expect(html).not.toContain(AR[`cards.kind.${kind}`]!);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain(AR["cards.f.category"]!);
    expect(html).toContain(AR["cards.f.tags"]!);
    expect(html).toContain('<option value="إعلانات">');
  });

  it("an edit does not offer to change the kind; a link shows its https hint, a table its warning, a file its picker", () => {
    expect(editor(note)).not.toContain(AR["cards.f.kind"]!);
    expect(editor(link)).toContain(AR["cards.f.url_hint"]!);
    expect(editor(table)).toContain(AR["cards.table_notice"]!);
    expect(editor(file)).toContain('type="file"');
    expect(editor(list)).toContain(AR["cards.f.item_add"]!);
  });
});

describe("the screen", () => {
  const view = (over: Partial<Parameters<typeof CardsView>[0]> = {}) =>
    render(createElement(CardsView, { spaceId: "s1", spaceName: "مساحة الإعلانات", userId: "u1", initial: [note, prompt, list], canWrite: true, owner: false, ...over }));

  it("has the switcher (شبكة · قائمة · أعمدة), the search, the sort and the filters", () => {
    const html = view();
    for (const key of ["cards.view.grid", "cards.view.list", "cards.view.columns"]) expect(html).toContain(AR[key]!);
    expect(html).toContain(AR["cards.search"]!);
    expect(html).toContain(AR["cards.sort.manual"]!);
    expect(html).toContain(AR["cards.sort.newest"]!);
    expect(html).toContain(AR["cards.filters"]!);
    expect(html).toContain("مساحة الإعلانات");
    expect(html.match(/role="radio"/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("a writer gets «لوحة جديدة»; a reader does not and is told the cards are read only", () => {
    expect(textOf(view())).toContain(AR["cards.new"]!);
    const reader = view({ canWrite: false });
    expect(textOf(reader)).not.toContain(AR["cards.new"]!);
    expect(textOf(reader)).toContain(AR["cards.read_only"]!);
    expect(reader).not.toContain("اسحب لإعادة الترتيب");
  });

  it("a «تصنيع» space says that stock and cost numbers are not typed here; a cards space does not", () => {
    const manufacturing = textOf(view({ layout: "MANUFACTURING" }));
    expect(manufacturing).toContain(AR["cards.ledger_notice"]!);
    expect(AR["cards.ledger_notice"]).toBe("أرقام المخزون والكلف ما بتنكتب هون بالإيد: بتنعرض من الدفتر الرسمي لما يجهز.");
    expect(textOf(view({ layout: "CARDS" }))).not.toContain(AR["cards.ledger_notice"]!);
    expect(textOf(view())).not.toContain(AR["cards.ledger_notice"]!);
  });

  it("a data table carries the same line in a «تصنيع» space, in the tile and in the editor, and only there", () => {
    expect(tile(table, { ledgerNotice: true })).toContain(AR["cards.ledger_notice"]!);
    expect(tile(table)).not.toContain(AR["cards.ledger_notice"]!);
    const form = (ledgerNotice: boolean) => render(createElement(CardEditorForm, { card: table, categories: [], ledgerNotice, onSave: async () => {}, onCancel: noop }));
    expect(form(true)).toContain(AR["cards.ledger_notice"]!);
    expect(form(false)).not.toContain(AR["cards.ledger_notice"]!);
    // the three choices at creation
    expect(AR["cards.space_type.MANUFACTURING"]).toBe("تصنيع");
  });

  it("only the owner has the archive button", () => {
    expect(textOf(view())).not.toContain(AR["cards.archive"]!);
    expect(textOf(view({ owner: true }))).toContain(AR["cards.archive"]!);
  });

  it("an empty space says so and points to the first step", () => {
    const html = textOf(view({ initial: [] }));
    expect(html).toContain(AR["cards.empty"]!);
    expect(html).toContain(AR["cards.empty_hint"]!);
  });

  it("uses theme tokens and logical directions only, and has no picture behind its text", () => {
    const markup = [view(), tile(table), tile(link), tile(file), tile(prompt), tile(list, { density: "row" })].join("\n");
    const tokens = classTokens(markup);
    expect(tokens.filter((c) => PALETTE_COLOUR.test(c) || PHYSICAL_UTILITY.test(c))).toEqual([]);
    expect(markup).not.toMatch(/background-image|bg-\[url/);
  });

  it("never prints a raw dictionary key", () => {
    expect(textOf(view())).not.toMatch(/\bcards\.[a-z_.]+\b/);
  });
});

describe("the source", () => {
  const dir = path.resolve(__dirname, "../src/components/cards");
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));

  it("looks at the components (so the checks below are not vacuous)", () => {
    expect(files).toEqual(expect.arrayContaining(["card-grid.tsx", "card-tile.tsx", "card-editor.tsx", "cards-view.tsx"]));
  });

  it("every dictionary key a component writes exists, and no colour is a hex or a palette class", () => {
    const missing: string[] = [];
    for (const f of files) {
      const text = readFileSync(path.join(dir, f), "utf8");
      for (const m of text.matchAll(/\bt\(\s*["'`](cards\.[\w.-]+)["'`]/g)) if (!(m[1]! in AR)) missing.push(`${f} ${m[1]}`);
      expect(text, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
    expect(missing).toEqual([]);
  });

  it("drag and drop respects reduced motion", () => {
    const text = readFileSync(path.join(dir, "card-grid.tsx"), "utf8");
    expect(text).toContain("prefers-reduced-motion");
    expect(text).toContain("motion-safe:");
    expect(text).toContain("KeyboardSensor");
    // dnd-kit's announcements and instructions are ours, in Arabic (the library's own are English)
    expect(text).toContain("screenReaderInstructions");
    expect(text).toContain("cards.dnd.start");
    for (const k of ["instructions", "start", "over", "end", "cancel"]) expect(AR[`cards.dnd.${k}`], k).toMatch(/[؀-ۿ]/);
  });

  it("every kind and every colour has its Arabic name", () => {
    for (const k of CARD_KINDS) expect(AR[`cards.kind.${k}`], k).toMatch(/[؀-ۿ]/);
    for (const c of ["none", "accent", "ok", "warn", "danger", "info", "cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"]) expect(AR[`cards.color.${c}`], c).toMatch(/[؀-ۿ]/);
  });
});
