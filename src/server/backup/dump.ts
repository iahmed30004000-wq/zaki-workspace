import type { Client } from "pg";

/**
 * THE LOGICAL EXPORT OF THE DATABASE, in pure Node over the `pg` driver (no `pg_dump` binary).
 *
 * WHY NOT pg_dump: the runtime image is node:22-bookworm-slim, which has no PostgreSQL client, and Debian bookworm's own package
 * is version 15 — `pg_dump` refuses to read a newer server (production is 16). Carrying 16 means adding the PGDG apt repository
 * and its signing key to the image build, a network fetch of the image's most delicate step, plus ~30 MB, to protect a deploy that
 * already failed once for exactly this kind of reason (docs/DEPLOYMENT-INCIDENT-2026-10-19.md). `pg` is already a dependency.
 *
 * WHAT THE FILE IS: a plain SQL script of the DATA only (the schema comes from `prisma migrate deploy` on the empty database that
 * receives it; the guide in the app says so). Per table, in foreign-key order, rows go in batches as
 *
 *     INSERT INTO "T" ("a","b") SELECT "a","b" FROM json_populate_recordset(NULL::"T", '[
 *     {"a":1,"b":"x"},
 *     {"a":2,"b":"y"}
 *     ]');
 *
 * Each row is rendered BY POSTGRES (`row_to_json(...)::text`, never parsed in JavaScript), so every column type (bytea, jsonb, arrays,
 * enums, numeric, timestamps) round-trips exactly, and listing the columns lets a column added later take its DEFAULT. A row is
 * exactly one line starting with `{` (JSON escapes every newline), which is what the verifier counts.
 *
 * CONSISTENCY, WITHOUT BLOCKING WRITERS: everything runs in ONE transaction, `SERIALIZABLE READ ONLY DEFERRABLE` (the snapshot
 * `pg_dump --serializable-deferrable` takes): one consistent picture of every table, no predicate locks, no abort, and no lock
 * beyond ACCESS SHARE, so no writer ever waits for it. ⚠️ Only a schema change (a deploy's migration) waits for it. 🔧 It is a few
 * minutes at most, and the container's own restart kills the connection.
 *
 * STREAMING: rows come out of a server-side cursor 500 at a time and are yielded as they are written; nothing is ever collected.
 */

export interface DumpStats {
  tables: number;
  rows: number;
}

export const DUMP_FORMAT = "zaki-sql-v1";
const FETCH_ROWS = 500;
const BATCH_ROWS = 200;
const BATCH_BYTES = 1_000_000;

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const literal = (text: string): string => `'${text.replace(/'/g, "''")}'`;

interface TableInfo {
  oid: string;
  name: string;
}

/** Parents before children (Kahn); a cycle (self reference, mutual keys) is appended in name order: the restore turns key checks off. */
export function orderTables(tables: TableInfo[], edges: Array<{ child: string; parent: string }>): TableInfo[] {
  const byOid = new Map(tables.map((t) => [t.oid, t]));
  const waiting = new Map<string, Set<string>>(tables.map((t) => [t.oid, new Set<string>()]));
  for (const e of edges) {
    if (e.child === e.parent || !byOid.has(e.child) || !byOid.has(e.parent)) continue;
    waiting.get(e.child)?.add(e.parent);
  }
  const out: TableInfo[] = [];
  const done = new Set<string>();
  const sorted = [...tables].sort((a, b) => (a.name < b.name ? -1 : 1));
  for (;;) {
    const ready = sorted.filter((t) => !done.has(t.oid) && [...(waiting.get(t.oid) ?? [])].every((p) => done.has(p)));
    if (ready.length === 0) break;
    for (const t of ready) {
      done.add(t.oid);
      out.push(t);
    }
  }
  for (const t of sorted) if (!done.has(t.oid)) out.push(t);
  return out;
}

/**
 * Writes the dump as text pieces. `client` must be connected and otherwise idle: the generator owns its transaction and ends it
 * (also when the consumer stops early or throws). `stats` is filled as it goes.
 */
export async function* dumpDatabase(client: Client, stats: DumpStats, now: Date = new Date()): AsyncGenerator<string> {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");
  try {
    const tableRows = (
      await client.query<{ oid: string; name: string }>(
        `SELECT c.oid::text AS oid, c.relname AS name
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relname <> '_prisma_migrations'
          ORDER BY c.relname`,
      )
    ).rows;
    const edges = (
      await client.query<{ child: string; parent: string }>(
        `SELECT conrelid::text AS child, confrelid::text AS parent FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
      )
    ).rows;
    const columnRows = (
      await client.query<{ rel: string; name: string; type: string }>(
        `SELECT attrelid::text AS rel, attname AS name, format_type(atttypid, atttypmod) AS type FROM pg_attribute
          WHERE attrelid = ANY($1::text[]::oid[]) AND attnum > 0 AND NOT attisdropped AND attgenerated = '' AND attidentity <> 'a'
          ORDER BY attrelid, attnum`,
        [tableRows.map((t) => t.oid)],
      )
    ).rows;
    const columns = new Map<string, Array<{ name: string; json: "json" | "jsonb" | null }>>();
    for (const c of columnRows) {
      const json = c.type === "jsonb" ? "jsonb" : c.type === "json" ? "json" : null;
      columns.set(c.rel, [...(columns.get(c.rel) ?? []), { name: c.name, json }]);
    }
    const migrations = (await client.query<{ present: string | null }>("SELECT to_regclass('public._prisma_migrations')::text AS present")).rows[0]?.present
      ? (await client.query<{ name: string }>("SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name")).rows.map((r) => r.name)
      : [];
    const sequences = (
      await client.query<{ name: string; value: string }>(
        `SELECT quote_ident(schemaname) || '.' || quote_ident(sequencename) AS name, last_value::text AS value
           FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL ORDER BY sequencename`,
      )
    ).rows;
    const ordered = orderTables(tableRows, edges);

    yield "-- Zaki Workspace logical backup: the DATA of the database, as SQL.\n";
    yield "-- The tables come from `prisma migrate deploy` on an empty database; this file only fills them.\n";
    yield `-- manifest: ${JSON.stringify({ format: DUMP_FORMAT, createdAt: now.toISOString(), tables: ordered.length, migrations })}\n`;
    yield "SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\nSET session_replication_role = replica;\n";

    for (const table of ordered) {
      const cols = columns.get(table.oid) ?? [];
      if (cols.length === 0) continue;
      const colList = cols.map((c) => ident(c.name)).join(", ");
      // A JSON column travels as its TEXT (a JSON string inside the row's JSON) and is parsed back by the INSERT: left as a nested
      // value, a JSON null would come back as an SQL NULL (json_populate_recordset cannot tell them apart) and a column of
      // `json` type would lose its exact text. An SQL NULL stays NULL both ways.
      const readList = cols.map((c) => (c.json ? `${ident(c.name)}::text AS ${ident(c.name)}` : ident(c.name))).join(", ");
      const putList = cols.map((c) => (c.json ? `(${ident(c.name)} #>> '{}')::${c.json}` : ident(c.name))).join(", ");
      const head = `INSERT INTO ${ident(table.name)} (${colList}) SELECT ${putList} FROM json_populate_recordset(NULL::${ident(table.name)}, '[\n`;
      yield `-- table: ${ident(table.name)}\n`;
      stats.tables++;
      let rows = 0;
      let batch: string[] = [];
      let bytes = 0;
      const flush = (): string => {
        const text = `${head}${batch.join(",\n")}\n]');\n`;
        batch = [];
        bytes = 0;
        return text;
      };
      await client.query(`DECLARE zk_backup NO SCROLL CURSOR FOR SELECT row_to_json(s)::text AS j FROM (SELECT ${readList} FROM ${ident(table.name)}) s`);
      try {
        for (;;) {
          const page = await client.query<{ j: string }>(`FETCH FORWARD ${FETCH_ROWS} FROM zk_backup`);
          if (page.rows.length === 0) break;
          for (const r of page.rows) {
            // the quotes are doubled for the SQL string; the JSON itself is left exactly as PostgreSQL wrote it
            const line = r.j.replace(/'/g, "''");
            batch.push(line);
            bytes += line.length + 2;
            rows++;
            if (batch.length >= BATCH_ROWS || bytes >= BATCH_BYTES) yield flush();
          }
        }
        if (batch.length > 0) yield flush();
      } finally {
        await client.query("CLOSE zk_backup").catch(() => undefined);
      }
      stats.rows += rows;
      yield `-- rows: ${ident(table.name)} ${rows}\n`;
    }
    for (const s of sequences) if (/^\d+$/.test(s.value)) yield `SELECT setval(${literal(s.name)}, ${s.value}, true);\n`;
    yield `-- end: tables=${stats.tables} rows=${stats.rows}\n-- complete\n`;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
  }
}
