"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * C2.3 — the «مقاطع» (teams) of a space, for «موضوع جديد» in the forum view (the topic can be for one of them). The forum DTO carries no sections, so
 * they are asked for from the existing teams route the moment the person asks for the dialog, not before. The server decides again who sees which.
 * `settled` is true once the answer (or the failure) is in: the dialog opens only then, because it reads its sections once, when it is built.
 */
export interface SpaceSection {
  id: string;
  name: string;
}

export function useSpaceSections(spaceId: string, enabled: boolean): { sections: SpaceSection[]; settled: boolean } {
  const query = useQuery({
    queryKey: ["chat-v2-sections", spaceId],
    enabled: enabled && !!spaceId,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<SpaceSection[]> => {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(spaceId)}/teams`, { cache: "no-store", credentials: "same-origin", signal });
      if (!res.ok) throw new Error("teams");
      const body = (await res.json()) as { teams?: { id: string; name: string }[] };
      return (body.teams ?? []).map((team) => ({ id: team.id, name: team.name }));
    },
  });
  return { sections: query.data ?? [], settled: query.isSuccess || query.isError };
}
