import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { createSystemToken, listSystemTokens } from "@/server/services/system-tokens";
import { TOKEN_EXPIRY_DAYS } from "@/server/services/api-tokens";

/**
 * «الإعدادات ← توكنات الأنظمة» (W1): the OWNER's tokens for the systems that call Zaki Workspace. Making one needs the switch «باب الربط» on; the list and the
 * revoke work while it is off. The whole token is in the answer of the POST and nowhere else, ever. The request names the system and the space — never the scopes.
 */
export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    system: z.string().min(1, "door.err.system").max(40, "door.err.system"),
    workspaceId: z.string().min(1, "door.err.space").max(64),
    /** «باسم مين»: a 🤖 account of that space; absent or null: the owner's own name. */
    actsAsId: z.string().min(1).max(64).nullable().optional(),
    /** absent: 90 days; null: never expires. */
    expiresInDays: z.union([z.null(), z.number().int().refine((n) => (TOKEN_EXPIRY_DAYS as readonly number[]).includes(n), "door.err.expiry")]).optional(),
  })
  .strict();

export async function GET() {
  return withApi(async () => NextResponse.json(await listSystemTokens(await requireActor()), { headers: { "cache-control": "no-store" } }));
}

export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(createSchema, req);
    return NextResponse.json(await createSystemToken(actor, input), { status: 201, headers: { "cache-control": "no-store" } });
  });
}
