import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { searchEntries } from "@/lib/guide/articles";
import { audienceOf } from "@/lib/guide/audience";

/**
 * «دليل زاكي» for the phone: the articles this person may read, in the guide's order, with what the search looks in — the same
 * `searchEntries` the site's index page hands its search box (src/app/(app)/guide/page.tsx), so an article above their level is not listed.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ articles: searchEntries(audienceOf(actor)) });
  });
}
