import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { BackupCryptoError, decryptBackup } from "./envelope";
import { DUMP_FORMAT } from "./dump";

/**
 * «تحقّق»: opens a backup (decrypt, gunzip), reads the dump from start to end WITHOUT restoring it, and reports what it holds.
 * It checks that the file opens with this key and was not cut (every chunk is authenticated, the last one says «final»), that the
 * script is complete (`-- complete`), and that the row counts the writer noted per table match the rows actually present.
 * scripts/verify-backup.mjs does the same on a file on the owner's own machine (tests/backup-verify.test.ts keeps them in step).
 */

export type VerifyErrorKey = "backup.err.verify_key" | "backup.err.verify_damaged" | "backup.err.verify_incomplete" | "backup.err.verify_mismatch";

export interface VerifyResult {
  ok: boolean;
  tables: number;
  rows: number;
  errorKey: VerifyErrorKey | null;
}

/** Counts a dump's tables and rows from its lines. Pure (no streams), so the script and the test share the rule. */
export class DumpCounter {
  tables = 0;
  rows = 0;
  private current: string | null = null;
  private inCurrent = 0;
  private noted = new Map<string, number>();
  private actual = new Map<string, number>();
  complete = false;
  formatOk = false;
  endNoted: { tables: number; rows: number } | null = null;

  line(text: string): void {
    // a row is one line starting with «{» (the dump's JSON has no raw newline)
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
        this.formatOk = (JSON.parse(text.slice("-- manifest: ".length)) as { format?: unknown }).format === DUMP_FORMAT;
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

  private closeCurrent(): void {
    if (this.current !== null) this.actual.set(this.current, this.inCurrent);
    this.current = null;
  }

  result(): VerifyResult {
    this.closeCurrent();
    if (!this.formatOk) return { ok: false, tables: this.tables, rows: this.rows, errorKey: "backup.err.verify_damaged" };
    if (!this.complete || !this.endNoted) return { ok: false, tables: this.tables, rows: this.rows, errorKey: "backup.err.verify_incomplete" };
    let match = this.endNoted.tables === this.tables && this.endNoted.rows === this.rows && this.noted.size === this.actual.size;
    for (const [name, n] of this.actual) if (this.noted.get(name) !== n) match = false;
    return { ok: match, tables: this.tables, rows: this.rows, errorKey: match ? null : "backup.err.verify_mismatch" };
  }
}

/** Verifies an encrypted backup given as a byte stream. Never throws for a bad file: the answer says which way it is bad. */
export async function verifyBackupStream(source: AsyncIterable<Uint8Array>, masterKey: string): Promise<VerifyResult> {
  const counter = new DumpCounter();
  try {
    await pipeline(Readable.from(decryptBackup(source, masterKey)), createGunzip(), async (plain: AsyncIterable<Buffer>) => {
      // TextDecoder, not string_decoder: Next's bundler of the instrumentation entry cannot resolve that module
      const decoder = new TextDecoder("utf-8");
      let rest = "";
      for await (const chunk of plain) {
        rest += decoder.decode(chunk, { stream: true });
        let from = 0;
        for (let at = rest.indexOf("\n", from); at >= 0; at = rest.indexOf("\n", from)) {
          counter.line(rest.slice(from, at));
          from = at + 1;
        }
        rest = rest.slice(from);
      }
      rest += decoder.decode();
      if (rest) counter.line(rest);
    });
  } catch (err) {
    const damaged = err instanceof BackupCryptoError ? err.code : null;
    // a wrong key and a damaged file look the same to GCM: the screen says both, in one sentence
    if (damaged === "auth" || damaged === "bad_magic" || damaged === "bad_version") return { ok: false, tables: 0, rows: 0, errorKey: "backup.err.verify_key" };
    if (damaged === "truncated") return { ok: false, tables: counter.tables, rows: counter.rows, errorKey: "backup.err.verify_incomplete" };
    return { ok: false, tables: counter.tables, rows: counter.rows, errorKey: "backup.err.verify_damaged" };
  }
  return counter.result();
}
