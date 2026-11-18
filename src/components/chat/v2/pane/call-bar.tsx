"use client";

import React from "react";
import { useRouter } from "next/navigation";
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
 * «مكالمة جارية · انضم» — the bar under the header while a call of this conversation is live: one press joins it. Functional, theme tokens only; C2.9
 * restyles it (and the ring) to the Telegram call look, so it is a plain bar on purpose. It is one component with one prop-free body (`CallBarView`) so the
 * bar's look can be tested without the live line.
 */
export function CallBarView({ onJoin }: { onJoin: () => void }) {
  return (
    <button
      type="button"
      data-call-bar
      onClick={onJoin}
      className="flex min-h-11 w-full items-center gap-2 border-b border-ok/40 bg-ok/10 px-3 py-1 text-start text-sm font-semibold text-ok hover:bg-ok/15"
    >
      <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-ok motion-reduce:animate-none" />
      <span className="min-w-0 flex-1 truncate">{ct("chatui.pane.call_bar")}</span>
    </button>
  );
}

export function CallBar({ conversationId, enabled }: { conversationId: string; enabled: boolean }) {
  const router = useRouter();
  const going = useLiveCall(conversationId, enabled);
  if (!going) return null;
  return <CallBarView onJoin={() => router.push(`/calls/${encodeURIComponent(going.id)}`)} />;
}
