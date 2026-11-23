"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { spaceQueryOptions } from "@/lib/chat/cache/queries";
import { fetchSpaceGroups, groupsKey } from "@/lib/chat/v2/use-space-groups";
import type { GroupMeta, SpaceGroups } from "@/lib/chat/v2/groups";

/**
 * «مجلد ← مجموعة ← موضوع»: for the spaces a folder of the person's own holds, the groups of each and the topics the person reads in it (the forum view's own rows, from the chat cache),
 * so the folder can draw a space's groups instead of the space's single row. Nothing is asked while `enabled` is false (a search, or a folder that holds no space).
 * A space whose answer is not here yet, or has no group, is simply absent: its row stays.
 */
export function useFolderGroupSpaces(spaceIds: readonly string[], enabled: boolean): Map<string, SpaceGroups> {
  const ids = useMemo(() => [...new Set(spaceIds)].slice(0, 10), [spaceIds]);
  const groups = useQueries({
    queries: ids.map((id) => ({ queryKey: groupsKey(id), enabled, staleTime: 30_000, retry: false, queryFn: () => fetchSpaceGroups(id) })),
  });
  const spaces = useQueries({ queries: ids.map((id) => ({ ...spaceQueryOptions(id), enabled })) });
  return useMemo(() => {
    const out = new Map<string, SpaceGroups>();
    ids.forEach((id, i) => {
      const g = groups[i]?.data as GroupMeta[] | undefined;
      const s = spaces[i]?.data;
      if (g && g.length > 0 && s) out.set(id, { groups: g, topics: s.rows, canManage: s.space.canModerate });
    });
    return out;
    // `useQueries` hands back a new array each render: the data inside is what changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, ...groups.map((q) => q.data), ...spaces.map((q) => q.data)]);
}
