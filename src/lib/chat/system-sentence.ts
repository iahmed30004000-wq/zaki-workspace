import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";

/**
 * The Arabic line of a system message («تثبيت رسالة بواسطة سارة») from its `{k, p}` and its author.
 * One place for the conversation screen and the chat home's last-message preview, so neither ever
 * shows the raw JSON a system row keeps in `body`. An unknown key reads as a neutral update.
 */
export function systemSentence(meta: { k: string; p?: Record<string, string | number> } | null | undefined, name: string): string {
  const key = meta ? `chatc.sys.${meta.k}` : "";
  const template = (key && AR[key]) || AR["chatc.sys.other"] || "";
  // a line may carry its own words (the automatic rules': «القاعدة «...»: ...»); `name` is always the author's and cannot be replaced by them
  return interpolate(template, { ...(meta?.p ?? {}), name });
}

/** `systemSentence` straight from a stored row's `body` (the JSON `{k, p}`); unparsable reads as an update. */
export function systemSentenceOfBody(body: string, name: string): string {
  try {
    const meta = JSON.parse(body) as { k?: unknown; p?: unknown };
    const p = meta?.p && typeof meta.p === "object" ? (meta.p as Record<string, string | number>) : undefined;
    return systemSentence(typeof meta?.k === "string" ? { k: meta.k, ...(p ? { p } : {}) } : null, name);
  } catch {
    return systemSentence(null, name);
  }
}
