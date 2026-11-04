import { NextResponse } from "next/server";
import { apiError } from "@/server/api";
import type { Actor } from "@/server/policy/actor";
import { ImageOcrError, readImageText } from "@/server/services/image-ocr";

const UPSTREAM = new Set(["imageOcr.err_down", "imageOcr.err_timeout", "imageOcr.err_failed", "imageOcr.err_busy"]);

/**
 * The answer of «اقرا النص» for both doors (a library file, a chat attachment): the body may say `{ "again": true }` («اقرا من جديد»).
 * A failure is a dictionary key in `message`: 502 for the service, 409 for «not set up» / «too big» / «not a supported picture» / «no text».
 * Everything about access is decided in the service (`assertMayReadPicture`), never here.
 */
export async function answerReadText(req: Request, actor: Actor, fileId: string): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { again?: unknown } | null;
  try {
    const result = await readImageText(actor, fileId, { again: body?.again === true });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ImageOcrError) return UPSTREAM.has(err.key) ? NextResponse.json({ error: "upstream", message: err.key }, { status: 502 }) : apiError(err.code, err.key);
    throw err;
  }
}
