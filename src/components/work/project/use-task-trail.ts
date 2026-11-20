"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { taskTrail, type Crumb } from "./crumbs";

/** What `GET /boards/<id>/trail` answers: the names above a board, and whether the new map's trail is shown at all. */
export interface TrailAnswer {
  show: boolean;
  spaceName: string;
  projectId: string;
  projectName: string;
  boardId: string;
  boardName: string;
}

/** The trail of a task's page (N1.5): asked once for the task's board (it changes rarely), drawn only when the server says `show` (switch `navV2`). `enabled: false` asks nothing. */
export function useTaskTrail(boardId: string, taskKey: string, enabled: boolean): Crumb[] | null {
  const query = useQuery({
    queryKey: ["board-trail", boardId],
    queryFn: () => apiGet<TrailAnswer>(`/boards/${boardId}/trail`),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const answer = query.data;
  if (!enabled || !answer?.show) return null;
  return taskTrail({ spaceName: answer.spaceName, projectId: answer.projectId, projectName: answer.projectName }, { id: answer.boardId, name: answer.boardName }, taskKey);
}
