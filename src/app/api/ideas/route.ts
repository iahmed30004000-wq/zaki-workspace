import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson, ideaStatuses } from "@/server/validation";
import type { OrgAccessContext } from "@/server/auth";
import { assertCan, requireActor } from "@/server/policy/actor";
import { assertNotGuest } from "@/server/services/guest-guard";
import { createIdea, listIdeas } from "@/server/services/ideas";
import { currentSpace } from "@/server/services/current-space";
import { dispatchEvent } from "@/server/services/n8n";
import { assertWatchComment } from "@/server/watch/convert";

const createSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().max(2000).nullable().optional(),
  /** «حوّل» in «نتفرّج سوا»: the comment this idea is made from (checked by `assertWatchComment`) */
  sourceMessageId: z.string().min(1).optional(),
});

const querySchema = z.object({
  status: z.enum(ideaStatuses).optional(),
  mine: z.coerce.boolean().optional(),
});

/**
 * The caller's active org = their oldest ACTIVE membership (a suspended or removed one never
 * counts). Each space has its own ideas (2026-10-25); «الشركة» also reads the ones shared with the company.
 *
 * Ideas are the team's own (every idea names its author): staff only. An external partner (guest)
 * gets 403 `guest.no_access` from every handler, before the query string or the body is looked at.
 */
async function ideasCtx(): Promise<OrgAccessContext> {
  const actor = await requireActor();
  assertNotGuest({ orgRole: actor.role });
  // the ideas row of the person's grid («يشوف»); adding is checked again by the service («يضيف ويعدّل»)
  assertCan(actor, "ideas.view", "section.view_denied");
  return { orgId: actor.orgId, orgRole: actor.role, userId: actor.userId };
}

/** READ: every member of the team (never a guest). */
export async function GET(req: Request) {
  return withApi(async () => {
    const ctx = await ideasCtx();
    const url = new URL(req.url);
    const q = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    // the ideas of the space the person is in (and in «الشركة» the ones shared with the company)
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    const place = { spaceId: space?.id ?? null, isHq: space?.kind === "HQ" };
    const ideas = await listIdeas(ctx.orgId, { status: q.status, mine: q.mine, viewerId: ctx.userId, external: ctx.orgRole === "GUEST", place });
    return NextResponse.json({ ideas });
  });
}

/** WRITE: members+ (never guests). */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await ideasCtx();
    const input = await parseJson(createSchema, req);
    // born in the space the person is in
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    const { sourceMessageId, ...text } = input;
    const source = sourceMessageId ? await assertWatchComment(ctx, sourceMessageId) : null;
    const idea = await createIdea(ctx.orgId, ctx, text, space?.id ?? null, source ? { sourceMessageId: source.id } : {});
    await dispatchEvent(ctx.orgId, "idea.created", { ideaId: idea.id, title: idea.title });
    return NextResponse.json({ idea }, { status: 201 });
  });
}
