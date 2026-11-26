import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { spaceSettingsFor } from "@/server/services/space-settings";

/** One space's settings for the phone: the same answer the page draws (`spaceSettingsFor`). Not the person's: 404. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json(await spaceSettingsFor(await requireActor(), params.id), { headers: { "cache-control": "no-store" } }));
}
