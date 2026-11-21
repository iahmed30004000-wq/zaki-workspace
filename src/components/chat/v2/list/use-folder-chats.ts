"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSpaces, ORGS_QUERY_KEY } from "@/components/shell/space-switcher";
import { useChatList, useChatSpace } from "@/lib/chat/cache/selectors";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { pickableChats, withPickedTopics } from "@/lib/chat/folders";
import type { ChatFolderDef } from "@/lib/chat/prefs";

/**
 * S5.3 — where a folder gets its TOPICS. The list of ONE space (`scope: "space"`, today's production shape) already holds that space's topics. The one-list shape
 * (`chatOneList`) holds one row per space and none for a topic, so there the topics of the person's CURRENT space (the space they are in, as the shell says it) come
 * from that space's own view, `GET /api/chat/spaces/<id>/topics`: the same door the forum view reads, which lists only what the person may read (an open topic, a
 * restricted one they belong to, never the others). Nothing here asks for another space's topics, and nothing is read until `enabled`.
 */
function useCurrentSpaceTopics(scope: "all" | "space", enabled: boolean) {
  const oneList = scope === "all";
  const spaces = useQuery({ queryKey: ORGS_QUERY_KEY, queryFn: fetchSpaces, staleTime: 60_000, enabled: enabled && oneList });
  const spaceId = enabled && oneList ? (spaces.data?.currentSpaceId ?? null) : null;
  const space = useChatSpace(spaceId);
  // loaded: the list has no topics to wait for (one-space shape), or the space's view has come (or there is no current space to ask about)
  const topicsLoaded = !enabled || !oneList || (spaces.isPending ? false : spaceId ? !space.isPending : true);
  return { topics: space.rows, topicsLoaded };
}

/**
 * The chats the folder picker offers (the sheet, the settings page): the person's chats and the topics of their current space, never a space's own row. `loaded` is
 * true once everything it reads has come, so a pick is not called «not visible» while a list is still on its way.
 */
export function useFolderChats(enabled = true): { chats: ChatRowDto[]; loaded: boolean } {
  const list = useChatList("all");
  const { topics, topicsLoaded } = useCurrentSpaceTopics(list.scope, enabled);
  const own = useMemo(() => [...list.rows, ...list.archivedRows], [list.rows, list.archivedRows]);
  const chats = useMemo(() => pickableChats(own, topics), [own, topics]);
  return { chats, loaded: !list.isPending && !list.isError && topicsLoaded };
}

/**
 * The rows the person's folders are drawn from (the list column): the list's rows, plus (one-list shape only) the topics of the current space that a folder lists by
 * hand. The space's view is read only while some folder lists a conversation by hand.
 */
export function useFolderSourceRows(list: { rows: readonly ChatRowDto[]; scope: "all" | "space" }, folders: readonly ChatFolderDef[]): readonly ChatRowDto[] {
  const wanted = folders.some((f) => f.include.conversationIds.length > 0);
  const { topics } = useCurrentSpaceTopics(list.scope, wanted);
  const { rows } = list;
  return useMemo(() => withPickedTopics(rows, topics, folders), [rows, topics, folders]);
}
