import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, requireWorkspace } from "@/server/auth";
import { apiError, withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import { SpaceConflictError, deleteEmptyWorkspace, readWorkspace } from "@/server/services/workspaces";

/** The space's emoji (A2.2, «عام»): one picture, never text — a pictograph in at most 16 characters (a flag or a family is several code points); `null` clears it. */
const emojiSchema = z
  .string()
  .trim()
  .max(16, "space.emoji_invalid")
  .refine((value) => /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u.test(value) && !/[\p{L}\p{N}]/u.test(value), "space.emoji_invalid")
  .nullable();

/** Any of the three; the old body (a name and a description) is still valid, an empty body is not. */
const renameSchema = z
  .object({
    name: z.string().trim().min(2, "name.too_short").max(80, "name.too_long").optional(),
    description: z.string().trim().max(300).nullable().optional(),
    emoji: emojiSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.description !== undefined || body.emoji !== undefined, "name.too_short");

/**
 * GET: one space, for the people in it (any role, an org GUEST included) and for the OWNER, who needs
 * no row and leaves no trace by looking. An ADMIN who is not in it is refused like everybody else.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireWorkspace(params.id);
    return NextResponse.json(await readWorkspace(ctx, params.id));
  });
}

/** PATCH: rename / re-describe a space, or change its emoji. Its ADMIN, the OWNER, or an org ADMIN who is in it. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireWorkspace(params.id, ["ADMIN"]);
    const input = await parseJson(renameSchema, req);
    const updated = await db.workspace.update({
      where: { id: params.id },
      data: { name: input.name, description: input.description ?? undefined, emoji: input.emoji },
      select: { id: true, name: true, description: true, emoji: true },
    });
    await audit("workspace.renamed", {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      target: params.id,
      meta: { name: input.name ?? null, emoji: input.emoji !== undefined },
    });
    return NextResponse.json({ workspace: updated });
  });
}

/**
 * DELETE: removes a space that holds no projects. Its ADMIN, the OWNER, or an org ADMIN who is in it.
 * A space with work in it is never deleted by this door (409 `spaces.not_empty`): the work would go
 * with it, for good.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireWorkspace(params.id, ["ADMIN"]);
    const ws = await db.workspace.findUnique({ where: { id: params.id }, select: { name: true } });
    try {
      await deleteEmptyWorkspace(params.id);
    } catch (err) {
      if (err instanceof SpaceConflictError) return apiError("conflict", err.message);
      throw err;
    }
    await audit("workspace.deleted", {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      target: params.id,
      meta: { name: ws?.name ?? null },
    });
    return NextResponse.json({ ok: true });
  });
}
