import { findOrderNumbers } from "@/lib/oms/order-ref";

/**
 * The rules that decide when a message gets a ticket, or a «بدك تعمليها تذكرة؟» chip (Q1.5; `Organization.settings.autoTicketRules`, edited with
 * «ضبط التصعيد»). Three ways in all: by TOPIC (every new human message of one topic), by CONTENT (an order number AND a problem word, anywhere in the
 * space) and by HAND («🎫 مشكلة», which needs no rule). Mode: «اقترح» (a chip, one tap) or «تلقائي» (the ticket is made at once). A content rule
 * defaults to «اقترح», a topic rule to «تلقائي» (D-Q1). Pure: the server and the screen read it the same way.
 */
export type RuleMode = "suggest" | "auto";

export interface AutoRule {
  id: string;
  type: "topic" | "content";
  spaceId: string;
  /** a topic rule: the topic */
  conversationId?: string;
  /** a content rule: the words (the defaults when absent) */
  problemWords?: string[];
  kindKey: string;
  mode?: RuleMode;
  /** who gets it when nobody is @-mentioned (a department, else a person) */
  departmentId?: string | null;
  assigneeId?: string | null;
}

/** The problem words of the real week (an editable list). */
export const DEFAULT_PROBLEM_WORDS: readonly string[] = ["مشكلة", "متأخر", "ما وصل", "ما وصلت", "رقم غلط", "مرتجع", "ملغي", "مكرر", "ما بيرد", "تأجيل", "تعديل", "شكوى", "ضايع", "تالف"];

export function ruleMode(rule: AutoRule): RuleMode {
  return rule.mode ?? (rule.type === "topic" ? "auto" : "suggest");
}

export function matchRule(rule: AutoRule, message: { body: string; conversationId: string; spaceId: string | null }): boolean {
  if (message.spaceId !== rule.spaceId) return false;
  if (rule.type === "topic") return rule.conversationId === message.conversationId;
  if (findOrderNumbers(message.body).length === 0) return false;
  const words = rule.problemWords?.length ? rule.problemWords : DEFAULT_PROBLEM_WORDS;
  return words.some((w) => w && message.body.includes(w));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const idLike = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/** The company's rules: the valid ones only (a bad entry or a repeated id is dropped, never trusted). */
export function autoRulesOf(settings: unknown): AutoRule[] {
  const raw = isObj(settings) ? settings["autoTicketRules"] : undefined;
  if (!Array.isArray(raw)) return [];
  const out: AutoRule[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!isObj(r) || !idLike(r["id"]) || seen.has(r["id"])) continue;
    if (r["type"] !== "topic" && r["type"] !== "content") continue;
    if (!idLike(r["spaceId"]) || typeof r["kindKey"] !== "string" || !/^[a-z][a-z0-9_]{1,40}$/.test(r["kindKey"])) continue;
    if (r["mode"] !== undefined && r["mode"] !== "suggest" && r["mode"] !== "auto") continue;
    if (r["type"] === "topic" && !idLike(r["conversationId"])) continue;
    const words = Array.isArray(r["problemWords"]) ? r["problemWords"].filter((w): w is string => typeof w === "string" && w.trim().length > 0 && w.length <= 40).slice(0, 40) : undefined;
    seen.add(r["id"]);
    out.push({
      id: r["id"],
      type: r["type"],
      spaceId: r["spaceId"],
      kindKey: r["kindKey"],
      ...(r["type"] === "topic" ? { conversationId: r["conversationId"] as string } : {}),
      ...(words && words.length ? { problemWords: words } : {}),
      ...(r["mode"] ? { mode: r["mode"] as RuleMode } : {}),
      ...(idLike(r["departmentId"]) ? { departmentId: r["departmentId"] } : {}),
      ...(idLike(r["assigneeId"]) ? { assigneeId: r["assigneeId"] } : {}),
    });
  }
  return out;
}
