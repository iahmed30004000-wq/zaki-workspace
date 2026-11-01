/**
 * «مخزون التصنيع» — the pure part: exact quantities, exact money, the weighted average, and the rules every screen and route share.
 *
 * Pure (no React, no database, no server imports): the routes validate with it, the screens format with it, the tests pin it.
 *
 * NUMBERS ARE EXACT. Nothing here is a floating point that is added, compared or stored:
 *  - a QUANTITY is an integer count of micro-units of the material's base unit (1 unit = 1 000 000), a `bigint` while it is computed;
 *  - MONEY is an integer count of minor units (12.500 JOD is 12500) plus a currency code, a `bigint` while it is computed;
 *  - a conversion is a positive exact fraction (1 كرتونة = 24 علبة is 24/1) and a quantity typed in one unit must turn into a whole
 *    number of base micro-units, or it is refused (nothing is rounded for the person);
 *  - the only rounding is the money one, half-up, done once at the moment a line is written (a receipt's total, an issue's value).
 *
 * This ledger records stock and cost only. It is not accounting: it holds no wallet, makes no payment and approves no money.
 */

export const MICRO = 1_000_000n;

/** The most a single movement may carry (1,000,000 units) and the most a balance may reach: a typo stops here, and every sum stays a safe integer. */
export const MAX_MOVEMENT_MICRO = 1_000_000n * MICRO;
export const MAX_BALANCE_MICRO = 100_000_000n * MICRO;
/** The most a receipt's total may be, in minor units. */
export const MAX_TOTAL_MINOR = 1_000_000_000_000n;

export const LIMITS = {
  name: 120,
  code: 40,
  unit: 40,
  note: 500,
  reason: 300,
  supplierNote: 300,
  conversions: 20,
  list: 500,
  movements: 300,
} as const;

/** What a movement is. */
export const MOVEMENT_KINDS = ["RECEIVE", "ISSUE", "ADJUST", "COUNT_ADJUST", "REVERSE"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export function isMovementKind(value: unknown): value is MovementKind {
  return typeof value === "string" && (MOVEMENT_KINDS as readonly string[]).includes(value);
}

/** The states of a stocktake. */
export const COUNT_STATUSES = ["PENDING", "APPROVED", "REJECTED", "MATCHED"] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];

// ───────────────────────────────────────── digits and decimals ─────────────────────────────────────────

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

/** Digits of any script to 0-9, the Arabic decimal mark to "." and the thousands marks and spaces to nothing. */
export function westernDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[٬,\s]/g, "");
}

/**
 * Typed text to a scaled integer with integer arithmetic only: `digits` decimals at most ("12.5" with 6 -> 12500000n). Anything else
 * (letters, an exponent, too many decimals, an empty box) is `null`: the person is told, never guessed at. `signed` allows a leading minus.
 */
export function parseScaled(text: string, digits: number, opts: { signed?: boolean } = {}): bigint | null {
  const t = westernDigits(text.trim()).replace(/^[−–]/, "-");
  const m = (opts.signed ? /^(-)?(\d{1,15})(?:\.(\d{1,12}))?$/ : /^()(\d{1,15})(?:\.(\d{1,12}))?$/).exec(t);
  if (!m) return null;
  const fraction = m[3] ?? "";
  if (fraction.length > digits) return null;
  const magnitude = BigInt(m[2] ?? "0") * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0");
  return m[1] === "-" ? -magnitude : magnitude;
}

/** A scaled integer back to text: `1250000n, 6` -> "1.25"; whole numbers carry no point; at least `minDecimals` decimals are kept. */
export function formatScaled(value: bigint, digits: number, opts: { minDecimals?: number; group?: boolean } = {}): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const base = 10n ** BigInt(digits);
  const whole = (magnitude / base).toString();
  let fraction = (magnitude % base).toString().padStart(digits, "0");
  const keep = Math.max(0, Math.min(digits, opts.minDecimals ?? 0));
  while (fraction.length > keep && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  const grouped = opts.group === false ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** Integer division rounded half-up for non-negative operands (`b > 0`). */
export function divRound(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (b * 2n);
}

// ───────────────────────────────────────── quantities and conversions ─────────────────────────────────────────

/** Typed quantity text (up to 6 decimals) in micro-units; null when it is not a plain number. */
export function parseQtyMicro(text: string, opts: { signed?: boolean } = {}): bigint | null {
  return parseScaled(text, 6, opts);
}

/** A quantity for the screen: "1,250.5". Accepts a bigint or the safe integer the API carries. */
export function formatQty(micro: bigint | number): string {
  return formatScaled(BigInt(micro), 6);
}

/** A conversion as stored: 1 of the unit = num / den base units. */
export interface Conversion {
  num: number;
  den: number;
}

/** The base-unit micro-quantity of `entered` micro-units of a unit with this conversion; null when it would not be a whole micro-unit. */
export function toBaseMicro(entered: bigint, conversion: Conversion): bigint | null {
  const scaled = entered * BigInt(conversion.num);
  const den = BigInt(conversion.den);
  return scaled % den === 0n ? scaled / den : null;
}

/** The same balance in another unit for the screen: rounded to three decimals (display only, never stored). */
export function displayIn(baseMicro: bigint | number, conversion: Conversion): string {
  const scaled = BigInt(baseMicro) * BigInt(conversion.den);
  const negative = scaled < 0n;
  const rounded = divRound(negative ? -scaled : scaled, BigInt(conversion.num) * 1000n);
  return formatScaled(negative ? -rounded : rounded, 3);
}

/** «1 كرتونة = 24 علبة» as the screen's formula text (the numbers only; the labels are added by the caller). */
export function conversionText(conversion: Conversion): string {
  return conversion.den === 1 ? String(conversion.num) : `${conversion.num}/${conversion.den}`;
}

// ───────────────────────────────────────── money ─────────────────────────────────────────

/** The currencies the receipt form offers, with the number of decimals their minor unit has. */
export const CURRENCIES: Readonly<Record<string, number>> = {
  JOD: 3,
  KWD: 3,
  USD: 2,
  EUR: 2,
  GBP: 2,
  SAR: 2,
  AED: 2,
  EGP: 2,
  ILS: 2,
  TRY: 2,
  SYP: 2,
  CNY: 2,
};

export const DEFAULT_CURRENCY = "JOD";

export function isCurrency(code: unknown): code is string {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function currencyExponent(code: string): number {
  return isCurrency(code) ? (CURRENCIES[code] ?? 2) : 2;
}

/** Typed money to minor units, exact: "12.5" in JOD -> 12500n. No rounding: more decimals than the currency has is `null`. */
export function parseMinor(text: string, currency: string): bigint | null {
  const value = parseScaled(text, currencyExponent(currency));
  return value;
}

/** Minor units for the screen: "1,250.000" (the currency's own decimals, grouped). */
export function formatMinor(minor: bigint | number, currency: string): string {
  return formatScaled(BigInt(minor), currencyExponent(currency), { minDecimals: currencyExponent(currency) });
}

/** The exact total of a receipt line: quantity (micro-units of the entered unit) x the price of ONE entered unit, rounded half-up once. */
export function lineTotalMinor(enteredQtyMicro: bigint, unitCostMinor: bigint): bigint {
  return divRound(enteredQtyMicro * unitCostMinor, MICRO);
}

// ───────────────────────────────────────── the ledger and its average ─────────────────────────────────────────

export interface MovementAmounts {
  qtyMicro: bigint;
  valueMinor: bigint;
}

/** The balance of a material is the SUM of its movements: quantity and value. Nothing else. */
export function balanceOf(movements: Iterable<MovementAmounts>): { qtyMicro: bigint; valueMinor: bigint } {
  let qtyMicro = 0n;
  let valueMinor = 0n;
  for (const m of movements) {
    qtyMicro += m.qtyMicro;
    valueMinor += m.valueMinor;
  }
  return { qtyMicro, valueMinor };
}

/**
 * The value of taking `qtyMicro` (positive) out of a balance of `balanceQty` worth `balanceValue`, at the weighted average of that
 * moment: the whole balance takes the whole value (nothing is left over), a part takes its share rounded half-up.
 */
export function valueOfOut(qtyMicro: bigint, balanceQty: bigint, balanceValue: bigint): bigint {
  if (qtyMicro <= 0n || balanceQty <= 0n) return 0n;
  if (qtyMicro >= balanceQty) return balanceValue < 0n ? 0n : balanceValue;
  return divRound(qtyMicro * (balanceValue < 0n ? 0n : balanceValue), balanceQty);
}

/** The value of bringing `qtyMicro` into a balance by an adjustment: at the current average, or at the last lot's price when nothing is in stock, or nothing. */
export function valueOfIn(qtyMicro: bigint, balanceQty: bigint, balanceValue: bigint, lastLot: { qtyMicro: bigint; totalCostMinor: bigint } | null): bigint {
  if (qtyMicro <= 0n) return 0n;
  if (balanceQty > 0n && balanceValue > 0n) return divRound(qtyMicro * balanceValue, balanceQty);
  if (lastLot && lastLot.qtyMicro > 0n) return divRound(qtyMicro * lastLot.totalCostMinor, lastLot.qtyMicro);
  return 0n;
}

/** The weighted-average price of ONE base unit, as text with six decimals more than the currency's own, trailing zeros trimmed (a sticker costs a fraction of a fils). */
export function averageText(valueMinor: bigint, qtyMicro: bigint, currency: string): string | null {
  if (qtyMicro <= 0n) return null;
  const exponent = currencyExponent(currency);
  const extra = 6;
  const scaled = divRound(valueMinor * 10n ** BigInt(extra) * MICRO, qtyMicro);
  return formatScaled(scaled, exponent + extra, { minDecimals: exponent });
}

/** The formula box of a material: «المتوسط المرجّح = قيمة الرصيد ÷ الرصيد = V ÷ Q = A». Null while there is nothing in stock. */
export interface AverageFormula {
  value: string;
  qty: string;
  average: string;
}

export function averageFormula(valueMinor: bigint, qtyMicro: bigint, currency: string): AverageFormula | null {
  const average = averageText(valueMinor, qtyMicro, currency);
  if (average === null) return null;
  return { value: formatMinor(valueMinor, currency), qty: formatQty(qtyMicro), average };
}

/** A material is low when its balance has come down to its threshold (or below it). No threshold: never. */
export function isLow(balanceMicro: bigint | number, lowStockMicro: bigint | number | null | undefined): boolean {
  if (lowStockMicro === null || lowStockMicro === undefined) return false;
  return BigInt(balanceMicro) <= BigInt(lowStockMicro);
}

/** A BigInt the API may carry as a plain number: the limits above keep every stored value far below 2^53. */
export function toSafeNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError("mfg.e.too_big");
  return n;
}

// ───────────────────────────────────────── dates ─────────────────────────────────────────

/** `YYYY-MM-DD` that is a real calendar day (no 2026-02-31). */
export function isDayText(text: unknown): text is string {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
