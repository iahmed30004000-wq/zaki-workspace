import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/server/auth";
import { BodyTooLargeError, readTextLimited } from "@/server/http/body-limit";
import { log } from "@/server/log";
import { DOOR_MAX_BODY_BYTES } from "./payload";

/**
 * «الباب»: the answers of /api/v1. One envelope (docs/contracts/workspace-door.v1.md):
 *
 *   success   { "data": { ... } }                      (a list: { "data": [...], "nextCursor": "..." | null })
 *   failure   { "error": { "code": "door.…", "message": "…", "details": … } }
 *
 * `code` is stable and machine-readable; `message` is a short English sentence for the sender's developers. Every answer carries
 * `X-Request-Id` (also written to the log) so a sender and the owner can talk about the same request.
 */

export class DoorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "DoorError";
  }
}

export function doorJson(body: unknown, init: { status?: number; requestId: string; headers?: Record<string, string> }): NextResponse {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: { "x-request-id": init.requestId, "cache-control": "no-store", ...init.headers },
  });
}

export function doorErrorResponse(err: DoorError, requestId: string): NextResponse {
  return doorJson(
    { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } },
    { status: err.status, requestId, headers: err.headers },
  );
}

/** What may be written to the log about an unexpected error: its class and its machine code, never its message. */
export function safeErrorFacts(err: unknown): { name: string; code?: string } {
  if (typeof err !== "object" || err === null) return { name: typeof err };
  const code = (err as { code?: unknown }).code;
  return {
    name: err instanceof Error ? err.name : "NonError",
    ...(typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(code) ? { code } : {}),
  };
}

/** The one place a route handler of the door runs: whatever happens inside, the sender gets the envelope, never a stack trace. */
export async function doorRoute(fn: (requestId: string) => Promise<NextResponse>): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    return await fn(requestId);
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { digest?: unknown }).digest === "DYNAMIC_SERVER_USAGE") throw err;
    if (err instanceof DoorError) return doorErrorResponse(err, requestId);
    // a rule of the app speaking (the person the token acts for may not do this here)
    if (err instanceof ForbiddenError) return doorErrorResponse(new DoorError(403, "door.forbidden", err.message), requestId);
    if (err instanceof NotFoundError) return doorErrorResponse(new DoorError(404, "door.not_found", "Not found."), requestId);
    if (err instanceof UnauthorizedError) return doorErrorResponse(new DoorError(401, "door.unauthorized", "Invalid token."), requestId);
    if (err instanceof ValidationError) {
      return doorErrorResponse(new DoorError(422, "door.validation_failed", "The request body is not valid.", err.issues), requestId);
    }
    // never err.message nor the stack: they may quote the sender's free text (a database error repeats the value it refused)
    log.error("door.unhandled", { requestId, ...safeErrorFacts(err) });
    return doorErrorResponse(new DoorError(500, "door.internal", "Something went wrong on our side."), requestId);
  }
}

/** A JSON object body, read with a ceiling: 415 for another content type, 413 when too large, 400 when it is not JSON. */
export async function readDoorJson(req: Request): Promise<unknown> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") {
    throw new DoorError(415, "door.unsupported_media_type", "Send the body as application/json.");
  }
  let raw: string;
  try {
    raw = await readTextLimited(req, DOOR_MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      throw new DoorError(413, "door.body_too_large", `The body is larger than ${DOOR_MAX_BODY_BYTES} bytes.`);
    }
    throw new DoorError(400, "door.bad_json", "The body could not be read.");
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new DoorError(400, "door.bad_json", "The body must be a JSON object.");
    }
    return parsed;
  } catch (err) {
    if (err instanceof DoorError) throw err;
    throw new DoorError(400, "door.bad_json", "The body is not valid JSON.");
  }
}
