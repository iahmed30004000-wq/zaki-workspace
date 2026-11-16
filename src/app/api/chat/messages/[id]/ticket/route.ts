import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { messageToTicket } from "@/server/chat/make-work";

const schema = z.object({
  departmentId: z.string().min(1),
  title: z.string().trim().max(200).optional(),
  priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]).optional(),
  confirmPublic: z.boolean().optional(),
});

/** POST: «اعمل منها تذكرة» — a ticket to a department, from a message the caller reads (never a guest). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(schema, req);
    const ctx = await activeOrgCtx();
    const res = await messageToTicket(ctx, params.id, input);
    return NextResponse.json(res, { status: 201 });
  });
}
