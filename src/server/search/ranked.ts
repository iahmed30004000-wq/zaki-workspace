import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { ArabicSearch } from "@/lib/search/arabic";

/**
 * ARABIC-TOLERANT SEARCH, the database half (the pattern itself is src/lib/search/arabic.ts).
 *
 * Prisma cannot say `~*`, and a migration for an extension is not allowed, so the match is done in two steps and the
 * ACCESS RULE NEVER MOVES:
 *   1. `idsMatching` — one parameterised query that returns only IDS: the rows of one table whose text column
 *      matches the pattern, narrowed by coarse conditions the caller passes (organisation, spaces, soft-delete…) so
 *      the pool is small. It is a pool, not a verdict.
 *   2. the caller's EXISTING Prisma query — the very same `where` as before (team scope, membership, guest rules,
 *      soft-delete, the owner's silent oversight) with `id: { in: ids }` in place of the old `contains`. Whatever
 *      step 1 returned, a row the person may not read is not returned by step 2.
 * `rankedSearch` runs the two steps page by page until enough rows survive step 2, so a pool full of rows the
 * person may not see cannot hide the ones they may.
 *
 * ⚠️ `~*` over a big table is a sequential scan. 🔧 The pool is cut by the caller's conditions and LIMIT; if it ever
 * hurts, a trigram index on a normalised copy of the column is the later fix (not added: no extension, no migration).
 */

/** The text column each searchable table is matched on. A fixed list: an identifier never comes from input. */
const COLUMN = {
  Task: "title",
  Project: "name",
  Conversation: "title",
  ChatMessage: "body",
  StoredFile: "name",
  User: "name",
  Document: "title",
} as const;
export type SearchTable = keyof typeof COLUMN;

/** `col IN (a, b, c)` as a bound fragment — and FALSE for an empty list (an empty IN is a syntax error). */
export function sqlIn(column: string, values: readonly string[]): Prisma.Sql {
  return values.length === 0 ? Prisma.sql`FALSE` : Prisma.sql`${Prisma.raw(`"${column}"`)} IN (${Prisma.join(values)})`;
}

export interface IdsQuery {
  table: SearchTable;
  search: ArabicSearch;
  /** Coarse conditions, ANDed. Every one is a bound fragment (`Prisma.sql`), never a string built from input. */
  where: Prisma.Sql[];
  /** Titles / names that START with the words first, then the ones that contain them, then `order`. */
  rank: boolean;
  /** The order after the rank (a fixed fragment), e.g. `Prisma.sql\`"updatedAt" DESC\``. The id breaks ties. */
  order: Prisma.Sql;
  offset?: number;
  limit: number;
}

/** The ids of one page of the pool, in the order the person should see them. */
export async function idsMatching(q: IdsQuery): Promise<string[]> {
  const column = Prisma.raw(`"${COLUMN[q.table]}"`);
  const table = Prisma.raw(`"${q.table}"`);
  const where = q.where.length ? Prisma.join(q.where, " AND ") : Prisma.sql`TRUE`;
  const rank = q.rank ? Prisma.sql`(${column} ~* ${q.search.prefix}) DESC,` : Prisma.empty;
  const rows = await db.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM ${table} WHERE (${where}) AND ${column} ~* ${q.search.source} ORDER BY ${rank} ${q.order}, "id" LIMIT ${q.limit} OFFSET ${q.offset ?? 0}`,
  );
  return rows.map((r) => r.id);
}

const POOL = 150;
const PAGES = 5;

/**
 * The rows that pass BOTH steps, best first, at most `take`. `load` is the caller's Prisma query with its full
 * access `where` and `id: { in: ids }`; its order is ignored (the order of the ids wins).
 */
export async function rankedSearch<T extends { id: string }>(opts: {
  query: Omit<IdsQuery, "offset" | "limit">;
  load: (ids: string[]) => Promise<T[]>;
  take: number;
}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < PAGES && out.length < opts.take; page++) {
    const ids = await idsMatching({ ...opts.query, offset: page * POOL, limit: POOL });
    if (ids.length === 0) break;
    const rows = await opts.load(ids);
    const at = new Map(ids.map((id, i) => [id, i]));
    out.push(...rows.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0)));
    if (ids.length < POOL) break;
  }
  return out.slice(0, opts.take);
}
