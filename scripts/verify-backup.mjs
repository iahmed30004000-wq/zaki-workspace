#!/usr/bin/env node
/**
 * يتحقق من نسخة احتياطية من غير ما يرجّعها: بيفك التشفير وبيعدّ الجداول والسجلات.
 * Checks a database backup WITHOUT restoring it: decrypts, gunzips, and counts the tables and rows.
 *
 *   ENCRYPTION_KEY=<the server's key> node scripts/verify-backup.mjs backup.zbk
 *
 * Exit code 0: the file opens with this key, was not cut, the script is complete and the counts noted per table match the rows
 * present. 1: it does not. 2: wrong use. Prints only counts (never a row). Same rules as the app's own «تحقّق»
 * (src/server/backup/verify.ts); tests/backup-verify.test.ts keeps the two in step.
 */
import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { createGunzip } from "node:zlib";
import { pathToFileURL } from "node:url";
import { BackupCryptoError, decryptBackup } from "./decrypt-backup.mjs";

const FORMAT = "zaki-sql-v1";

export class DumpCounter {
  tables = 0;
  rows = 0;
  current = null;
  inCurrent = 0;
  noted = new Map();
  actual = new Map();
  complete = false;
  formatOk = false;
  endNoted = null;

  line(text) {
    if (text.startsWith("{")) {
      this.inCurrent++;
      this.rows++;
      return;
    }
    if (text.startsWith("-- table: ")) {
      this.closeCurrent();
      this.current = text.slice("-- table: ".length);
      this.inCurrent = 0;
      this.tables++;
    } else if (text.startsWith("-- rows: ")) {
      const rest = text.slice("-- rows: ".length);
      const at = rest.lastIndexOf(" ");
      if (at > 0) this.noted.set(rest.slice(0, at), Number(rest.slice(at + 1)));
      this.closeCurrent();
    } else if (text.startsWith("-- manifest: ")) {
      try {
        this.formatOk = JSON.parse(text.slice("-- manifest: ".length)).format === FORMAT;
      } catch {
        this.formatOk = false;
      }
    } else if (text.startsWith("-- end: ")) {
      const m = /^-- end: tables=(\d+) rows=(\d+)$/.exec(text);
      if (m) this.endNoted = { tables: Number(m[1]), rows: Number(m[2]) };
    } else if (text === "-- complete") {
      this.complete = true;
    }
  }

  closeCurrent() {
    if (this.current !== null) this.actual.set(this.current, this.inCurrent);
    this.current = null;
  }

  result() {
    this.closeCurrent();
    const base = { tables: this.tables, rows: this.rows };
    if (!this.formatOk) return { ok: false, ...base, error: "الملف مش بصيغة النسخ الاحتياطي المعروفة أو تالف." };
    if (!this.complete || !this.endNoted) return { ok: false, ...base, error: "الملف ناقص: ما وصلنا لآخر النسخة." };
    let match = this.endNoted.tables === this.tables && this.endNoted.rows === this.rows && this.noted.size === this.actual.size;
    for (const [name, n] of this.actual) if (this.noted.get(name) !== n) match = false;
    return match ? { ok: true, ...base, error: null } : { ok: false, ...base, error: "الأعداد المسجّلة جوّا الملف ما بتطابق اللي فيه فعلًا." };
  }
}

/** Verifies an encrypted backup given as a byte stream (the same answer the app's «تحقّق» gives). */
export async function verifyBackupStream(source, masterKey) {
  const counter = new DumpCounter();
  try {
    await pipeline(Readable.from(decryptBackup(source, masterKey)), createGunzip(), async (plain) => {
      const decoder = new StringDecoder("utf8");
      let rest = "";
      for await (const chunk of plain) {
        rest += decoder.write(chunk);
        let from = 0;
        for (let at = rest.indexOf("\n", from); at >= 0; at = rest.indexOf("\n", from)) {
          counter.line(rest.slice(from, at));
          from = at + 1;
        }
        rest = rest.slice(from);
      }
      rest += decoder.end();
      if (rest) counter.line(rest);
    });
  } catch (err) {
    if (err instanceof BackupCryptoError) {
      const error = err.code === "truncated" ? "الملف ناقص (انقطع قبل ما يخلص)." : err.code === "auth" ? "ما انفتح: المفتاح غلط أو الملف تالف." : "هاد الملف مش نسخة احتياطية من Zaki Workspace.";
      return { ok: false, tables: counter.tables, rows: counter.rows, error };
    }
    return { ok: false, tables: counter.tables, rows: counter.rows, error: "الملف تالف." };
  }
  return counter.result();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2];
  const key = process.env.ENCRYPTION_KEY;
  if (!input || !key || key.length < 32) {
    console.error("الاستعمال:  ENCRYPTION_KEY=... node scripts/verify-backup.mjs <الملف المشفّر>");
    process.exitCode = 2;
  } else if (!existsSync(input)) {
    console.error(`الملف مش موجود: ${input}`);
    process.exitCode = 2;
  } else {
    const verdict = await verifyBackupStream(createReadStream(input), key);
    if (verdict.ok) console.log(`سليمة: ${verdict.tables} جدول و${verdict.rows} سجل.`);
    else console.error(`فيها مشكلة: ${verdict.error} (قرأنا ${verdict.tables} جدول و${verdict.rows} سجل قبل ما نتوقف).`);
    process.exitCode = verdict.ok ? 0 : 1;
  }
}
