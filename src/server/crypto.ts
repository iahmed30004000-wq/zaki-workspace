import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Secrets-at-rest: AES-256-GCM over a JSON payload.
 *
 * Two key sources, told apart by the stored string itself:
 *   v2   `v2:<iv>.<data>.<tag>`  key derived (HKDF) from ENCRYPTION_KEY. Written whenever
 *        ENCRYPTION_KEY is set. It is independent of AUTH_SECRET, so rotating the session
 *        secret no longer bricks stored integration secrets.
 *   v1   `<iv>.<data>.<tag>`     (no prefix) key derived from AUTH_SECRET. Still READ so rows
 *        written before ENCRYPTION_KEY existed keep working with nothing to migrate at
 *        deploy time; `scripts/reencrypt-secrets.ts` upgrades them to v2.
 *
 * A v2 blob can only be opened with ENCRYPTION_KEY. Plaintext secrets never appear in
 * logs - callers only persist `secretEnc`.
 */

const V2_PREFIX = "v2:";
const MIN_ENCRYPTION_KEY_LENGTH = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** v1 key: derived from AUTH_SECRET. Kept only to read rows written before v2 existed. */
function legacyKey(): Buffer {
  return createHash("sha256").update(`${process.env["AUTH_SECRET"] ?? ""}:zaki:secrets:v1`).digest();
}

/**
 * v2 key from ENCRYPTION_KEY; null when it is not configured (unset or empty).
 * Throws when it is configured but too short - the boot-time env check refuses that
 * too, this keeps the library honest if it is ever called without it.
 */
function encryptionKey(): Buffer | null {
  const raw = process.env["ENCRYPTION_KEY"];
  if (!raw || raw.trim() === "") return null;
  if (raw.length < MIN_ENCRYPTION_KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be at least ${MIN_ENCRYPTION_KEY_LENGTH} characters`);
  }
  return Buffer.from(hkdfSync("sha256", raw, "zaki-workspace", "secrets-at-rest:v2", 32));
}

/** True when `blob` was written with ENCRYPTION_KEY (v2). */
export function isV2Ciphertext(blob: string | null | undefined): boolean {
  return typeof blob === "string" && blob.startsWith(V2_PREFIX);
}

/** True when new secrets are written as v2, i.e. ENCRYPTION_KEY is set. */
export function encryptionKeyConfigured(): boolean {
  const raw = process.env["ENCRYPTION_KEY"];
  return Boolean(raw && raw.trim() !== "");
}

export function encryptSecrets(plain: unknown): string {
  const v2 = encryptionKey();
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", v2 ?? legacyKey(), iv, { authTagLength: GCM_TAG_BYTES });
  const data = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(plain), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const body = `${iv.toString("base64url")}.${data.toString("base64url")}.${tag.toString("base64url")}`;
  return v2 ? `${V2_PREFIX}${body}` : body;
}

/** Returns null when the blob is malformed/tampered/unreadable with the current keys - callers decide fallback. */
export function decryptSecrets<T>(blob: string | null | undefined): T | null {
  if (!blob) return null;
  const v2 = blob.startsWith(V2_PREFIX);
  const parts = (v2 ? blob.slice(V2_PREFIX.length) : blob).split(".");
  if (parts.length !== 3) return null;
  try {
    const key = v2 ? encryptionKey() : legacyKey();
    if (!key) return null; // a v2 blob but no ENCRYPTION_KEY here
    const iv = Buffer.from(parts[0]!, "base64url");
    const data = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    // Pin the sizes: GCM would otherwise accept a truncated tag, which weakens forgery resistance.
    if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_TAG_BYTES });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * A keyed hash for MATCHING a value without keeping it (Q1.5: a customer's number): HMAC-SHA256 under a key derived from the company's encryption key
 * for this `purpose` only. The same value gives the same hash; nobody can go back from the hash, and a hash of one purpose is useless for another.
 */
export function keyedHash(purpose: string, value: string): string {
  const raw = process.env["ENCRYPTION_KEY"] && process.env["ENCRYPTION_KEY"]!.trim() !== "" ? process.env["ENCRYPTION_KEY"]! : (process.env["AUTH_SECRET"] ?? "");
  const key = Buffer.from(hkdfSync("sha256", raw, "zaki-workspace", `keyed-hash:${purpose}`, 32));
  return createHmac("sha256", key).update(value).digest("hex");
}

/**
 * A fresh shared secret for webhook signing: 256 bits from the OS CSPRNG, as 64 hex
 * characters (safe in a header, a URL and a double-click selection).
 */
export function generateSharedSecret(): string {
  return randomBytes(32).toString("hex");
}

/** HMAC-SHA256 hex signature over a string (also the state signature of the Google OAuth flow). */
export function hmacHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Constant-time string comparison for secrets and tokens. Both sides are hashed first,
 * so the comparison time depends on neither the content nor the lengths.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
