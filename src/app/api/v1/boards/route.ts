import { doorJson, doorRoute } from "@/server/door/http";
import { authenticateDoor, doorListBoards } from "@/server/services/api-door";

/**
 * «الباب» — `GET /api/v1/boards` (docs/contracts/workspace-door.v1.md): the boards of the token's space a task may be sent to
 * (`boardId` of `POST /api/v1/tasks`). Permission `tasks.read` or `tasks.write`.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return doorRoute(async (requestId) => {
    const who = await authenticateDoor(req, requestId, "tasks.read");
    return doorJson({ data: await doorListBoards(who) }, { requestId });
  });
}
