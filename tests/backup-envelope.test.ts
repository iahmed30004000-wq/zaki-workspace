import { hkdfSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { BACKUP_KEY_INFO, BackupCryptoError, HEADER_BYTES, decryptBackup, deriveBackupKey, encryptBackup } from "@/server/backup/envelope";
import { BackupCryptoError as ScriptCryptoError, decryptBackup as scriptDecrypt, KEY_INFO as SCRIPT_KEY_INFO } from "../scripts/decrypt-backup.mjs";

/**
 * The envelope of a backup file: AES-256-GCM in authenticated chunks, key = HKDF(ENCRYPTION_KEY, the file's own salt, its own label).
 * A round trip, every way a file can be damaged, a wrong key, and the standalone script (which the owner runs on his own machine)
 * reading what the app writes.
 */

const KEY = "k".repeat(16) + "unit-test-key-0123456789abcdef"; // 46 chars
const OTHER_KEY = "z".repeat(16) + "another-key-0123456789abcdef-xx";
const SMALL = 64; // a tiny chunk, so a few hundred bytes make many chunks

const bytes = (n: number) => randomBytes(n);

async function collect(it: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const p of it) parts.push(Buffer.from(p));
  return Buffer.concat(parts);
}

const seal = async (plain: Buffer, key = KEY, chunk = SMALL, pieces = 1): Promise<Buffer> => {
  // feed it in `pieces` parts, so the chunking never depends on how the source happens to split
  const step = Math.max(1, Math.ceil(plain.length / pieces));
  const source = (async function* () {
    for (let i = 0; i < plain.length; i += step) yield plain.subarray(i, i + step);
  })();
  return collect(encryptBackup(source, key, chunk));
};

const open = (file: Buffer, key = KEY): Promise<Buffer> => collect(decryptBackup(Readable.from([file]), key));

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "no error";
  } catch (err) {
    return err instanceof BackupCryptoError || err instanceof ScriptCryptoError ? (err as { code: string }).code : `other: ${String(err)}`;
  }
}

describe("the round trip", () => {
  it.each([0, 1, 63, 64, 65, 127, 128, 129, 1000, 64 * 50])("%i bytes come back exactly (any size, on and around the chunk boundary)", async (n) => {
    const plain = bytes(n);
    expect(await open(await seal(plain))).toEqual(plain);
  });

  it("does not depend on how the source or the file is split", async () => {
    const plain = bytes(1000);
    for (const pieces of [1, 3, 17, 1000]) expect(await open(await seal(plain, KEY, SMALL, pieces))).toEqual(plain);
    const file = await seal(plain);
    // the file arriving a byte at a time
    const trickle = (async function* () {
      for (let i = 0; i < file.length; i += 7) yield file.subarray(i, i + 7);
    })();
    expect(await collect(decryptBackup(trickle, KEY))).toEqual(plain);
  });

  it("works at the real chunk size, with a multi-chunk stream", async () => {
    const plain = bytes(200_000);
    const file = await collect(encryptBackup(Readable.from([plain]), KEY));
    expect(await open(file)).toEqual(plain);
  });

  it("starts with the version header, a salt and a nonce prefix of its own, different on every file", async () => {
    const a = await seal(bytes(10));
    const b = await seal(bytes(10));
    expect(a.subarray(0, 4).toString("ascii")).toBe("ZKBK");
    expect(a[4]).toBe(1);
    expect(a.length).toBeGreaterThanOrEqual(HEADER_BYTES + 16);
    expect(a.subarray(9, 25).equals(b.subarray(9, 25))).toBe(false); // the salt
  });

  it("never shows the plain text, and the same text never gives the same file twice", async () => {
    const plain = Buffer.from("اسم الزبون: أحمد، رقم الهاتف 0790000000 ".repeat(20), "utf8");
    const a = await seal(plain);
    expect(a.includes(Buffer.from("0790000000"))).toBe(false);
    expect(a.equals(await seal(plain))).toBe(false);
  });
});

describe("the key", () => {
  it("is HKDF-SHA256 of ENCRYPTION_KEY with the file's own salt and a label of its own: never the raw key, never a secrets-at-rest key", () => {
    const salt = randomBytes(16);
    const k = deriveBackupKey(KEY, salt);
    expect(k.length).toBe(32);
    expect(k.equals(Buffer.from(KEY.slice(0, 32)))).toBe(false);
    expect(k.equals(Buffer.from(hkdfSync("sha256", KEY, salt, BACKUP_KEY_INFO, 32)))).toBe(true);
    // the key src/server/crypto.ts derives for secrets at rest (fixed salt, its own label)
    expect(k.equals(Buffer.from(hkdfSync("sha256", KEY, "zaki-workspace", "secrets-at-rest:v2", 32)))).toBe(false);
    expect(BACKUP_KEY_INFO).not.toBe("secrets-at-rest:v2");
    // another salt, another key
    expect(deriveBackupKey(KEY, randomBytes(16)).equals(k)).toBe(false);
  });

  it("a wrong key opens nothing", async () => {
    const file = await seal(bytes(300));
    expect(await codeOf(open(file, OTHER_KEY))).toBe("auth");
  });
});

describe("a damaged file is refused", () => {
  const plain = bytes(500);

  it("a flipped byte in the data, in a tag, in the salt or in the header", async () => {
    const file = await seal(plain);
    for (const at of [HEADER_BYTES + 3, HEADER_BYTES + SMALL + 5, file.length - 1, 12, 20, 6]) {
      const bad = Buffer.from(file);
      bad[at] = (bad[at] as number) ^ 0x01;
      expect(await codeOf(open(bad)), `byte ${at}`).not.toBe("no error");
    }
  });

  it("a file cut in the middle of a chunk, and one cut exactly between chunks (the last chunk must say «final»)", async () => {
    const file = await seal(plain);
    expect(await codeOf(open(file.subarray(0, file.length - 5)))).toBe("auth");
    const boundary = HEADER_BYTES + 3 * (SMALL + 16);
    expect(await codeOf(open(file.subarray(0, boundary)))).toBe("auth");
    // cut right after the header, and inside it
    expect(await codeOf(open(file.subarray(0, HEADER_BYTES)))).toBe("truncated");
    expect(await codeOf(open(file.subarray(0, 10)))).toBe("truncated");
    expect(await codeOf(open(Buffer.alloc(0)))).toBe("truncated");
  });

  it("chunks swapped, repeated or dropped", async () => {
    const file = await seal(plain);
    const rec = SMALL + 16;
    const chunk = (i: number) => file.subarray(HEADER_BYTES + i * rec, HEADER_BYTES + (i + 1) * rec);
    const head = file.subarray(0, HEADER_BYTES);
    expect(await codeOf(open(Buffer.concat([head, chunk(1), chunk(0), file.subarray(HEADER_BYTES + 2 * rec)])))).toBe("auth");
    expect(await codeOf(open(Buffer.concat([head, chunk(0), chunk(0), file.subarray(HEADER_BYTES + 1 * rec)])))).toBe("auth");
    expect(await codeOf(open(Buffer.concat([head, chunk(0), file.subarray(HEADER_BYTES + 2 * rec)])))).toBe("auth");
  });

  it("something appended after the last chunk", async () => {
    const file = await seal(plain);
    expect(await codeOf(open(Buffer.concat([file, bytes(10)])))).toBe("auth");
  });

  it("a file that is not a backup, or one of another version", async () => {
    expect(await codeOf(open(Buffer.from("this is just a text file, not a backup at all.")))).toBe("bad_magic");
    expect(await codeOf(open(Buffer.from("ab")))).toBe("truncated");
    const file = await seal(plain);
    const v2 = Buffer.from(file);
    v2[4] = 2;
    expect(await codeOf(open(v2))).toBe("bad_version");
  });
});

describe("scripts/decrypt-backup.mjs (the owner's own machine) reads what the app writes", () => {
  it("shares the label and opens the same file, and refuses the same damage", async () => {
    expect(SCRIPT_KEY_INFO).toBe(BACKUP_KEY_INFO);
    const plain = bytes(5000);
    const file = await seal(plain);
    expect(await collect(scriptDecrypt(Readable.from([file]), KEY))).toEqual(plain);
    expect(await codeOf(collect(scriptDecrypt(Readable.from([file]), OTHER_KEY)))).toBe("auth");
    const cut = file.subarray(0, HEADER_BYTES + 2 * (SMALL + 16));
    expect(await codeOf(collect(scriptDecrypt(Readable.from([cut]), KEY)))).toBe("auth");
    expect(await codeOf(collect(scriptDecrypt(Readable.from([Buffer.from("not a backup file, sorry...........")]), KEY)))).toBe("bad_magic");
  });

  describe("as a command", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zk-decrypt-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const script = path.resolve(__dirname, "../scripts/decrypt-backup.mjs");
    const run = (args: string[], key: string | null) => {
      try {
        const out = execFileSync(process.execPath, [script, ...args], { env: { ...process.env, ENCRYPTION_KEY: key ?? "" }, stdio: "pipe" });
        return { code: 0, out: out.toString() };
      } catch (err) {
        const e = err as { status?: number; stderr?: Buffer };
        return { code: e.status ?? -1, out: e.stderr?.toString() ?? "" };
      }
    };

    it("writes the gzip next to the file (or the SQL with --sql), never overwrites, and removes a failed output", async () => {
      const sql = "-- hello backup\nSELECT 1;\n";
      const file = path.join(dir, "ok.zbk");
      writeFileSync(file, await collect(encryptBackup(Readable.from([gzipSync(Buffer.from(sql))]), KEY)));

      const first = run([file], KEY);
      expect(first.code, first.out).toBe(0);
      expect(gunzipSync(readFileSync(`${file}.sql.gz`)).toString()).toBe(sql);
      // a second run refuses to overwrite
      expect(run([file], KEY).code).toBe(2);

      const asSql = run([file, "--sql", "--out", path.join(dir, "plain.sql")], KEY);
      expect(asSql.code, asSql.out).toBe(0);
      expect(readFileSync(path.join(dir, "plain.sql"), "utf8")).toBe(sql);

      // wrong key: exit 1, and no half-written output is left behind
      const wrong = run([file, "--out", path.join(dir, "wrong.gz")], OTHER_KEY);
      expect(wrong.code).toBe(1);
      expect(existsSync(path.join(dir, "wrong.gz"))).toBe(false);
      // the key is read from the environment only: missing, or too short, is refused before anything is read
      expect(run([file, "--out", path.join(dir, "nokey.gz")], null).code).toBe(2);
      expect(run([file, "--out", path.join(dir, "short.gz")], "short").code).toBe(2);
      expect(existsSync(path.join(dir, "nokey.gz"))).toBe(false);
    });
  });
});
