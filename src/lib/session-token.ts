import { SignJWT, jwtVerify } from "jose";

/**
 * Session tokens, in a module with NO Next/Node-only imports so the Edge middleware and the
 * server code verify tokens with exactly the same code.
 *
 *  - `tv` (token version): the user's `tokenVersion` when the token was issued. Suspending,
 *    offboarding, resetting a password or "log out everywhere" bumps the stored value, which
 *    invalidates every older token. A token without a numeric `tv` (all tokens issued before
 *    this existed) is refused, so everybody signs in once after the release that introduced it.
 *  - `sid` (C4.2): the id of the person's `UserSession` row, so ONE device can be ended. A token without it was issued before the table existed:
 *    it stays valid until it expires (no mass sign-out on the deploy) and cannot be ended alone; server code migrates it to a row (src/server/auth.ts).
 *    The id is not a secret by itself: the cookie is signed, and the database decides whether the row is still honoured.
 *  - `mcp` / `tp`: the person must still change a temporary password / accept the transparency
 *    notice. The Edge middleware uses them to send the browser to /onboarding without a database
 *    call; the server re-checks the real state on every API request.
 *
 * The key is SHA-256(AUTH_SECRET), the same derivation the app has always used.
 */
export interface SessionClaims {
  userId: string;
  tv: number;
  sid?: string;
  mcp?: boolean;
  tp?: boolean;
}

/** A session id is a short token of letters, digits, "-" and "_" (a cuid). A token whose `sid` is any other shape is refused: it must never be read as an old token (which no revocation can reach). */
const SID_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

async function deriveKey(secret: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return new Uint8Array(digest);
}

export async function signSessionToken(claims: SessionClaims, secret: string, ttlSeconds: number): Promise<string> {
  const payload: Record<string, unknown> = { userId: claims.userId, tv: claims.tv };
  if (claims.sid) payload["sid"] = claims.sid;
  if (claims.mcp) payload["mcp"] = true;
  if (claims.tp) payload["tp"] = true;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(await deriveKey(secret));
}

export async function verifySessionTokenWith(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, await deriveKey(secret));
    if (typeof payload["userId"] !== "string") return null;
    const tv = payload["tv"];
    if (typeof tv !== "number" || !Number.isInteger(tv) || tv < 0) return null;
    const sid = payload["sid"];
    if (sid !== undefined && !(typeof sid === "string" && SID_SHAPE.test(sid))) return null;
    return {
      userId: payload["userId"],
      tv,
      ...(typeof sid === "string" ? { sid } : {}),
      ...(payload["mcp"] === true ? { mcp: true } : {}),
      ...(payload["tp"] === true ? { tp: true } : {}),
    };
  } catch {
    return null;
  }
}
