import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { createSheet, createSheetSchema, listSheets } from "@/server/services/knowledge";

/** «المنتجات»: the list (GET, `?q=` and `?category=`) and a new sheet (POST, an editor's). */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? undefined;
    const category = url.searchParams.get("category") ?? undefined;
    return NextResponse.json(await listSheets(actor, { ...(q ? { q } : {}), ...(category ? { category } : {}) }), { headers: { "cache-control": "no-store" } });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(createSheetSchema, req);
    return NextResponse.json({ sheet: await createSheet(actor, input) }, { status: 201 });
  });
}
