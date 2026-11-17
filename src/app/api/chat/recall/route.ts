import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { recallQuerySchema, recallSearch } from "@/server/chat/recall";
import { parse } from "@/server/validation";

/** GET `?q=&kind=product|reply`: what the «/» menu of the composer offers (approved products with the live price, or approved answers). */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const url = new URL(req.url);
    const input = parse(recallQuerySchema, { q: url.searchParams.get("q") ?? "", kind: url.searchParams.get("kind") ?? "product" });
    return NextResponse.json(await recallSearch(actor, input), { headers: { "cache-control": "no-store" } });
  });
}
