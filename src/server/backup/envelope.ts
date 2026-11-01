import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * THE ENVELOPE OF A BACKUP FILE (`.zbk`): AES-256-GCM over a stream, in authenticated chunks, so a multi-gigabyte dump
 * is never held in memory and a cut, reordered or altered file is refused.
 *
 *   header (29 bytes, plain, and the associated data of EVERY chunk):
 *     "ZKBK" (4) | version (1) | chunk size, big-endian (4) | salt (16) | nonce prefix (4)
 *   then, per chunk of up to `chunkSize` plain bytes:  ciphertext (same length) | GCM tag (16)
 *     nonce        = nonce prefix | chunk counter (8 bytes, big-endian)
 *     associated   = header | chunk counter (8) | final flag (1: 1 on the last chunk, else 0)
 *
 * The key is NEVER the raw ENCRYPTION_KEY: it is HKDF-SHA256(ENCRYPTION_KEY, salt = the file's own random salt, info =
 * a label of its own), so a backup's key differs from every secret-at-rest key (src/server/crypto.ts) and from every other
 * backup's. The key is not stored anywhere: not in the file, not on Drive. Lose ENCRYPTION_KEY and the backups are noise.
 *
 * ⚠️ scripts/decrypt-backup.mjs reads this format with plain Node and no app code (so a backup can be opened on any
 * machine with nothing but Node). 🔧 tests/backup-envelope.test.ts decrypts what this file writes with that script.
 */

export const BACKUP_MAGIC = "ZKBK";
export const BACKUP_VERSION = 1;
export const BACKUP_CHUNK_SIZE = 64 * 1024;
export const BACKUP_KEY_INFO = "zaki-workspace:db-backup:v1";
const SALT_BYTES = 16;
const PREFIX_BYTES = 4;
const TAG_BYTES = 16;
export const HEADER_BYTES = 4 + 1 + 4 + SALT_BYTES + PREFIX_BYTES;

export type BackupCryptoCode = "bad_magic" | "bad_version" | "truncated" | "auth";

/** A file that is not a backup, is cut short, or does not open with this key. Never carries data or the key. */
export class BackupCryptoError extends Error {
  constructor(public readonly code: BackupCryptoCode) {
    super(`backup.crypto.${code}`);
  }
}

export function deriveBackupKey(masterKey: string, salt: Uint8Array): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey, salt, BACKUP_KEY_INFO, 32));
}

function counterBytes(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

function nonceOf(prefix: Buffer, counter: number): Buffer {
  return Buffer.concat([prefix, counterBytes(counter)]);
}

function aadOf(header: Buffer, counter: number, final: boolean): Buffer {
  return Buffer.concat([header, counterBytes(counter), Buffer.from([final ? 1 : 0])]);
}

function sealChunk(key: Buffer, header: Buffer, prefix: Buffer, counter: number, plain: Buffer, final: boolean): Buffer {
  const cipher = createCipheriv("aes-256-gcm", key, nonceOf(prefix, counter), { authTagLength: TAG_BYTES });
  cipher.setAAD(aadOf(header, counter, final));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]);
}

function openChunk(key: Buffer, header: Buffer, prefix: Buffer, counter: number, record: Buffer, final: boolean): Buffer {
  if (record.length < TAG_BYTES) throw new BackupCryptoError("truncated");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonceOf(prefix, counter), { authTagLength: TAG_BYTES });
    decipher.setAAD(aadOf(header, counter, final));
    decipher.setAuthTag(record.subarray(record.length - TAG_BYTES));
    return Buffer.concat([decipher.update(record.subarray(0, record.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new BackupCryptoError("auth");
  }
}

/** Encrypts a stream of bytes; yields the header, then one record per chunk. `chunkSize` is for tests only. */
export async function* encryptBackup(
  source: AsyncIterable<Uint8Array>,
  masterKey: string,
  chunkSize: number = BACKUP_CHUNK_SIZE,
): AsyncGenerator<Buffer> {
  const salt = randomBytes(SALT_BYTES);
  const prefix = randomBytes(PREFIX_BYTES);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(chunkSize);
  const header = Buffer.concat([Buffer.from(BACKUP_MAGIC, "ascii"), Buffer.from([BACKUP_VERSION]), size, salt, prefix]);
  const key = deriveBackupKey(masterKey, salt);
  yield header;
  let buf: Buffer = Buffer.alloc(0);
  let counter = 0;
  for await (const part of source) {
    buf = buf.length === 0 ? Buffer.from(part) : Buffer.concat([buf, part]);
    // strictly more than one chunk waiting: the first is surely not the last
    while (buf.length > chunkSize) {
      yield sealChunk(key, header, prefix, counter++, buf.subarray(0, chunkSize), false);
      buf = buf.subarray(chunkSize);
    }
  }
  yield sealChunk(key, header, prefix, counter, buf, true);
}

/** Decrypts what `encryptBackup` wrote; throws `BackupCryptoError` for anything that is not exactly that. */
export async function* decryptBackup(source: AsyncIterable<Uint8Array>, masterKey: string): AsyncGenerator<Buffer> {
  let buf: Buffer = Buffer.alloc(0);
  let header: Buffer | null = null;
  let key: Buffer | null = null;
  let prefix: Buffer = Buffer.alloc(0);
  let recordBytes = 0;
  let counter = 0;
  for await (const part of source) {
    buf = buf.length === 0 ? Buffer.from(part) : Buffer.concat([buf, part]);
    if (!header) {
      if (buf.length < HEADER_BYTES) continue;
      header = Buffer.from(buf.subarray(0, HEADER_BYTES));
      if (header.subarray(0, 4).toString("ascii") !== BACKUP_MAGIC) throw new BackupCryptoError("bad_magic");
      if (header[4] !== BACKUP_VERSION) throw new BackupCryptoError("bad_version");
      const chunkSize = header.readUInt32BE(5);
      if (chunkSize < 1 || chunkSize > 16 * 1024 * 1024) throw new BackupCryptoError("bad_version");
      recordBytes = chunkSize + TAG_BYTES;
      key = deriveBackupKey(masterKey, header.subarray(9, 9 + SALT_BYTES));
      prefix = header.subarray(9 + SALT_BYTES, HEADER_BYTES);
      buf = buf.subarray(HEADER_BYTES);
    }
    while (buf.length > recordBytes) {
      yield openChunk(key as Buffer, header, prefix, counter++, buf.subarray(0, recordBytes), false);
      buf = buf.subarray(recordBytes);
    }
  }
  if (!header || !key) throw new BackupCryptoError(buf.length >= 4 && buf.subarray(0, 4).toString("ascii") !== BACKUP_MAGIC ? "bad_magic" : "truncated");
  // what is left is the last record: it must open as «final» (a file cut at a chunk boundary does not)
  yield openChunk(key, header, prefix, counter, buf, true);
}
