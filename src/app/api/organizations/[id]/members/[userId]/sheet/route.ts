import { NextResponse } from "next/server";
import { requireAccountsActor } from "@/server/services/accounts";
import { memberSheetFor } from "@/server/services/member-sheet";
import { withAccountsApi } from "../../_http";

/**
 * GET -> one person's sheet of «الحسابات والصلاحيات» for the phone (`memberSheetFor`): what the actor is offered on them, their permission areas
 * with each switch's lock and the lists a flip sends, the managers and the receivers of their open work. Whoever holds `users.manage`, like the list.
 */
export async function GET(_req: Request, { params }: { params: { id: string; userId: string } }) {
  return withAccountsApi(async () => {
    const actor = await requireAccountsActor(params.id);
    return NextResponse.json(await memberSheetFor(actor, params.userId));
  });
}
