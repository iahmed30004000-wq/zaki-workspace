import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { spacesScreenFor } from "@/server/services/space-manage";

/** «كل المساحات» for the phone: the same answer the page draws (`spacesScreenFor`). The owner and the admins; anybody else 404. */
export async function GET() {
  return withApi(async () => NextResponse.json(await spacesScreenFor(await requireActor()), { headers: { "cache-control": "no-store" } }));
}
