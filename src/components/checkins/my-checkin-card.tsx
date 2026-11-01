"use client";

import React from "react";
import Link from "next/link";
import { ck } from "@/lib/checkins-client";
import type { CardState } from "@/server/services/checkins";
import { pollMs } from "@/lib/economy";

/** How often the card asks again, so a round that just opened shows up without a reload. */
const REFRESH_MS = 60_000;

/** The one line of the card: where the person stands in today's round. */
export function CheckinCardBody({ state }: { state: CardState }) {
  if (state === "none") return null;
  const line = state === "pending" ? ck("checkins.card.pending") : state === "excused" ? ck("checkins.card.excused") : ck("checkins.card.answered");
  return (
    <section aria-labelledby="checkin-card-title" data-checkin-card={state} className="rounded-card border border-border bg-surface-1 shadow-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="checkin-card-title" className="text-base font-semibold text-fg">
            {ck("checkins.card.title")}
          </h2>
          <p className={`text-sm ${state === "pending" ? "text-warn" : "text-fg-muted"}`}>{line}</p>
        </div>
        <Link href="/checkins" className="text-sm text-accent underline-offset-2 hover:underline">
          {ck(state === "pending" ? "checkins.card.open" : "checkins.card.edit")}
        </Link>
      </div>
    </section>
  );
}

/**
 * «تسجيلك اليومي: لسا ما سجّلت» — a compact card on «اليوم». Mounted by one line of the page, only while the company's
 * switch is on; it draws nothing when there is no round for the person today (no check-in, not their turn, a guest).
 */
export function MyCheckinCard() {
  const [state, setState] = React.useState<CardState>("none");

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/checkins/mine", { cache: "no-store" });
      if (!res.ok) return setState("none");
      setState(((await res.json()) as { state: CardState }).state);
    } catch {
      setState("none");
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), pollMs(REFRESH_MS));
    return () => clearInterval(timer);
  }, [load]);

  return <CheckinCardBody state={state} />;
}
