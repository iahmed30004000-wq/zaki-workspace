/**
 * «اللوحات» — what a card IS, shared by the server (validation, storage) and the screen (drawing, filtering).
 * Pure: no database, no React. Everything the owner fixed lives here once: the kinds, the colour set, the limits,
 * the rule that a link is https only, and the sentence a card becomes when it is sent into a chat topic.
 */

import type { CardStatus } from "./status";
import { cleanProductData, type KnowledgeError, type ProductData } from "./knowledge";

/** The kinds of the ordinary cards of a space: what its «بطاقة جديدة» menu offers. */
export const GENERIC_CARD_KINDS = ["NOTE", "PROMPT", "LIST", "LINK", "FILE", "TABLE"] as const;
/** The kinds of the company's knowledge (Q1.1): a product sheet and a general approved answer. They are NOT in a space's ordinary cards. */
export const KNOWLEDGE_KINDS = ["PRODUCT", "REPLY"] as const;
export const CARD_KINDS = [...GENERIC_CARD_KINDS, ...KNOWLEDGE_KINDS] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export function isKnowledgeKind(v: unknown): v is (typeof KNOWLEDGE_KINDS)[number] {
  return v === "PRODUCT" || v === "REPLY";
}

export function isCardKind(v: unknown): v is CardKind {
  return typeof v === "string" && (CARD_KINDS as readonly string[]).includes(v);
}

/** A theme token name, never a hex value: every theme restyles every card. `none` is the plain card. */
export const CARD_COLORS = ["none", "accent", "ok", "warn", "danger", "info", "cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"] as const;
export type CardColor = (typeof CARD_COLORS)[number];

export function isCardColor(v: unknown): v is CardColor {
  return typeof v === "string" && (CARD_COLORS as readonly string[]).includes(v);
}

/** The layouts of a space (`Workspace.layout`). */
export const SPACE_LAYOUTS = ["STANDARD", "CARDS", "MANUFACTURING"] as const;
export type SpaceLayout = (typeof SPACE_LAYOUTS)[number];

/** A stored value read back as a layout (anything unknown is a general space). */
export function layoutOf(raw: unknown): SpaceLayout {
  return (SPACE_LAYOUTS as readonly unknown[]).includes(raw) ? (raw as SpaceLayout) : "STANDARD";
}

/** Spaces that open on their cards: «لوحات», and «تصنيع» (which for now is the same free cards). */
export function opensOnCards(layout: SpaceLayout | undefined): boolean {
  return layout === "CARDS" || layout === "MANUFACTURING";
}

export const LIMITS = {
  title: 140,
  body: 20_000,
  category: 40,
  tag: 30,
  tags: 10,
  listItems: 200,
  listText: 300,
  tableColumns: 8,
  tableRows: 100,
  tableCell: 300,
  url: 2000,
  cards: 1000,
  /** The page inside a card. */
  note: 4000,
  caption: 200,
  attachments: 30,
} as const;

export interface ListItem {
  text: string;
  done: boolean;
}
export interface ListData {
  items: ListItem[];
}
export interface LinkData {
  url: string;
}
export interface TableData {
  columns: string[];
  rows: string[][];
}
export type CardData = ListData | LinkData | TableData | ProductData | null;

/** A card as the screen holds it (dates are ISO strings: it travels as JSON). */
export interface CardItem {
  id: string;
  kind: CardKind;
  title: string;
  body: string | null;
  data: CardData;
  color: CardColor;
  category: string | null;
  tags: string[];
  pinned: boolean;
  position: number;
  fileId: string | null;
  file: { name: string; mimeType: string; size: number } | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string;
  createdByName: string;
  /** The page inside a card (always set by the server; optional so a card built by hand stays valid). */
  status?: CardStatus;
  version?: number;
  coverFileId?: string | null;
}

// ---------- links ----------

/**
 * A link card opens in the browser of whoever reads it, so only `https:` passes: no `javascript:`, no `data:`, no `http:`,
 * no address with a password in it. The screen asks again before it draws the anchor (a row written some other way is
 * never trusted).
 */
export function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (text.length === 0 || text.length > LIMITS.url) return false;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.length > 0 && url.username === "" && url.password === "";
}

// ---------- normalising what a person typed ----------

/** The machine keys of the refusals (each has an Arabic sentence in ar.cards.json). */
export type CardDataError = "cards.e.list" | "cards.e.link" | "cards.e.table" | KnowledgeError;

export type Cleaned<T> = { ok: true; value: T } | { ok: false; error: CardDataError };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function cleanList(raw: unknown): Cleaned<ListData> {
  if (!isObject(raw) || !Array.isArray(raw.items)) return { ok: false, error: "cards.e.list" };
  if (raw.items.length > LIMITS.listItems) return { ok: false, error: "cards.e.list" };
  const items: ListItem[] = [];
  for (const it of raw.items) {
    if (!isObject(it) || typeof it.text !== "string") return { ok: false, error: "cards.e.list" };
    const text = it.text.trim();
    if (text.length > LIMITS.listText) return { ok: false, error: "cards.e.list" };
    if (text) items.push({ text, done: it.done === true });
  }
  return { ok: true, value: { items } };
}

function cleanLink(raw: unknown): Cleaned<LinkData> {
  if (!isObject(raw) || !isSafeHttpsUrl(raw.url)) return { ok: false, error: "cards.e.link" };
  return { ok: true, value: { url: raw.url.trim() } };
}

function cleanTable(raw: unknown): Cleaned<TableData> {
  if (!isObject(raw) || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return { ok: false, error: "cards.e.table" };
  if (raw.columns.length < 1 || raw.columns.length > LIMITS.tableColumns || raw.rows.length > LIMITS.tableRows) {
    return { ok: false, error: "cards.e.table" };
  }
  const cell = (v: unknown): string | null => (typeof v === "string" && v.length <= LIMITS.tableCell ? v.trim() : null);
  const columns: string[] = [];
  for (const c of raw.columns) {
    const text = cell(c);
    if (text === null) return { ok: false, error: "cards.e.table" };
    columns.push(text);
  }
  const rows: string[][] = [];
  for (const r of raw.rows) {
    if (!Array.isArray(r) || r.length > columns.length) return { ok: false, error: "cards.e.table" };
    const out: string[] = [];
    for (let i = 0; i < columns.length; i++) {
      const text = cell(r[i] ?? "");
      if (text === null) return { ok: false, error: "cards.e.table" };
      out.push(text);
    }
    rows.push(out);
  }
  return { ok: true, value: { columns, rows } };
}

/** The `data` a card of this kind may carry: the list, the url or the table, clean; null for the kinds with none. */
export function cleanCardData(kind: CardKind, raw: unknown): Cleaned<CardData> {
  switch (kind) {
    case "LIST":
      return cleanList(raw ?? { items: [] });
    case "LINK":
      return cleanLink(raw);
    case "TABLE":
      return cleanTable(raw ?? { columns: [""], rows: [] });
    case "PRODUCT": {
      const product = cleanProductData(raw ?? {});
      return product.ok ? { ok: true, value: product.value } : { ok: false, error: product.error };
    }
    default:
      return { ok: true, value: null };
  }
}

export function cleanCategory(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().slice(0, LIMITS.category);
  return text.length ? text : null;
}

/** Tags are short words: trimmed, no leading #, no repeats, at most ten. */
export function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const text = t.trim().replace(/^#+/, "").trim().slice(0, LIMITS.tag);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

// ---------- the sentence a card becomes in the chat ----------

/** The most a chat message takes (src/server/chat/messages.ts MAX_BODY). */
export const CHAT_BODY_MAX = 4000;

/**
 * «أرسل»: the title and the text of the card, as words. A FILE card sends only its title and note — never the file
 * itself, whose readers the chat cannot know (the topic's readers may not be allowed to open the library).
 */
export function cardMessageText(card: Pick<CardItem, "kind" | "title" | "body" | "data">): string {
  const lines: string[] = [card.title.trim()];
  if (card.body && card.body.trim()) lines.push(card.body.trim());
  if (card.kind === "LIST" && card.data && "items" in card.data) {
    for (const it of card.data.items) lines.push(`${it.done ? "☑" : "☐"} ${it.text}`);
  }
  if (card.kind === "LINK" && card.data && "url" in card.data && isSafeHttpsUrl(card.data.url)) lines.push(card.data.url);
  if (card.kind === "TABLE" && card.data && "columns" in card.data) {
    lines.push(card.data.columns.join(" | "));
    for (const row of card.data.rows) lines.push(row.join(" | "));
  }
  const text = lines.join("\n");
  return text.length > CHAT_BODY_MAX ? `${text.slice(0, CHAT_BODY_MAX - 1)}…` : text;
}

/** The task a card becomes: its title, and its words as the description. */
export function cardTaskDescription(card: Pick<CardItem, "kind" | "body" | "data">): string | undefined {
  const lines: string[] = [];
  if (card.body && card.body.trim()) lines.push(card.body.trim());
  if (card.kind === "LIST" && card.data && "items" in card.data) {
    for (const it of card.data.items) lines.push(`${it.done ? "☑" : "☐"} ${it.text}`);
  }
  if (card.kind === "LINK" && card.data && "url" in card.data && isSafeHttpsUrl(card.data.url)) lines.push(card.data.url);
  const text = lines.join("\n");
  return text ? text.slice(0, 10_000) : undefined;
}
