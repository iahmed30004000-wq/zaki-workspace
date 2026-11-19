"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Phone, PhoneOff } from "lucide-react";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ct } from "@/lib/chat/text";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { callApi, type CallView } from "./call-api";
import { useOptionalCall } from "./call-provider";
import { ensurePush } from "./push-client";
import { startRing } from "@/lib/calls/ring-sound";

/** A ring stops by itself after this long (an unanswered call). */
export const RING_FOR_MS = 30_000;

/**
 * C2.9 — THE CARD of the incoming call, looks only (the ring's logic is `CallRing` below and is not touched): a flat floating card on the new tokens (one soft
 * shadow, no border noise), the caller's picture with a quiet pulse, the name and what kind of call, and two 44 px buttons — «رفض» (the button set's danger
 * variant) and «ردّ» (green, the `ok` pair). It sits under the notch (`env(safe-area-inset-top)`) and fades up 120 ms (off under reduced motion).
 */
export function CallRingCard({ view, onDecline, onAnswer }: { view: CallView; onDecline: () => void; onAnswer: () => void }) {
  const where = view.conversationTitle || view.title;
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={ct("calls.ring.from", { name: view.startedBy.name })}
      dir="rtl"
      lang="ar"
      data-call-ring=""
      className="fixed start-3 end-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 mx-auto flex max-w-sm animate-fade-up items-center gap-3 rounded-2xl border border-border bg-surface-1 p-3 shadow-card motion-reduce:animate-none"
    >
      <span className="relative shrink-0">
        <span aria-hidden="true" className="absolute inset-0 animate-pulse rounded-full bg-ok/20 motion-reduce:animate-none" />
        <Avatar name={view.startedBy.name} src={view.startedBy.avatarUrl} className="relative size-12" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{ct("calls.ring.from", { name: view.startedBy.name })}</p>
        <p className="truncate text-sm text-fg-muted">
          {view.video ? ct("calls.video") : ct("calls.audio")}
          {where ? ` ${ct("calls.ring.in", { title: where })}` : ""}
        </p>
      </div>
      <Button type="button" variant="danger" onClick={onDecline} className="min-h-11 rounded-full px-3 md:h-11">
        <PhoneOff aria-hidden="true" className="size-4" />
        {ct("calls.ring.decline")}
      </Button>
      <Button type="button" onClick={onAnswer} className="min-h-11 rounded-full bg-ok px-4 font-semibold text-ok-fg hover:bg-ok/90 md:h-11">
        <Phone aria-hidden="true" className="size-4" />
        {ct("calls.ring.answer")}
      </Button>
    </div>
  );
}

/**
 * The incoming call, on every page: somebody rang this person (a DM call, a topic call that «رنّ على الكل», or
 * «ضيف حدا»). The event carries ids only; the card asks the calls API, which answers only somebody who may join,
 * and a call that ended rings nobody. «ردّ» opens the call's page; «رفض» or thirty seconds close the card.
 */
export function CallRing() {
  const router = useRouter();
  const pathname = usePathname();
  const [ringing, setRinging] = React.useState<CallView | null>(null);
  const call = useOptionalCall();

  useRealtime((event) => {
    if (event.kind !== "call.ring" || !event.callId) return;
    if (pathname === `/calls/${event.callId}`) return; // already in it
    void callApi<CallView>(`/api/calls/${encodeURIComponent(event.callId)}`).then(
      (view) => {
        if (!view.endedAt) {
          setRinging(view);
          // warm the connection while it rings, so «ردّ» is instant
          call?.prefetch(view.id);
        }
      },
      () => undefined,
    );
  });

  React.useEffect(() => {
    if (!ringing) return;
    const stop = setTimeout(() => setRinging(null), RING_FOR_MS);
    const tone = startRing();
    return () => {
      clearTimeout(stop);
      tone();
    };
  }, [ringing]);

  if (!ringing) return null;
  return (
    <CallRingCard
      view={ringing}
      onDecline={() => setRinging(null)}
      onAnswer={() => {
        const id = ringing.id;
        void ensurePush(true);
        setRinging(null);
        router.push(`/calls/${encodeURIComponent(id)}`);
      }}
    />
  );
}
