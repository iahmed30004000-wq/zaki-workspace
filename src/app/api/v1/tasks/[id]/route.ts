import { doorJson, doorRoute } from "@/server/door/http";
import { authenticateDoor, doorTaskStatus } from "@/server/services/api-door";

/** «الباب» — `GET /api/v1/tasks/{id}`: the status of a task THIS token created (any other task is 404). Permission `tasks.read` or `tasks.write`. */
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: { id: string } }) {
  return doorRoute(async (requestId) => {
    const who = await authenticateDoor(req, requestId, "tasks.read");
    return doorJson({ data: await doorTaskStatus(who, ctx.params.id) }, { requestId });
  });
}
