"use client";

import { useEffect, useState } from "react";
import { ProposalCard } from "@/components/owner-assistant/proposal-card";
import type { ProposalView } from "@/server/services/owner-assistant-proposals";

/**
 * The proposals under an answer of «المساعد» in the owner's own conversation: the SAME cards as «مساعد المالك» (src/components/owner-assistant/
 * proposal-card.tsx) with «وافق» / «ارفض». Nothing has been done until he presses «وافق»; the cards say so. They are read from the server, which
 * returns only his own proposals, so a copy of the line seen by anybody else shows nothing.
 */
export function AssistantProposals({ ids }: { ids: string }) {
  const [views, setViews] = useState<ProposalView[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/chat/assistant/proposals?ids=${encodeURIComponent(ids)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ proposals: ProposalView[] }>) : { proposals: [] }))
      .then((data) => {
        if (alive) setViews(data.proposals);
      })
      .catch(() => {
        if (alive) setViews([]);
      });
    return () => {
      alive = false;
    };
  }, [ids]);
  if (!views || views.length === 0) return null;
  return (
    <div className="mt-2 space-y-2" data-testid="assistant-proposals">
      {views.map((v) => (
        <ProposalCard key={v.id} proposal={v} />
      ))}
    </div>
  );
}
