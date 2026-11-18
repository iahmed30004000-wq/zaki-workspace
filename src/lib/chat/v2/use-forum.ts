"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { spaceQueryOptions } from "@/lib/chat/cache/queries";
import type { SpaceTopicsDto } from "@/lib/chat/cache/types";

/**
 * C2.3 — does the open forum hold this conversation as one of its topics? One yes / no question of the cache (`null`: not known yet, or nothing to ask), so the
 * column re-draws only when the ANSWER changes, not on every message of the space's topics. It reads the same query the forum view reads (one request).
 */
export function useForumHolds(spaceId: string | null, conversationId: string | null): boolean | null {
  const select = useCallback((dto: SpaceTopicsDto): boolean | null => (conversationId ? dto.rows.some((row) => row.id === conversationId) : null), [conversationId]);
  const query = useQuery({ ...spaceQueryOptions(spaceId ?? ""), select, enabled: !!spaceId && !!conversationId });
  return query.data ?? null;
}
