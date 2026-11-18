import { doorJson, doorRoute, readDoorJson } from "@/server/door/http";
import { authenticateMessages, doorPostMessage } from "@/server/door/messages";
import { idempotencyKeyOf } from "@/server/services/api-door";

/**
 * «باب الرسائل» — `POST /api/v2/messages` (docs/contracts/workspace-door.v2.md), the ONE endpoint of v2. Machine to machine: no session, no cookie; the caller proves
 * itself with `Authorization: Bearer <token>` holding `messages.write`. Every answer is the door's envelope (v1's). The switches «باب الربط الخارجي» and
 * «باب الرسائل» off = 404 for every token. Header `Idempotency-Key` required.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return doorRoute(async (requestId) => {
    const who = await authenticateMessages(req, requestId);
    const key = idempotencyKeyOf(req);
    const out = await doorPostMessage(who, key, await readDoorJson(req));
    return doorJson(out.body, { status: out.status, requestId, headers: out.replayed ? { "idempotent-replayed": "true" } : {} });
  });
}
