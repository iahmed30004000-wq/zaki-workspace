import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { setMustRead } from "@/server/services/must-read";

/** POST `{ on }`: marks a message «لازم ينقرأ» (or takes the mark off). Topic moderators and holders of «إعلانات للجميع» only. */
export const dynamic = "force-dynamic";
const schema = z.object({ on: z.boolean() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(schema, req);
    return NextResponse.json(await setMustRead(await activeOrgCtx(), params.id, input.on));
  });
}
