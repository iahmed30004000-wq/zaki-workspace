import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { moveTopicToGroup } from "@/server/chat/groups";
import {
  TopicConflictError,
  deleteTopic,
  setTopicArchived,
  setTopicClosed,
  setTopicPinned,
  updateTopic,
  updateTopicSchema,
} from "@/server/chat/topics";

const patchSchema = updateTopicSchema.extend({
  closed: z.boolean().optional(),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
  /** «نقل إلى مجموعة»: a group of the topic's space, or null for «عام» (src/server/chat/groups.ts). */
  groupId: z.string().min(1).nullable().optional(),
});

/**
 * PATCH: topic settings (title, emoji, restricted, posting policy), close/reopen (`closed`), archive/bring back
 * (`archived`) and pin on top (`pinned`).
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const { closed, archived, pinned, groupId, ...input } = await parseJson(patchSchema, req);
    const ctx = await activeOrgCtx();
    try {
      if (archived !== undefined) await setTopicArchived(ctx, params.id, archived);
      if (closed !== undefined) await setTopicClosed(ctx, params.id, closed);
      if (pinned !== undefined) await setTopicPinned(ctx, params.id, pinned);
    } catch (err) {
      if (err instanceof TopicConflictError) return apiError("conflict", err.message);
      throw err;
    }
    if (Object.keys(input).length) await updateTopic(ctx, params.id, input);
    if (groupId !== undefined) await moveTopicToGroup(ctx, params.id, groupId);
    return NextResponse.json({ ok: true });
  });
}

/** DELETE: a topic nobody wrote in (one with messages is archived instead: 409), never a system one. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    try {
      await deleteTopic(ctx, params.id);
    } catch (err) {
      if (err instanceof TopicConflictError) return apiError("conflict", err.message);
      throw err;
    }
    return NextResponse.json({ ok: true });
  });
}
