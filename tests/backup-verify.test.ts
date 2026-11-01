import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encryptBackup } from "@/server/backup/envelope";
import { DUMP_FORMAT, orderTables } from "@/server/backup/dump";
import { DumpCounter, verifyBackupStream } from "@/server/backup/verify";
import { verifyBackupStream as scriptVerify } from "../scripts/verify-backup.mjs";

/**
 * «تحقّق»: opens a backup without restoring it and counts what it holds. The app's check (src/server/backup/verify.ts) and the
 * owner's script (scripts/verify-backup.mjs) must give the same verdict on the same file.
 */

const KEY = "v".repeat(16) + "verify-test-key-0123456789abcd";
const OTHER = "w".repeat(16) + "another-key-0123456789abcdefgh";

function dump(over: { manifest?: string | null; complete?: boolean; noteRows?: Record<string, number>; end?: string | null } = {}): string {
  const rows = { User: 2, Task: 1 };
  const noted = { ...rows, ...(over.noteRows ?? {}) };
  const lines = [
    "-- Zaki Workspace logical backup",
    over.manifest === null ? "-- nothing" : (over.manifest ?? `-- manifest: ${JSON.stringify({ format: DUMP_FORMAT, createdAt: "2026-11-10T00:00:00Z", tables: 2, migrations: ["a", "b"] })}`),
    "SET client_encoding = 'UTF8';",
    `-- table: "User"`,
    `INSERT INTO "User" ("id") SELECT "id" FROM json_populate_recordset(NULL::"User", '[`,
    `{"id":"u1","name":"it''s -- fine"},`,
    `{"id":"u2"}`,
    "]');",
    `-- rows: "User" ${noted.User}`,
    `-- table: "Task"`,
    `INSERT INTO "Task" ("id") SELECT "id" FROM json_populate_recordset(NULL::"Task", '[`,
    `{"id":"t1"}`,
    "]');",
    `-- rows: "Task" ${noted.Task}`,
    over.end === null ? "-- (no end)" : (over.end ?? "-- end: tables=2 rows=3"),
    ...(over.complete === false ? [] : ["-- complete"]),
    "",
  ];
  return lines.join("\n");
}

const seal = async (sql: string, key = KEY): Promise<Buffer> => {
  const parts: Buffer[] = [];
  for await (const p of encryptBackup(Readable.from([gzipSync(Buffer.from(sql, "utf8"))]), key, 256)) parts.push(p);
  return Buffer.concat(parts);
};

const both = async (file: Buffer, key = KEY) => {
  const app = await verifyBackupStream(Readable.from([file]), key);
  const script = await scriptVerify(Readable.from([file]), key);
  expect(script.ok, "the script and the app agree").toBe(app.ok);
  expect(script.tables).toBe(app.tables);
  expect(script.rows).toBe(app.rows);
  return app;
};

describe("verify", () => {
  it("counts the tables and the rows of a good backup (a row is one line starting with «{», a quote or «--» inside it changes nothing)", async () => {
    const v = await both(await seal(dump()));
    expect(v).toEqual({ ok: true, tables: 2, rows: 3, errorKey: null });
  });

  it("a script cut before «-- complete» is incomplete", async () => {
    const v = await both(await seal(dump({ complete: false })));
    expect(v.ok).toBe(false);
    expect(v.errorKey).toBe("backup.err.verify_incomplete");
  });

  it("a row count noted per table that does not match the rows present is a mismatch", async () => {
    expect((await both(await seal(dump({ noteRows: { User: 5 } })))).errorKey).toBe("backup.err.verify_mismatch");
    expect((await both(await seal(dump({ end: "-- end: tables=2 rows=99" })))).errorKey).toBe("backup.err.verify_mismatch");
  });

  it("a file that is not a dump of this format is damaged", async () => {
    expect((await both(await seal(dump({ manifest: null })))).errorKey).toBe("backup.err.verify_damaged");
    expect((await both(await seal(dump({ manifest: `-- manifest: ${JSON.stringify({ format: "other" })}` })))).errorKey).toBe("backup.err.verify_damaged");
  });

  it("a wrong key, a cut file and a file that is not gzip each say so", async () => {
    const file = await seal(dump());
    expect((await both(file, OTHER)).errorKey).toBe("backup.err.verify_key");
    expect((await both(file.subarray(0, file.length - 30))).ok).toBe(false);
    // encrypted fine, but the inside is not gzip
    const parts: Buffer[] = [];
    for await (const p of encryptBackup(Readable.from([Buffer.from("plain text, not gzip")]), KEY, 256)) parts.push(p);
    expect((await both(Buffer.concat(parts))).errorKey).toBe("backup.err.verify_damaged");
  });
});

describe("DumpCounter", () => {
  it("reads lines the way the writer wrote them", () => {
    const c = new DumpCounter();
    for (const line of dump().split("\n")) c.line(line);
    expect(c.result()).toEqual({ ok: true, tables: 2, rows: 3, errorKey: null });
  });
});

describe("the order of the tables in a dump", () => {
  const t = (name: string) => ({ oid: name, name });
  it("puts a parent before its children, whatever the names say", () => {
    const tables = [t("Task"), t("Project"), t("Board"), t("Comment")];
    const out = orderTables(tables, [
      { child: "Task", parent: "Project" },
      { child: "Board", parent: "Project" },
      { child: "Comment", parent: "Task" },
    ]).map((x) => x.name);
    expect(out.indexOf("Project")).toBeLessThan(out.indexOf("Task"));
    expect(out.indexOf("Task")).toBeLessThan(out.indexOf("Comment"));
    expect(out.indexOf("Project")).toBeLessThan(out.indexOf("Board"));
    expect(out.length).toBe(4);
  });

  it("a table that points at itself, or two that point at each other, still come out (the restore turns key checks off)", () => {
    const self = orderTables([t("A"), t("B")], [{ child: "A", parent: "A" }]).map((x) => x.name);
    expect(self).toEqual(["A", "B"]);
    const cycle = orderTables([t("A"), t("B"), t("C")], [{ child: "A", parent: "B" }, { child: "B", parent: "A" }]).map((x) => x.name);
    expect(cycle.sort()).toEqual(["A", "B", "C"]);
    // a key to a table that is not in the dump (a skipped one) does not hold anything back
    expect(orderTables([t("A")], [{ child: "A", parent: "Gone" }]).map((x) => x.name)).toEqual(["A"]);
  });
});
