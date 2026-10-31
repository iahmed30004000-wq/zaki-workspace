import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { readLog } from "@/server/services/task-rules";

/**
 * The log of what the project's rules did, newest first: who it ran as, which rule, which task, when, and what each action did.
 * `?limit=` (1-200, default 50) and `?before=<ISO time>` for the next page. The space's ADMIN or the owner only; a read writes nothing.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const q = new URL(req.url).searchParams;
    const limit = Number(q.get("limit") ?? "");
    const beforeRaw = q.get("before");
    const before = beforeRaw ? new Date(beforeRaw) : null;
    return NextResponse.json({
      runs: await readLog(params.id, {
        ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
        before: before && !Number.isNaN(before.getTime()) ? before : null,
      }),
    });
  });
}
