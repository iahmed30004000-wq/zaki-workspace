import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * «الباب»: the token another Zaki system sends in `Authorization: Bearer <token>`.
 *
 *   zws_<prefix>.<secret>
 *     prefix  12 hex characters, public: it only FINDS the row (a unique index), it proves nothing
 *     secret  43 base64url characters = 256 random bits
 *
 * The token is shown once, when it is made. Only `prefix` and SHA-256(whole token) are stored; a token has 256 bits of
 * entropy, so a fast hash is the right one (nothing to brute-force), and it is compared in CONSTANT time.
 * Pure (no database): tests/api-door-tokens.test.ts.
 */

export const TOKEN_LABEL = "zws";

/** The permissions a token can hold. A token with none can read nothing and write nothing. */
export const DOOR_PERMISSIONS = ["ideas.read", "ideas.write", "tasks.read", "tasks.write"] as const;
export type DoorPermission = (typeof DOOR_PERMISSIONS)[number];

export function isDoorPermission(value: unknown): value is DoorPermission {
  return typeof value === "string" && (DOOR_PERMISSIONS as readonly string[]).includes(value);
}

/** What a token holding `permissions` may do: a write permission also lets it read what it sent in (never anything else). */
export function permits(permissions: readonly string[], needed: DoorPermission): boolean {
  if (permissions.includes(needed)) return true;
  if (needed === "ideas.read") return permissions.includes("ideas.write");
  if (needed === "tasks.read") return permissions.includes("tasks.write");
  return false;
}

const TOKEN_SHAPE = /^zws_([0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export interface NewToken {
  /** The whole token: shown once, never stored. */
  token: string;
  prefix: string;
  hash: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateToken(): NewToken {
  const prefix = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `${TOKEN_LABEL}_${prefix}.${secret}`;
  return { token, prefix, hash: hashToken(token) };
}

/** The prefix of a well-formed token, or null (anything else is refused before a database is asked). */
export function parseToken(token: string): { prefix: string } | null {
  const m = TOKEN_SHAPE.exec(token);
  return m ? { prefix: m[1] as string } : null;
}

/** `Authorization: Bearer <token>` -> the token text; anything else (no header, another scheme, extra words) -> null. */
export function bearerOf(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer ([^\s]+)$/i.exec(header.trim());
  return m ? (m[1] as string) : null;
}

/** A hash no token has: compared against when the prefix is unknown, so "no such token" costs the same as "wrong secret". */
const DECOY_HASH = hashToken("zws-decoy-never-issued");

/** Constant-time comparison of the presented token against the stored hash (hex). */
export function tokenMatches(token: string, storedHash: string | null): boolean {
  const presented = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(storedHash ?? DECOY_HASH, "hex");
  // both are 32 bytes for any real row; a malformed stored value simply never matches
  if (presented.length !== stored.length) return false;
  const equal = timingSafeEqual(presented, stored);
  return storedHash !== null && equal;
}
