import { z } from "zod";

/**
 * «المرشد» (the site guide) — THE RULES, in one pure file the server and the browser both read.
 *
 * The guide is a model that can LOOK at the page the owner is on (a list of its controls, each with a reference like `e12`) and ask the
 * browser to do four things: go to a page, point at a control with a note, click one, type into one. It never sees the DOM, never runs code
 * and never names anything but a reference it was given. What the browser does with a request is decided HERE, twice (the server drops
 * what is not allowed, the browser refuses it again): the model's words are never trusted.
 */

/** The page event that asks the guide to open and start its voice call (sent by the «اتصل بالمساعد» button of the assistant's own conversation). */
export const GUIDE_CALL_EVENT = "zaki-guide:call";

export const MAX_ELEMENTS = 120;
export const MAX_NAME_CHARS = 80;
export const MAX_HEADINGS = 12;
export const MAX_ACTIONS_PER_STEP = 6;
export const MAX_STEPS_PER_ASK = 8;
export const MAX_TYPED_CHARS = 500;
export const MAX_HISTORY_TURNS = 6;
export const MAX_BOARD_TEXTS = 40;
export const MAX_BOARD_ITEMS = 12;
export const BOARD_TEXT_CHARS = 200;

export const ELEMENT_ROLES = ["button", "link", "input", "textarea", "select", "checkbox", "tab", "menuitem"] as const;
export type ElementRole = (typeof ELEMENT_ROLES)[number];

const REF = /^e\d{1,3}$/;
export const refSchema = z.string().regex(REF);

export const elementSchema = z
  .object({
    ref: refSchema,
    role: z.enum(ELEMENT_ROLES),
    name: z.string().max(200),
    /** The current value of a field (never of a password), cut short. */
    value: z.string().max(200).optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

export const snapshotSchema = z
  .object({
    path: z.string().max(300),
    title: z.string().max(200),
    headings: z.array(z.string().max(200)).max(MAX_HEADINGS),
    elements: z.array(elementSchema).max(MAX_ELEMENTS),
    /** On a whiteboard page: the words written on the board (texts only), so the guide can answer it. */
    board: z.array(z.string().max(BOARD_TEXT_CHARS)).max(MAX_BOARD_TEXTS).optional(),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;

export const turnSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(1500) }).strict();

export const stepInputSchema = z
  .object({
    /** What the owner asked (absent on a follow-up step of the same ask). */
    message: z.string().trim().min(1).max(1500).optional(),
    history: z.array(turnSchema).max(MAX_HISTORY_TURNS),
    snapshot: snapshotSchema,
    /** What the browser did with the last step's actions: «e3 clicked», «e5 refused», «moved to /tasks». */
    results: z.array(z.string().max(200)).max(MAX_ACTIONS_PER_STEP).optional(),
    /** How many steps this ask has taken (the server stops at `MAX_STEPS_PER_ASK`). */
    step: z.number().int().min(0).max(MAX_STEPS_PER_ASK),
  })
  .strict();
export type StepInput = z.infer<typeof stepInputSchema>;

// ───────────────────────────────────────── what may be asked of the browser ─────────────────────────────────────────

export const BOARD_KINDS = ["note", "box"] as const;
export interface BoardItem {
  kind: (typeof BOARD_KINDS)[number];
  text: string;
  x?: number;
  y?: number;
}

export type GuideAction =
  | { type: "board"; items: BoardItem[] }
  | { type: "navigate"; path: string }
  | { type: "highlight"; ref: string; note: string }
  | { type: "click"; ref: string }
  | { type: "type"; ref: string; text: string };

export const NOTE_MAX = 300;

/** A backslash or a control character anywhere in the text. */
function hasBadChar(text: string): boolean {
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c === 92 || c < 32 || c === 127) return true;
  }
  return false;
}

/** A page of THIS app the guide may open: a path of the app itself, never an API door, a sign-in or sign-out page, a file or another site. */
export function safeGuidePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim();
  if (path.length === 0 || path.length > 200) return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  // no scheme, no backslash, no control character, no dot segments, no query that smuggles a redirect
  if (hasBadChar(path) || path.includes("..") || path.includes("://")) return null;
  const first = path.split("?")[0]?.split("#")[0]?.split("/")[1] ?? "";
  if (["api", "login", "logout", "register", "_next", "go", "uploads", "files"].includes(first.toLowerCase())) return null;
  if (/[?&](next|redirect|url|to|return)=/i.test(path)) return null;
  return path;
}

/**
 * Controls whose name says they delete, send, pay, approve, sign out or change who may do what. The guide may POINT at them, but a click on one
 * is refused by the browser outright (the owner presses it himself): «اعمل لي» never reaches money, deletion or permissions.
 */
const DANGER = /(حذف|احذف|مسح|امسح|إزالة|ازالة|إلغاء الحساب|تسجيل الخروج|خروج|دفع|ادفع|حوّل|حول المبلغ|تحويل مبلغ|أرسل للجميع|ارسل للجميع|إرسال للجميع|صلاحي|رتبة|مالك مشارك|مفتاح|كلمة السر|كلمة المرور|delete|remove|erase|pay\b|payment|transfer|sign ?out|log ?out|password|api key|permission|revoke)/i;

export function isDangerousName(name: string): boolean {
  return DANGER.test(name);
}

/** A field the guide must never read or fill, whatever its name. */
export function isForbiddenField(info: { type?: string; autocomplete?: string; name?: string }): boolean {
  const type = (info.type ?? "").toLowerCase();
  if (type === "password" || type === "file" || type === "hidden") return true;
  if (/(password|passwd|otp|one-time|cc-|card|cvv|secret|token|api[-_ ]?key)/i.test(`${info.autocomplete ?? ""} ${info.name ?? ""}`)) return true;
  return false;
}

/** The text without control characters (each becomes a space), trimmed. */
function plain(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    out += c < 32 || c === 127 ? " " : ch;
  }
  return out.trim();
}

/** What the guide may put on a whiteboard: short notes and labelled boxes, a handful at a time, inside the board's visible area. */
export function cleanBoardItems(raw: unknown): BoardItem[] {
  if (!Array.isArray(raw)) return [];
  const out: BoardItem[] = [];
  for (const r of raw.slice(0, MAX_BOARD_ITEMS)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const kind = o["kind"] === "box" ? "box" : "note";
    const text = typeof o["text"] === "string" ? plain(o["text"]).slice(0, BOARD_TEXT_CHARS) : "";
    if (!text) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(4000, Math.max(-4000, Math.round(v))) : undefined);
    const x = num(o["x"]);
    const y = num(o["y"]);
    out.push({ kind, text, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) });
  }
  return out;
}

/** The model's words into the actions that survive: known references only, safe paths only, bounded text. */
export function cleanActions(raw: readonly { name: string; input: unknown }[], knownRefs: ReadonlySet<string>): { actions: GuideAction[]; dropped: number } {
  const actions: GuideAction[] = [];
  let dropped = 0;
  for (const call of raw) {
    if (actions.length >= MAX_ACTIONS_PER_STEP) {
      dropped += 1;
      continue;
    }
    const input = call.input && typeof call.input === "object" && !Array.isArray(call.input) ? (call.input as Record<string, unknown>) : {};
    const ref = typeof input["ref"] === "string" ? input["ref"] : "";
    if (call.name === "navigate") {
      const path = safeGuidePath(input["path"]);
      if (path) actions.push({ type: "navigate", path });
      else dropped += 1;
    } else if (call.name === "highlight") {
      const note = typeof input["note"] === "string" ? input["note"].replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, NOTE_MAX) : "";
      if (knownRefs.has(ref)) actions.push({ type: "highlight", ref, note });
      else dropped += 1;
    } else if (call.name === "board_write") {
      const items = cleanBoardItems(input["items"]);
      if (items.length > 0) actions.push({ type: "board", items });
      else dropped += 1;
    } else if (call.name === "click") {
      if (knownRefs.has(ref)) actions.push({ type: "click", ref });
      else dropped += 1;
    } else if (call.name === "type") {
      const text = typeof input["text"] === "string" ? input["text"].replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").slice(0, MAX_TYPED_CHARS) : "";
      if (knownRefs.has(ref) && text.length > 0) actions.push({ type: "type", ref, text });
      else dropped += 1;
    } else {
      dropped += 1;
    }
    // a page change ends the batch: whatever came after it was meant for a page that is gone
    if (actions.at(-1)?.type === "navigate") break;
  }
  return { actions, dropped };
}
