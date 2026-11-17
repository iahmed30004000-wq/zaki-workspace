import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { loadInternal, canSeeRaters } from "@/server/services/card-guards";
import { CARD_AUDIT_PREFIX } from "@/server/services/card-audit";
import type { LogAction, LogEntry } from "@/lib/cards/page";

/**
 * «السجل»: a read-only timeline made of the AuditLog rows written about this card. It says what happened, who did it and
 * when. Two things it never says: anybody's stars (a rating line says only that the stars changed, and whose it was only
 * to the owner and the card's creator), and anything about a private note (those leave no line at all).
 */

const ACTIONS: ReadonlySet<string> = new Set<LogAction>([
  "created",
  "edited",
  "restored",
  "status",
  "pinned",
  "sent",
  "task",
  "archived",
  "unarchived",
  "rated",
  "image_added",
  "image_removed",
  "cover",
  "copied",
]);

const LOG_LIMIT = 200;

type Detail = LogEntry["detail"];

/** Only the small facts a line shows, whatever else the row carries. */
function detailOf(action: LogAction, meta: unknown): Detail {
  const m = typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>) : {};
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  switch (action) {
    case "edited":
      return { version: num(m["version"]), fields: Array.isArray(m["fields"]) ? m["fields"].filter((f) => typeof f === "string").join(",") : null };
    case "restored":
      return { fromVersion: num(m["fromVersion"]), version: num(m["version"]) };
    case "status":
      return { from: str(m["from"]), to: str(m["to"]) };
    case "pinned":
      return { pinned: m["pinned"] === true };
    case "image_added":
    case "image_removed":
      return { name: str(m["name"]) };
    case "cover":
      return { name: str(m["name"]), removed: m["removed"] === true };
    case "copied":
      return { what: str(m["what"]) };
    default:
      return {};
  }
}

export async function listLog(actor: Actor, cardId: string): Promise<LogEntry[]> {
  const { scope, row } = await loadInternal(actor, cardId);
  const raterNames = canSeeRaters(scope, row);
  const rows = await db.auditLog.findMany({
    where: { orgId: actor.orgId, target: row.id, action: { startsWith: CARD_AUDIT_PREFIX } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LOG_LIMIT,
    select: { id: true, action: true, actorId: true, createdAt: true, meta: true },
  });
  const actorIds = Array.from(new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : []))));
  const names = new Map(
    (actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]),
  );
  const entries: LogEntry[] = [];
  for (const r of rows) {
    const action = r.action.slice(CARD_AUDIT_PREFIX.length);
    if (!ACTIONS.has(action)) continue;
    const a = action as LogAction;
    entries.push({
      id: r.id,
      action: a,
      at: r.createdAt.toISOString(),
      actorName: a === "rated" && !raterNames ? null : r.actorId ? (names.get(r.actorId) ?? null) : null,
      detail: detailOf(a, r.meta),
    });
  }
  // a card made before the log existed still begins with «أُنشئت»
  if (!entries.some((e) => e.action === "created")) {
    entries.push({ id: "created", action: "created", at: row.createdAt.toISOString(), actorName: row.createdBy.name, detail: {} });
  }
  return entries;
}
