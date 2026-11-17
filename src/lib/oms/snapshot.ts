/**
 * The snapshot of a product from the orders system (Q1.0), as pure functions: what the products door sends is read into ONE
 * shape, and the rules about it (stale after 30 minutes, did the price change) live here so a screen, a route and a job judge
 * it the same way. Nothing here touches the network or the database.
 *
 * A price is NEVER typed or stored as truth in this system: this snapshot is what the orders system said at `fetchedAt`, and
 * `Card.external` holds it outside the versions of the sheet. A customer's data never crosses: only the fields named below are
 * read, so a review (first name, city) or a customer field the door might one day add is dropped here.
 */

/** A price older than this is «مش محدّث»: it is shown with its age and is never copied or sent. */
export const STALE_AFTER_MS = 30 * 60_000;

export interface OfferSnapshot {
  title: string;
  quantity: number;
  freeQuantity?: number;
  price: number;
  expiresAt?: string;
}

export interface ProductSnapshot {
  /** The orders system's internal id, once its door gives it. */
  id?: string;
  /** Unique per store only: two products may share one (the sync then links nothing by itself). */
  code: string;
  name: string;
  store?: string;
  category?: string;
  price: number;
  currency: string;
  offers: OfferSnapshot[];
  stockStatus: string;
  deliveryIncluded?: boolean;
  link?: string;
  /** ISO time the sync read it. */
  fetchedAt: string;
  /** ISO time the sync first saw the product gone from the orders system (the sheet is never deleted). */
  missingSince?: string;
}

function ageMs(snapshot: Pick<ProductSnapshot, "fetchedAt"> | null | undefined, now: Date): number | null {
  const at = snapshot?.fetchedAt ? Date.parse(snapshot.fetchedAt) : NaN;
  return Number.isFinite(at) ? now.getTime() - at : null;
}

/** No snapshot, a broken date, or one older than 30 minutes is stale. A date in the future (a skewed clock) is not. */
export function isStale(snapshot: ProductSnapshot | null | undefined, now: Date = new Date()): boolean {
  const age = ageMs(snapshot, now);
  return age === null || age > STALE_AFTER_MS;
}

/** «آخر تحديث قبل …» for a chip, Western digits. */
export function staleNote(snapshot: ProductSnapshot | null | undefined, now: Date = new Date()): string {
  const age = ageMs(snapshot, now);
  if (age === null) return "ما في سعر محدّث";
  const minutes = Math.max(0, Math.floor(age / 60_000));
  if (minutes < 60) return `آخر تحديث قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `آخر تحديث قبل ${hours} ساعة` : `آخر تحديث قبل ${Math.floor(hours / 24)} يوم`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** A price or a quantity must be a real number above zero: a zero or a negative one is never taken as truth. */
const positive = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
};
/** An id or a code may come as a number: it is kept as text. */
const idText = (v: unknown): string | undefined => (typeof v === "number" && Number.isFinite(v) ? String(v) : str(v));
/** A link is kept only when it is an http or https address (never javascript: or data:). */
function safeLink(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? s : undefined;
  } catch {
    return undefined;
  }
}

function readOffer(raw: unknown): OfferSnapshot | null {
  if (!isObj(raw)) return null;
  const price = positive(raw["price"]);
  const quantity = positive(raw["quantity"]);
  if (price === undefined || quantity === undefined) return null;
  const free = num(raw["free_quantity"]);
  const expires = str(raw["expires_at"]);
  return {
    title: str(raw["title"]) ?? "",
    quantity,
    ...(free !== undefined ? { freeQuantity: free } : {}),
    price,
    ...(expires ? { expiresAt: expires } : {}),
  };
}

/**
 * The rows of the products door (`{ data: [...] }`, `{ products: [...] }` or a bare array), each read into a snapshot.
 * A row with no code, no name or a price that is not a number is dropped: a price is never guessed. Anything that is not a
 * list gives an empty list (the caller treats a sync that read nothing as «not reachable», never as «all products are gone»).
 */
export function normalizeProducts(body: unknown, now: Date = new Date()): ProductSnapshot[] {
  return readProducts(body, now).products;
}

export interface ProductsRead {
  /** `list` = the answer is a list of products (it may be empty); `other` = anything else (an error object, a page of HTML). */
  shape: "list" | "other";
  products: ProductSnapshot[];
  /** The codes and ids of the rows that were there but could not be read: a sheet of one of them is NOT «gone». */
  unreadable: { codes: Set<string>; ids: Set<string> };
  /** How many rows were dropped. */
  dropped: number;
}

/** Like `normalizeProducts`, and it also says what it could not read, so the sync never marks a sheet gone for a row that is still there. */
export function readProducts(body: unknown, now: Date = new Date()): ProductsRead {
  const found = Array.isArray(body) ? body : isObj(body) ? (Array.isArray(body["data"]) ? body["data"] : Array.isArray(body["products"]) ? body["products"] : null) : null;
  const out: ProductsRead = { shape: found ? "list" : "other", products: [], unreadable: { codes: new Set(), ids: new Set() }, dropped: 0 };
  for (const raw of found ?? []) {
    if (!isObj(raw)) {
      out.dropped += 1;
      continue;
    }
    const code = idText(raw["code"]);
    const name = str(raw["name"]);
    const price = positive(raw["price"]);
    const id = idText(raw["id"]);
    if (!code || !name || price === undefined) {
      out.dropped += 1;
      if (code) out.unreadable.codes.add(code);
      if (id) out.unreadable.ids.add(id);
      continue;
    }
    const store = str(raw["store"]);
    const category = str(raw["category"]);
    const link = safeLink(raw["link"]);
    const offers = (Array.isArray(raw["offers"]) ? raw["offers"] : []).map(readOffer).filter((o): o is OfferSnapshot => o !== null);
    out.products.push({
      ...(id ? { id } : {}),
      code,
      name,
      ...(store ? { store } : {}),
      ...(category ? { category } : {}),
      price,
      currency: str(raw["currency"]) ?? "",
      offers,
      stockStatus: str(raw["stock_status"]) ?? "unknown",
      ...(typeof raw["delivery_included"] === "boolean" ? { deliveryIncluded: raw["delivery_included"] } : {}),
      ...(link ? { link } : {}),
      fetchedAt: now.toISOString(),
    });
  }
  return out;
}

const offerKey = (o: OfferSnapshot): string => JSON.stringify([o.title, o.quantity, o.freeQuantity ?? 0, o.price, o.expiresAt ?? ""]);

/**
 * Did the price or the offers differ from the previous snapshot? False for the first snapshot of a product (nothing to
 * compare with), and for a change of the time, the name or the stock only. The order of the offers does not matter.
 */
export function priceChanged(previous: ProductSnapshot | null | undefined, next: ProductSnapshot): boolean {
  if (!previous) return false;
  if (previous.price !== next.price) return true;
  // a sheet whose saved offers are not a list is read as having none: it never stops the others
  const a = (Array.isArray(previous.offers) ? previous.offers : []).map(offerKey).sort();
  const b = (Array.isArray(next.offers) ? next.offers : []).map(offerKey).sort();
  return a.length !== b.length || a.some((k, i) => k !== b[i]);
}
