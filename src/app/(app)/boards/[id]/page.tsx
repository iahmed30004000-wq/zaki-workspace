import { notFound } from "next/navigation";
import { pageUser } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { SectionOffNotice } from "@/app/(app)/_access";
import { keepInSpace } from "@/server/services/current-space";
import { BoardView } from "@/components/board-view";
import { actorFeatureOn } from "@/server/services/features";
import { boardTrail } from "@/components/work/project/crumbs";
import { boardScreenFor } from "@/server/services/work-app";

/**
 * A board opens for whoever may open its space (`accessibleWorkspaceIds`: a row in the space, or the owner) and is
 * an ACTIVE member of its company. Anybody else - and an old link to a board that is gone - gets the shell's «not
 * found» page through `notFound()`: one answer for «not there» and «not yours», so it does not tell a stranger the
 * board exists. A thrown domain error would reach the visitor as Next's bare «Application error» screen.
 *
 * W1.5: with the switch `navV2` ON the board wears the trail «المساحة › المشروع › اللوحة» (the way back) and - when «مهامي» (`workMyTasks`) is on too - a
 * card opens in a side panel over the board instead of leaving it. With it OFF the board is the page it always was. Every card is read through the
 * task-visibility rule (`taskVisibleWhere`, P0.2). The project page's board tab draws this same screen (`project-page.tsx` calls this page).
 *
 * M2 N3: what the board shows is read by `boardScreenFor` (src/server/services/work-app.ts), the same function the phone's door
 * `GET /api/work/boards/[id]` answers with, so the two cannot drift.
 */
export default async function BoardPage({ params }: { params: { id: string } }) {
  const user = await pageUser();
  if (!user) return null;
  const actor = await requireActor();
  const screen = await boardScreenFor(actor, params.id);
  // its project's space and team: another team's board is «not found»
  if (screen.kind === "notFound") notFound();
  // the projects row of the person's grid
  if (screen.kind === "off") return <SectionOffNotice />;
  const { board, columns, tasks, fieldDefs, canEdit } = screen.data;
  // a thing of another space of theirs: enter that space first, so the name at the top says where it is
  await keepInSpace(actor, board.workspaceId, `/boards/${board.id}`);

  // W1.5: the new map's dress (the trail, the side panel); the old board has none of it
  const v2 = await actorFeatureOn(actor, "navV2");
  const panel = v2 && (await actorFeatureOn(actor, "workMyTasks"));

  return (
    <BoardView
      board={{ id: board.id, workspaceId: board.workspaceId, projectId: board.projectId, name: board.name, projectName: board.projectName }}
      columns={columns}
      tasks={tasks}
      fieldDefs={fieldDefs}
      canEdit={canEdit}
      {...(v2
        ? { view: { crumbs: boardTrail({ spaceName: board.workspaceName, projectId: board.projectId, projectName: board.projectName }, board.name), panel, embedded: false } }
        : {})}
    />
  );
}
