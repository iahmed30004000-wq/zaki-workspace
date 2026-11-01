#!/usr/bin/env node
/**
 * يفك تشفير نسخة احتياطية من «Zaki Workspace» (ملف .zbk اللي بينزل من Google Drive).
 * Decrypts a Zaki Workspace database backup (the `.zbk` file downloaded from Google Drive).
 *
 *   ENCRYPTION_KEY=<the server's key> node scripts/decrypt-backup.mjs backup.zbk
 *       writes backup.zbk.sql.gz  (gzip of the SQL script)
 *   ENCRYPTION_KEY=<the server's key> node scripts/decrypt-backup.mjs backup.zbk --sql
 *       writes backup.zbk.sql     (already unzipped)
 *   add  --out <path>  to choose the output file.
 *
 * Plain Node (18 or newer), no packages, no app code: it runs on any machine. The key comes ONLY from the environment (never from an
 * argument: arguments stay in the shell history). It never writes the key anywhere and refuses to overwrite a file.
 *
 * The format is the one in src/server/backup/envelope.ts (the app's own writer). tests/backup-envelope.test.ts opens what the app
 * writes with THIS file, so the two cannot drift apart.
 *
 * It only decrypts: it restores nothing. Restoring is a manual act into a NEW, empty database, never over the live one.
 */
import { createDecipheriv, hkdfSync } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { pathToFileURL } from "node:url";

export const MAGIC = "ZKBK";
export const VERSION = 1;
export const KEY_INFO = "zaki-workspace:db-backup:v1";
const SALT_BYTES = 16;
const TAG_BYTES = 16;
export const HEADER_BYTES = 4 + 1 + 4 + SALT_BYTES + 4;

/** `code` is one of: bad_magic, bad_version, truncated, auth (a wrong key and a damaged file look the same). */
export class BackupCryptoError extends Error {
  constructor(code) {
    super(`backup.crypto.${code}`);
    this.code = code;
  }
}

const counterBytes = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};

function openChunk(key, header, prefix, counter, record, final) {
  if (record.length < TAG_BYTES) throw new BackupCryptoError("truncated");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.concat([prefix, counterBytes(counter)]), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.concat([header, counterBytes(counter), Buffer.from([final ? 1 : 0])]));
    decipher.setAuthTag(record.subarray(record.length - TAG_BYTES));
    return Buffer.concat([decipher.update(record.subarray(0, record.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new BackupCryptoError("auth");
  }
}

/** Decrypts a stream of bytes (what the app wrote) into the gzip bytes. Throws BackupCryptoError for anything else. */
export async function* decryptBackup(source, masterKey) {
  let buf = Buffer.alloc(0);
  let header = null;
  let key = null;
  let prefix = null;
  let recordBytes = 0;
  let counter = 0;
  for await (const part of source) {
    buf = buf.length === 0 ? Buffer.from(part) : Buffer.concat([buf, part]);
    if (!header) {
      if (buf.length < HEADER_BYTES) continue;
      header = Buffer.from(buf.subarray(0, HEADER_BYTES));
      if (header.subarray(0, 4).toString("ascii") !== MAGIC) throw new BackupCryptoError("bad_magic");
      if (header[4] !== VERSION) throw new BackupCryptoError("bad_version");
      const chunkSize = header.readUInt32BE(5);
      if (chunkSize < 1 || chunkSize > 16 * 1024 * 1024) throw new BackupCryptoError("bad_version");
      recordBytes = chunkSize + TAG_BYTES;
      key = Buffer.from(hkdfSync("sha256", masterKey, header.subarray(9, 9 + SALT_BYTES), KEY_INFO, 32));
      prefix = header.subarray(9 + SALT_BYTES, HEADER_BYTES);
      buf = buf.subarray(HEADER_BYTES);
    }
    while (buf.length > recordBytes) {
      yield openChunk(key, header, prefix, counter++, buf.subarray(0, recordBytes), false);
      buf = buf.subarray(recordBytes);
    }
  }
  if (!header) throw new BackupCryptoError(buf.length >= 4 && buf.subarray(0, 4).toString("ascii") !== MAGIC ? "bad_magic" : "truncated");
  // what is left must be the last record, sealed as «final»: a file cut at a chunk boundary does not open
  yield openChunk(key, header, prefix, counter, buf, true);
}

const MESSAGES = {
  bad_magic: "هاد الملف مش نسخة احتياطية من Zaki Workspace.",
  bad_version: "نسخة الملف مش مدعومة بهالسكربت.",
  truncated: "الملف ناقص (انقطع قبل ما يخلص). نزّله من جديد.",
  auth: "ما انفتح: المفتاح غلط أو الملف تالف.",
};

async function main(argv, env) {
  const args = argv.slice(2);
  const sql = args.includes("--sql");
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 ? args[outAt + 1] : null;
  const input = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
  if (!input) {
    console.error("الاستعمال:  ENCRYPTION_KEY=... node scripts/decrypt-backup.mjs <الملف> [--sql] [--out <المسار>]");
    return 2;
  }
  const masterKey = env.ENCRYPTION_KEY;
  if (!masterKey || masterKey.length < 32) {
    console.error("حط مفتاح التشفير بمتغير اسمه ENCRYPTION_KEY (نفس القيمة اللي على السيرفر، 32 حرف على الأقل).");
    return 2;
  }
  if (!existsSync(input)) {
    console.error(`الملف مش موجود: ${input}`);
    return 2;
  }
  const target = out ?? `${input}${sql ? ".sql" : ".sql.gz"}`;
  if (existsSync(target)) {
    console.error(`الملف ${target} موجود أصلًا، ما رح نكتب فوقه. احذفه أو اختار اسم تاني بـ --out.`);
    return 2;
  }
  try {
    const plain = Readable.from(decryptBackup(createReadStream(input), masterKey));
    await pipeline(plain, ...(sql ? [createGunzip()] : []), createWriteStream(target, { flags: "wx", mode: 0o600 }));
  } catch (err) {
    rmSync(target, { force: true });
    console.error(err instanceof BackupCryptoError ? MESSAGES[err.code] : "صار خطأ وقت فك التشفير أو الضغط. الملف تالف أو ناقص.");
    return 1;
  }
  console.log(`تم. انكتب الملف: ${target}`);
  console.log(sql ? "هاد سكربت SQL جاهز للتحميل بقاعدة جديدة وفاضية." : "فك الضغط عنه بـ gunzip، وبعدها حمّله بقاعدة جديدة وفاضية (مش فوق قاعدة الموقع).");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv, process.env);
}
