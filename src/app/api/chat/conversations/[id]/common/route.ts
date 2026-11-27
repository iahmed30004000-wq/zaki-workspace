import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { commonGroups } from "@/server/chat/common-groups";

/** GET: the groups and topics the two people of this private chat both belong to (src/server/chat/common-groups.ts). Only for a private chat of one's own; else 404. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await commonGroups(ctx, params.id));
  });
}
