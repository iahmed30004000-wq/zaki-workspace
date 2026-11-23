"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/api-client";
import { chatKeys } from "@/lib/chat/cache/keys";
import type { GroupMeta } from "@/lib/chat/v2/groups";

/**
 * «مجموعات المواضيع» on the screen: the groups of ONE space (`GET /api/groups?spaceId=`: only the ones this person may know) and the few things a manager does with them. The topic
 * rows carry their own `groupId` (the chat list); this is the groups' name, picture and order. A failed read leaves the list flat (no groups), exactly as it was.
 */
export const groupsKey = (spaceId: string) => ["chat-v2-groups", spaceId] as const;

interface GroupDto {
  id: string;
  name: string;
  emoji: string | null;
  position: number;
  restricted: boolean;
}

const NONE: GroupMeta[] = [];

const metaOf = (g: GroupDto): GroupMeta => ({ id: g.id, name: g.name, emoji: g.emoji, position: g.position, restricted: g.restricted });

/** The groups of one space the person may know (the very read of the hook, for the screens that ask for several spaces at once). */
export async function fetchSpaceGroups(spaceId: string): Promise<GroupMeta[]> {
  return (await apiGet<{ groups: GroupDto[] }>(`/api/groups?spaceId=${encodeURIComponent(spaceId)}`)).groups.map(metaOf);
}

export function useSpaceGroups(spaceId: string | null): { groups: GroupMeta[]; isPending: boolean } {
  const query = useQuery({
    queryKey: groupsKey(spaceId ?? ""),
    enabled: !!spaceId,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: () => fetchSpaceGroups(spaceId ?? ""),
  });
  return { groups: query.data ?? NONE, isPending: !!spaceId && query.isPending };
}

/** What a manager does: make a group, move a topic into one (or back to «عام»), drag the groups. Each asks the lists again; the server decides every time. */
export function useGroupActions(spaceId: string | null) {
  const qc = useQueryClient();
  const refresh = useCallback(() => {
    if (spaceId) void qc.invalidateQueries({ queryKey: groupsKey(spaceId) });
    void qc.invalidateQueries({ queryKey: chatKeys.list() });
    void qc.invalidateQueries({ queryKey: chatKeys.spaces() });
  }, [qc, spaceId]);

  const create = useMutation({
    mutationFn: (input: { name: string; emoji?: string }) => apiPost<{ group: GroupDto }>("/api/groups", { spaceId, name: input.name, ...(input.emoji ? { emoji: input.emoji } : {}) }),
    onSuccess: refresh,
  });
  const move = useMutation({
    mutationFn: (input: { topicId: string; groupId: string | null }) => apiPatch(`/api/topics/${encodeURIComponent(input.topicId)}`, { groupId: input.groupId }),
    onSuccess: refresh,
  });
  const reorder = useMutation({
    mutationFn: (order: string[]) => apiPut("/api/groups", { spaceId, order }),
    onSuccess: refresh,
  });
  return { create, move, reorder, refresh };
}
