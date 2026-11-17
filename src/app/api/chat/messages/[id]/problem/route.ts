import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { problemSchema, reportProblem } from "@/server/services/problem-tickets";

/** POST: «🎫 مشكلة» — a ticket made where the message is (Q1.5). 201 a new ticket, 200 the message was added to the open ticket of the same order or customer. */
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(problemSchema, req);
    const ctx = await activeOrgCtx();
    const res = await reportProblem(ctx, params.id, input);
    return NextResponse.json(res, { status: res.merged ? 200 : 201 });
  });
}
