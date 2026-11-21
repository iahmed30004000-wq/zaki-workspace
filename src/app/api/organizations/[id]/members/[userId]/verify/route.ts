import { NextResponse } from "next/server";
import { z } from "zod";
import { ForbiddenError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { memberVerifiedState, setMemberVerified } from "@/server/services/org-members";
import { withAccountsApi } from "../../_http";

const bodySchema = z.object({ verified: z.boolean() });

type Params = { params: { id: string; userId: string } };

/** GET -> `{ verified }`: the person's state, for the OWNER's card (anybody else: 403; the switch off: 404). The time and the granter never travel. */
export async function GET(_req: Request, { params }: Params) {
  return withAccountsApi(async () => {
    const actor = await requireActor();
    if (actor.orgId !== params.id) throw new ForbiddenError("not_org_member");
    return NextResponse.json(await memberVerifiedState(actor, params.userId));
  });
}

/**
 * POST `{ verified }` -> `{ ok: true, verified }`: «إشارة التوثيق» (S5.5). The company's OWNER gives a person the check badge (`true`) or takes it back (`false`);
 * nobody else may, whatever capability they hold (the rank is checked in `setMemberVerified`). Switch `verifiedBadge` off: «not found». Every change is an audit line.
 */
export async function POST(req: Request, { params }: Params) {
  return withAccountsApi(async () => {
    const actor = await requireActor();
    if (actor.orgId !== params.id) throw new ForbiddenError("not_org_member");
    const { verified } = await parseJson(bodySchema, req);
    const res = await setMemberVerified(actor, params.userId, verified);
    return NextResponse.json({ ok: true, verified: res.verified });
  });
}
