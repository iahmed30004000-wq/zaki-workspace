"use client";

import { useQuery } from "@tanstack/react-query";
import { CHAT_GC_MS, CHAT_STALE_MS } from "@/lib/chat/cache/constants";
import { chatKeys } from "@/lib/chat/cache/keys";

/**
 * C2.7 — the two small things the info panel asks for that the header does not carry, each through a door that ALREADY exists (no new route):
 *
 *  - the other person's job title and bio: `GET /api/users/<id>` (the profile route: the server answers a person without the directory right, or a guest, with
 *    less or a refusal — then there is simply no profile line and no link, never an error on screen). There is no username in that answer, so none is shown.
 *  - the name of a «مقطع»: `GET /api/workspaces/<space>/teams` (the list the topic settings already read), to say «المقطع: …». Without it the panel says it is a
 *    section's topic and names none.
 *
 * Both live under the chat root of the cache (`["chat","conv",id,…]`), so the cache's own wipe and removal reach them, and persistence (which keeps only
 * headers and messages) never writes them to the device.
 */
export interface PeerProfile {
  jobTitle: string | null;
  bio: string | null;
}

export const peerProfileKey = (conversationId: string, peerId: string) => [...chatKeys.conv(conversationId), "peer", peerId] as const;
export const teamNameKey = (conversationId: string, teamId: string) => [...chatKeys.conv(conversationId), "team", teamId] as const;

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

export function usePeerProfile(conversationId: string, peerId: string | null): PeerProfile | null {
  const query = useQuery({
    queryKey: peerProfileKey(conversationId, peerId ?? ""),
    enabled: !!peerId,
    staleTime: CHAT_STALE_MS,
    gcTime: CHAT_GC_MS,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<PeerProfile | null> => {
      const res = await fetch(`/api/users/${encodeURIComponent(peerId ?? "")}`, { signal, cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as { profile?: { jobTitle?: unknown; bio?: unknown } } | null;
      return { jobTitle: text(body?.profile?.jobTitle), bio: text(body?.profile?.bio) };
    },
  });
  return query.data ?? null;
}

export function useTeamName(conversationId: string, spaceId: string | null, teamId: string | null): string | null {
  const query = useQuery({
    queryKey: teamNameKey(conversationId, teamId ?? ""),
    enabled: !!spaceId && !!teamId,
    staleTime: CHAT_STALE_MS,
    gcTime: CHAT_GC_MS,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<string | null> => {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(spaceId ?? "")}/teams`, { signal, cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as { teams?: { id?: unknown; name?: unknown }[] } | null;
      return text(body?.teams?.find((team) => team.id === teamId)?.name);
    },
  });
  return query.data ?? null;
}
