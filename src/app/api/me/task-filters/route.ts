import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { db } from "@/server/db";
import { savedFiltersSchema } from "@/lib/work/saved-filters";

/** PUT { chip, stage, inProject, urgent, who, sort } — keeps MY filters on «مهامي». Only my own row; nothing about what I may see changes. */
export async function PUT(req: Request) {
  return withApi(async () => {
    const filters = await parseJson(savedFiltersSchema, req);
    const actor = await requireActor();
    await db.user.update({ where: { id: actor.userId }, data: { taskFilters: filters as Prisma.InputJsonValue } });
    return NextResponse.json({ ok: true });
  });
}
