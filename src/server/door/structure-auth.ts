import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { originAllowed } from "@/lib/origin-guard";
import { runAsUser } from "@/server/acting-as";
import { authenticateDoor } from "@/server/services/api-door";
import { DoorError } from "@/server/door/http";

/**
 * The front gate of the routes that arrange the chat (`/api/groups`, `/api/topics/:id`): a person's browser OR a system token of the door («ميوز», scope `chat.structure`).
 *
 *  - `Authorization: Bearer …` present: the token goes through the door's own gate (shape, hash, revoked / expired / person no longer allowed, the switch «باب الربط»,
 *    its rate limits), must hold `chat.structure`, and the route then runs AS the token's person: every rule of the route applies to the token exactly as to the person.
 *  - No Authorization header: a browser. These paths are machine paths for the middleware (a token has no cookie), so the cross-site write check the middleware does
 *    for the other API paths is done HERE, the same function, before anything runs; the route's own `requireUser` then asks for the cookie.
 * A request never mixes the two: a bad token is refused, it does not fall back to the cookie.
 */
export interface StructureCall {
  /** true when the caller is a token: the route may narrow what it accepts */
  viaToken: boolean;
}

const refuse = (status: number, error: string, message: string, headers: Record<string, string> = {}) => NextResponse.json({ error, message }, { status, headers });

export async function structureRoute(req: Request, run: (call: StructureCall) => Promise<Response>): Promise<Response> {
  const header = req.headers.get("authorization");
  if (header === null) {
    const allowed = originAllowed({
      method: req.method,
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
      forwardedHost: req.headers.get("x-forwarded-host"),
      secFetchSite: req.headers.get("sec-fetch-site"),
      appUrl: process.env["APP_URL"],
    });
    if (!allowed) return refuse(403, "forbidden", "origin.mismatch");
    return run({ viaToken: false });
  }
  const requestId = randomUUID();
  let who;
  try {
    who = await authenticateDoor(req, requestId, "chat.structure");
  } catch (err) {
    if (err instanceof DoorError) return refuse(err.status, err.code, err.message, err.headers);
    throw err;
  }
  return runAsUser(who.issuerId, () => run({ viaToken: true }));
}
