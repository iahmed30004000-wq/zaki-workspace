import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { createApiToken, listApiTokens, TOKEN_EXPIRY_DAYS } from "@/server/services/api-tokens";
import { DOOR_PERMISSIONS } from "@/server/door/tokens";

/**
 * «الباب»: the tokens of the company (docs/contracts/workspace-door.v1.md). For whoever holds «integrations.manage», while the
 * switch «باب الربط» is on (404 while it is off). The whole token is in the answer of the POST and nowhere else, ever.
 */
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(2, "door.err.name").max(60, "door.err.name"),
  permissions: z.array(z.enum(DOOR_PERMISSIONS)).min(1, "door.err.permissions").max(DOOR_PERMISSIONS.length),
  workspaceId: z.string().min(1, "door.err.space").max(64),
  /** null: never expires. */
  expiresInDays: z
    .union([z.null(), z.number().int().refine((n) => (TOKEN_EXPIRY_DAYS as readonly number[]).includes(n), "door.err.expiry")])
    .default(null),
});

export async function GET() {
  return withApi(async () => NextResponse.json(await listApiTokens(await requireActor())));
}

export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(createSchema, req);
    const made = await createApiToken(actor, input);
    return NextResponse.json(made, { status: 201, headers: { "cache-control": "no-store" } });
  });
}
