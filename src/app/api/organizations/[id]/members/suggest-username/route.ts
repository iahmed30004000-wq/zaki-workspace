import { NextResponse } from "next/server";
import { requireAccountsActor } from "@/server/services/accounts";
import { suggestFreeUsername } from "@/server/services/usernames";
import { withAccountsApi } from "../_http";

/** GET ?name=: a free sign-in name made from a person's name, for whoever may add people here (it says which names are taken, so nobody else asks it). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withAccountsApi(async () => {
    await requireAccountsActor(params.id);
    const name = (new URL(req.url).searchParams.get("name") ?? "").slice(0, 80);
    return NextResponse.json({ username: await suggestFreeUsername(name) });
  });
}
