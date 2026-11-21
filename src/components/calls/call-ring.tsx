"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Phone, PhoneOff } from "lucide-react";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ct } from "@/lib/chat/text";
import { ringIsOver } from "@/lib/calls/session";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { callApi, type CallView } from "./call-api";
import { useOptionalCall } from "./call-provider";
import { ensurePush } from "./push-client";
import { startRing } from "@/lib/calls/ring-sound";
import { announceRingDone, onRingDone, startSharedRing } from "@/lib/calls/ring-lock";
import { startVibration } from "@/lib/calls/vibrate";

/** A ring stops by itself after this long (an unanswered call). */
export const RING_FOR_MS = 30_000;

/**
 * THE CARD of the incoming call. A PRIVATE call (somebody calls this person) takes the whole screen on a phone, like Telegram: the caller's
 * picture with a quiet pulse, the name and what kind of call, and two big buttons — «رفض» (the button set's danger variant) and «ردّ» (green, the
 * `ok` pair); from `md` up it is the compact floating banner. A topic's or a meeting's ring is always the compact banner (a ring into a crowd must not
 * take the screen). It sits under the notch (`env(safe-area-inset-top)`) and fades up 120 ms (off under reduced motion).
 */
export function CallRingCard({ view, onDecline, onAnswer }: { view: CallView; onDecline: () => void; onAnswer: () => void }) {
  const where = view.conversationTitle || view.title;
  const full = view.kind === "DM";
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={ct("calls.ring.from", { name: view.startedBy.name })}
      dir="rtl"
      lang="ar"
      data-call-ring=""
      className={
        full
          ? "fixed inset-0 z-[70] flex animate-fade-up flex-col items-center justify-between bg-surface-1 px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(4rem,env(safe-area-inset-top))] motion-reduce:animate-none md:inset-auto md:start-3 md:end-3 md:top-[calc(0.75rem+env(safe-area-inset-top))] md:z-50 md:mx-auto md:max-w-sm md:flex-row md:justify-start md:gap-3 md:rounded-2xl md:border md:border-border md:p-3 md:shadow-card"
          : "fixed start-3 end-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 mx-auto flex max-w-sm animate-fade-up items-center gap-3 rounded-2xl border border-border bg-surface-1 p-3 shadow-card motion-reduce:animate-none"
      }
    >
      <div className={full ? "flex min-w-0 flex-col items-center gap-4 text-center md:flex-1 md:flex-row md:text-start" : "contents"}>
        <span className="relative shrink-0">
          <span aria-hidden="true" className="absolute inset-0 animate-pulse rounded-full bg-ok/20 motion-reduce:animate-none" />
          <Avatar name={view.startedBy.name} src={view.startedBy.avatarUrl} className={full ? "relative size-32 text-3xl md:size-12 md:text-base" : "relative size-12"} />
        </span>
        <div className={full ? "min-w-0 md:flex-1" : "min-w-0 flex-1"}>
          <p className={full ? "truncate text-2xl font-semibold md:text-base" : "truncate font-semibold"}>{ct("calls.ring.from", { name: view.startedBy.name })}</p>
          <p className={full ? "truncate text-fg-muted md:text-sm" : "truncate text-sm text-fg-muted"}>
            {view.video ? ct("calls.video") : ct("calls.audio")}
            {where ? ` ${ct("calls.ring.in", { title: where })}` : ""}
          </p>
        </div>
      </div>
      <div className={full ? "flex w-full max-w-sm items-center gap-4 md:contents" : "contents"}>
        <Button type="button" variant="danger" onClick={onDecline} className={full ? "min-h-14 flex-1 rounded-full px-3 text-lg md:min-h-11 md:flex-none md:text-sm" : "min-h-11 rounded-full px-3 md:h-11"}>
          <PhoneOff aria-hidden="true" className={full ? "size-6 md:size-4" : "size-4"} />
          {ct("calls.ring.decline")}
        </Button>
        <Button type="button" onClick={onAnswer} className={full ? "min-h-14 flex-1 rounded-full bg-ok px-4 text-lg font-semibold text-ok-fg hover:bg-ok/90 md:min-h-11 md:flex-none md:text-sm" : "min-h-11 rounded-full bg-ok px-4 font-semibold text-ok-fg hover:bg-ok/90 md:h-11"}>
          <Phone aria-hidden="true" className={full ? "size-6 md:size-4" : "size-4"} />
          {ct("calls.ring.answer")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The incoming call, on every page: somebody rang this person (a DM call, a topic call that «رنّ على الكل», or «ضيف حدا»). The event carries ids only;
 * the card asks the calls API, which answers only somebody who may join, and a call that ended rings nobody. «ردّ» opens the call's page; «رفض» tells
 * the server (a private call ends and the caller hears it) and closes the card; thirty seconds close it too. The card also closes by itself when the
 * call changes under it: it ended, or this person answered it on another device or tab.
 */
export function CallRing() {
  const router = useRouter();
  const pathname = usePathname();
  const [ringing, setRinging] = React.useState<CallView | null>(null);
  const call = useOptionalCall();
  const shown = React.useRef<string | null>(null);
  shown.current = ringing?.id ?? null;

  useRealtime((event) => {
    if (event.kind === "call.changed" && event.callId) {
      const id = event.callId;
      if (shown.current !== id) return;
      // the call this card rings for changed: ended, or answered somewhere else (the card on this device has nothing left to say)
      const close = () => setRinging((r) => (r && r.id === id ? null : r));
      void callApi<CallView>(`/api/calls/${encodeURIComponent(id)}`).then((view) => ringIsOver(view) && close(), close);
      return;
    }
    if (event.kind !== "call.ring" || !event.callId) return;
    if (pathname === `/calls/${event.callId}`) return; // already in it
    void callApi<CallView>(`/api/calls/${encodeURIComponent(event.callId)}`).then(
      (view) => {
        if (!view.endedAt && !view.answered) {
          setRinging(view);
          // warm the connection while it rings, so «ردّ» is instant
          call?.prefetch(view.id);
        }
      },
      () => undefined,
    );
  });

  // another tab of this browser answered or declined this call: its card goes here too, at once
  React.useEffect(() => onRingDone((id) => setRinging((r) => (r && r.id === id ? null : r))), []);

  // ONE tab rings (the others stay silent and take over if it closes): the chosen ringtone and the vibration, for as long as the card is up
  const ringingId = ringing?.id ?? null;
  React.useEffect(() => {
    if (!ringingId) return;
    const stop = setTimeout(() => setRinging(null), RING_FOR_MS);
    const tone = startSharedRing(ringingId, () => {
      const stopSound = startRing();
      const stopShake = startVibration();
      return () => {
        stopSound();
        stopShake();
      };
    });
    return () => {
      clearTimeout(stop);
      tone();
    };
  }, [ringingId]);

  if (!ringing) return null;
  return (
    <CallRingCard
      view={ringing}
      onDecline={() => {
        const id = ringing.id;
        setRinging(null);
        announceRingDone(id);
        // a private call ends for both and the caller hears «رفض المكالمة»; in a topic it is only this card that goes
        void callApi(`/api/calls/${encodeURIComponent(id)}/decline`, {}).catch(() => undefined);
      }}
      onAnswer={() => {
        const id = ringing.id;
        void ensurePush(true);
        setRinging(null);
        announceRingDone(id);
        router.push(`/calls/${encodeURIComponent(id)}`);
      }}
    />
  );
}
