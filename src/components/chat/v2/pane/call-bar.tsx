"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, PhoneCall } from "lucide-react";
import { callApi } from "@/components/calls/call-api";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ct } from "@/lib/chat/text";
import { latestGuard } from "@/lib/chat/v2/pane/latest";

/**
 * Is a call of this conversation going on right now? Asked of the same door the header's call button asks (`GET /api/chat/conversations/<id>/call`) and
 * asked again whenever the live line says `call.changed` for this conversation. Not asked at all while `enabled` is false (the company's calls switch
 * is off, or the person may not call here).
 */
export function useLiveCall(conversationId: string, enabled: boolean): { id: string } | null {
  const [going, setGoing] = React.useState<{ id: string } | null>(null);
  const path = `/api/chat/conversations/${encodeURIComponent(conversationId)}/call`;
  // a call that ended while the answer for the call that started was still on its way: only the newest answer counts
  const guard = React.useRef(latestGuard());
  const refresh = React.useCallback(() => {
    if (!enabled) return;
    const current = guard.current();
    void callApi<{ call: { id: string } | null }>(path).then(
      (answer) => current() && setGoing(answer.call ? { id: answer.call.id } : null),
      () => current() && setGoing(null),
    );
  }, [path, enabled]);
  React.useEffect(() => {
    setGoing(null);
    refresh();
  }, [refresh]);
  useRealtime((event) => {
    if (event.kind === "call.changed" && event.conversationId === conversationId) refresh();
  });
  return enabled ? going : null;
}

/**
 * «مكالمة جارية · انضم» — the bar under the header while a call of this conversation is live: one press joins it. C2.9 gave it the Telegram call look on the
 * new tokens: a solid `ok` strip (the call is the one live thing on the screen), a phone icon with a quiet pulse, the words, and a chevron at the END that says
 * «go in». It is one component with one prop-free body (`CallBarView`) so the bar's look can be tested without the live line; the logic above it is not touched.
 */
export function CallBarView({ onJoin }: { onJoin: () => void }) {
  return (
    <button
      type="button"
      data-call-bar
      onClick={onJoin}
      className="flex min-h-11 w-full items-center gap-2 bg-ok px-3 py-1 text-start text-sm font-semibold text-ok-fg hover:bg-ok/90 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      <PhoneCall aria-hidden="true" className="size-5 shrink-0 animate-pulse motion-reduce:animate-none" />
      <span className="min-w-0 flex-1 truncate">{ct("chatui.pane.call_bar")}</span>
      <ChevronLeft aria-hidden="true" className="size-5 shrink-0" />
    </button>
  );
}

export function CallBar({ conversationId, enabled }: { conversationId: string; enabled: boolean }) {
  const router = useRouter();
  const going = useLiveCall(conversationId, enabled);
  if (!going) return null;
  return <CallBarView onJoin={() => router.push(`/calls/${encodeURIComponent(going.id)}`)} />;
}
