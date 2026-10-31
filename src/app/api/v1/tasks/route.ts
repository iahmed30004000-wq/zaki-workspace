import { z } from "zod";
import { doorJson, doorRoute, readDoorJson, DoorError } from "@/server/door/http";
import { hasNul, parseDoorBody, taskBodySchema } from "@/server/door/payload";
import { authenticateDoor, doorCreateTask, doorListTasks, idempotencyKeyOf } from "@/server/services/api-door";

/**
 * «الباب» — `/api/v1/tasks` (docs/contracts/workspace-door.v1.md). Machine to machine: `Authorization: Bearer <token>`.
 *
 *   POST  create a task on a board of the token's space (permission `tasks.write`, header `Idempotency-Key` required)
 *   GET   the tasks THIS token created, newest first (permission `tasks.read` or `tasks.write`)
 *   GET   /api/v1/tasks/{id}: the status of one of them
 */
export const dynamic = "force-dynamic";

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(64).refine((v) => !hasNul(v), "door.field.nul").optional(),
});

export async function POST(req: Request) {
  return doorRoute(async (requestId) => {
    const who = await authenticateDoor(req, requestId, "tasks.write");
    const key = idempotencyKeyOf(req);
    const parsed = parseDoorBody(taskBodySchema, await readDoorJson(req));
    if (!parsed.ok) {
      if (parsed.code === "door.customer_data_rejected") {
        throw new DoorError(422, parsed.code, "The payload names customer data. The door takes opaque identifiers only.", { keys: parsed.keys });
      }
      throw new DoorError(422, parsed.code, "The request body is not valid.", parsed.issues);
    }
    const out = await doorCreateTask(who, key, parsed.data);
    return doorJson(out.body, { status: out.status, requestId, headers: out.replayed ? { "idempotent-replayed": "true" } : {} });
  });
}

export async function GET(req: Request) {
  return doorRoute(async (requestId) => {
    const who = await authenticateDoor(req, requestId, "tasks.read");
    const q = listQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!q.success) throw new DoorError(422, "door.validation_failed", "The query is not valid.", q.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    return doorJson(await doorListTasks(who, q.data), { requestId });
  });
}
