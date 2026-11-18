"use client";

import { useQuery } from "@tanstack/react-query";
import type { OversightConversationDto } from "@/server/chat/dto";

/**
 * C2.2 — «كل الشركة»: the owner's silent oversight list, the SAME read the old home makes (`GET /api/chat/oversight/conversations`, which the server
 * answers only for a holder of `archive.view` and which leaves no trace). It is fetched only while that folder is open, kept for a minute in memory and
 * never in the chat cache or on the device: these are other people's conversations. The key does not start with "chat" (the cache's persister and its
 * wipe know four keys, and this is none of them).
 */
export interface OversightListDto {
  items: OversightConversationDto[];
  nextCursor: string | null;
}

export const OVERSIGHT_KEY = ["oversight-v2", "list"] as const;

export async function fetchOversight(signal?: AbortSignal): Promise<OversightListDto> {
  const res = await fetch("/api/chat/oversight/conversations?limit=100", { cache: "no-store", credentials: "same-origin", ...(signal ? { signal } : {}) });
  if (!res.ok) throw new Error("oversight");
  return (await res.json()) as OversightListDto;
}

export function useOversightList(enabled: boolean) {
  return useQuery({ queryKey: OVERSIGHT_KEY, queryFn: ({ signal }) => fetchOversight(signal), enabled, staleTime: 30_000, gcTime: 60_000, retry: false, refetchOnWindowFocus: false });
}
