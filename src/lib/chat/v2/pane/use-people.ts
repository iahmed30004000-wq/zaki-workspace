"use client";

import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MemberDto } from "@/server/chat/dto";
import { CHAT_GC_MS, CHAT_STALE_MS } from "@/lib/chat/cache/constants";
import { chatRetry, fetchChatJson } from "@/lib/chat/cache/http";
import { chatKeys } from "@/lib/chat/cache/keys";
import { conversationPeopleUrl } from "@/lib/chat/conversation/client";
import type { PaneMembers } from "@/lib/chat/v2/pane/composer-detail";

/**
 * C2.4 — the people of the open conversation (the composer's «@», the highlighted mentions, the topic settings' list, the privacy sheet). The header
 * the C1.2 route sends has no member list (and no name of a private row, by design); the one door that still carries it is the old detail route, asked for
 * ONE message. It lives under the chat root (`["chat","conv",id,"people"]`) so the cache's own wipe, removal and reset reach it, and persistence (which only
 * keeps headers and messages) never writes it to the device.
 *
 * ⚠️ A members door of its own (no messages in the answer) would be cheaper. 🔧 Until the owner of the server side adds one, this is the cost: one small
 * request per conversation per five minutes, never on a switch back to a conversation that was just open.
 */
export const peopleKey = (id: string, count: number | undefined) => [...chatKeys.conv(id), "people", count ?? null] as const;

/**
 * `count` is the header's `memberCount`: the people are asked for once the header says how many there are, and AGAIN when that number changes (a person
 * added or removed), so the «@» list and the sheet never keep somebody who left for the five minutes the cache would otherwise believe them.
 */
export function usePeople(id: string | null, count: number | undefined): PaneMembers | null {
  const query = useQuery({
    queryKey: peopleKey(id ?? "", count),
    enabled: !!id && count !== undefined,
    staleTime: CHAT_STALE_MS,
    gcTime: CHAT_GC_MS,
    retry: chatRetry,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }): Promise<PaneMembers> => {
      const detail = await fetchChatJson<{ members?: MemberDto[]; mentionables?: MemberDto[] }>(conversationPeopleUrl(id ?? ""), signal);
      return { ...(detail.members ? { members: detail.members } : {}), ...(detail.mentionables ? { mentionables: detail.mentionables } : {}) };
    },
  });
  // while the answer for a NEW number is on its way the people of the SAME conversation stay (never those of another one)
  const last = useRef<{ id: string | null; people: PaneMembers | null }>({ id, people: null });
  if (last.current.id !== id) last.current = { id, people: null };
  if (query.data) last.current.people = query.data;
  return query.data ?? last.current.people;
}
