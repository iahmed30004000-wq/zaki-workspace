import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { noStore } from "@/server/ai/api";
import type { RefTable } from "@/server/ai/redact";
import { activeOrgCtx } from "@/server/services/integrations";
import { expireStale, proposalViews, type ProposalView } from "@/server/services/owner-assistant-proposals";

/**
 * GET ?ids=a,b — the proposals the assistant made in MY conversation with it, as cards (the same shape as «مساعد المالك»: the exact parameters
 * in plain Arabic, the reason, the status). Only my own proposals are ever returned (the owner assistant's own rule: a proposal belongs to
 * the conversation of the person who got it); «وافق» / «ارفض» are the owner assistant's routes, which decide again on the server.
 */
const MAX_IDS = 5;

export async function GET(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{5,60}$/.test(s)).slice(0, MAX_IDS);
    if (ids.length === 0) return NextResponse.json({ proposals: [] }, noStore);
    await expireStale(new Date(), ctx.orgId);
    const rows = await db.aiProposal.findMany({
      where: { id: { in: ids }, orgId: ctx.orgId, conversation: { userId: ctx.userId, orgId: ctx.orgId } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, type: true, paramsJson: true, reasonText: true, status: true, createdAt: true, decidedAt: true, resultJson: true, conversation: { select: { id: true, refs: true } } },
    });
    const byConversation = new Map<string, { table: RefTable; rows: typeof rows }>();
    for (const row of rows) {
      const refs = row.conversation.refs;
      const table = refs && typeof refs === "object" && !Array.isArray(refs) ? (refs as RefTable) : {};
      const group = byConversation.get(row.conversation.id) ?? { table, rows: [] };
      group.rows.push(row);
      byConversation.set(row.conversation.id, group);
    }
    const views: ProposalView[] = [];
    for (const group of byConversation.values()) views.push(...(await proposalViews(ctx.orgId, group.rows, group.table)));
    const order = new Map(ids.map((id, i) => [id, i]));
    views.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return NextResponse.json({ proposals: views }, noStore);
  });
}
