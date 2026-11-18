import { replaceEqualDeep, type QueryClient } from "@tanstack/react-query";
import { CHAT_GC_MS, CHAT_STALE_MS } from "@/lib/chat/cache/constants";
import { chatKeys } from "@/lib/chat/cache/keys";

/**
 * C1.4 — structural sharing BY ID. TanStack Query keeps the objects of the old data that did not change, but compares arrays
 * position by position: when a row moves up the list (a new message) every row between its old place and its new one gets a new
 * object, and every row component that subscribed to its row re-renders. Here an object is looked up by its `id` first, so only
 * the row (or the message) that really changed is a new object — «a new message re-renders one row and moves it, never the whole
 * list», and a window that gets an older page in front keeps every message it had.
 */

type Rowish = { id: string };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hasRows = (v: unknown): v is { rows: Rowish[] } => isObject(v) && Array.isArray(v["rows"]) && (v["rows"] as unknown[]).every((r) => isObject(r) && typeof r["id"] === "string");
const hasPages = (v: unknown): v is { pages: { messages?: Rowish[] }[]; pageParams: unknown[] } => isObject(v) && Array.isArray(v["pages"]) && Array.isArray(v["pageParams"]);

function shareById<T extends Rowish>(old: T[], next: T[]): T[] {
  const byId = new Map(old.map((o) => [o.id, o]));
  return next.map((n) => {
    const o = byId.get(n.id);
    return o ? replaceEqualDeep(o, n) : n;
  });
}

export function shareChatData(old: unknown, next: unknown): unknown {
  if (old === next) return old;
  if (hasRows(old) && hasRows(next)) {
    const rows = shareById(old.rows, next.rows);
    const sameOrder = rows.length === old.rows.length && rows.every((r, i) => r === old.rows[i]);
    const merged = { ...(next as Record<string, unknown>), rows: sameOrder ? old.rows : rows };
    return sameOrder ? replaceEqualDeep(old, merged) : merged;
  }
  if (hasPages(old) && hasPages(next)) {
    const known = old.pages.flatMap((p) => p.messages ?? []);
    const pages = next.pages.map((p, i) => {
      if (!p.messages) return p;
      const merged = { ...p, messages: shareById(known, p.messages) };
      const prev = old.pages[i];
      // the old page object comes back when nothing in it changed
      return prev?.messages && prev.messages.length === merged.messages.length && merged.messages.every((m, j) => m === prev.messages![j]) ? replaceEqualDeep(prev, merged) : merged;
    });
    const pageParams = replaceEqualDeep(old.pageParams, next.pageParams);
    return pages.length === old.pages.length && pages.every((p, i) => p === old.pages[i]) && pageParams === old.pageParams ? old : { ...next, pages, pageParams };
  }
  return replaceEqualDeep(old, next);
}

const installed = new WeakSet<QueryClient>();

/** What every chat query inherits: how long it is believed, how long it is kept without a screen, and the sharing by id. Once per client. */
export function installChatDefaults(qc: QueryClient): void {
  if (installed.has(qc)) return;
  installed.add(qc);
  qc.setQueryDefaults(chatKeys.all(), { gcTime: CHAT_GC_MS, staleTime: CHAT_STALE_MS, structuralSharing: shareChatData });
}
