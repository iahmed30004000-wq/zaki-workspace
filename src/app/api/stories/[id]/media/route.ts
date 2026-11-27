import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseByteRange } from "@/server/files/range";
import { openStoryMedia } from "@/server/services/stories";

/**
 * GET — the bytes of one story: the ONLY address its file has. Judged on every request (`openStoryMedia`): somebody who may not see
 * the story, and everybody but the author once its 24 hours are over, gets 404. Ranges are answered (a video is asked for in pieces).
 * Nothing is kept by the browser: the right to see it ends, so no copy outlives the answer.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const file = await openStoryMedia(await requireActor(), params.id);
    const base: Record<string, string> = {
      "content-type": file.mimeType,
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "accept-ranges": "bytes",
    };
    const range = parseByteRange(req.headers.get("range"), file.size);
    if (range.kind === "unsatisfiable") return new NextResponse(null, { status: 416, headers: { ...base, "content-range": `bytes */${file.size}` } });
    if (range.kind === "partial") {
      return new NextResponse(await file.stream(range), {
        status: 206,
        headers: { ...base, "content-length": String(range.end - range.start + 1), "content-range": `bytes ${range.start}-${range.end}/${file.size}` },
      });
    }
    return new NextResponse(await file.stream(null), { status: 200, headers: { ...base, "content-length": String(file.size) } });
  });
}

export const dynamic = "force-dynamic";
