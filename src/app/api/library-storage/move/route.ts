import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { deleteServerCopies, moveToDrive } from "@/server/services/storage";

const bodySchema = z.object({
  // copy: «انقل الملفات القديمة للدرايف» (never deletes); delete: «احذف نسخ السيرفر المتحقَّق منها» (a separate click)
  step: z.enum(["copy", "delete"]),
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(25).optional(),
  after: z.string().min(1).max(64).nullish(),
});

/**
 * POST: one small batch of the owner's storage move (see src/server/services/storage.ts). The OWNER's alone; the service
 * decides. `dryRun` counts and changes nothing; the screen repeats the call with the `next` of the last answer until it is null.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const opts = { dryRun: body.dryRun ?? false, ...(body.limit ? { limit: body.limit } : {}), after: body.after ?? null };
    return NextResponse.json(body.step === "copy" ? await moveToDrive(ctx, opts) : await deleteServerCopies(ctx, opts));
  });
}
