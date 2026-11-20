import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { assertNotGuest } from "@/server/services/guest-guard";
import { parseJson } from "@/server/validation";
import {
  addTicketComment,
  ticketCommentSchema,
  ticketDetail,
} from "@/server/services/tickets";
import { ticketTaskView } from "@/server/services/departments";

/** GET: full ticket detail (comments + activity log) — org-scoped, never for guests (403). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    const ticket = await ticketDetail(ctx, params.id);
    // W1.6: the task made from this ticket, as this reader may read it (named, or only «hidden»)
    return NextResponse.json({ ticket: { ...ticket, task: await ticketTaskView(ctx, ticket.id) } });
  });
}

/** POST: add a comment to the ticket (org member; guests get 403 from the service). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = await parseJson(ticketCommentSchema, req);
    const comment = await addTicketComment(ctx, params.id, input.body);
    return NextResponse.json({ comment }, { status: 201 });
  });
}