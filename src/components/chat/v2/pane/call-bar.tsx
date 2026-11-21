"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, PhoneCall } from "lucide-react";
import { callApi } from "@/components/calls/call-api";
import { useOptionalCall } from "@/components/calls/call-provider";
import { Avatar } from "@/components/ui/avatar";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ct } from "@/lib/chat/text";
import { arabicPlural, fmtNumber } from "@/lib/format";
import { insideCall } from "@/lib/calls/session";
import { latestGuard } from "@/lib/chat/v2/pane/latest";

/** The call going on in a conversation, as `GET /api/chat/conversations/<id>/call` tells it (src/server/calls/calls.ts `ActiveCall`). */
export interface LiveCall {
  id: string;
  /** how many are in the room now */
  count: number;
  /** up to three of them, for the faces */
  people: { userId: string; name: string; avatarUrl?: string | null }[];
}

/**
 * Is a call of this conversation going on right now? Asked of the same door the header's call button asks (`GET /api/chat/conversations/<id>/call`) and
 * asked again whenever the live line says `call.changed` for this conversation. Not asked at all while `enabled` is false (the company's calls switch
 * is off, or the person may not call here).
 */
export function useLiveCall(conversationId: string, enabled: boolean): LiveCall | null {
  const [going, setGoing] = React.useState<LiveCall | null>(null);
  const path = `/api/chat/conversations/${encodeURIComponent(conversationId)}/call`;
  // a call that ended while the answer for the call that started was still on its way: only the newest answer counts
  const guard = React.useRef(latestGuard());
  const refresh = React.useCallback(() => {
    if (!enabled) return;
    const current = guard.current();
    void callApi<{ call: LiveCall | null }>(path).then(
      (answer) => current() && setGoing(answer.call ? { id: answer.call.id, count: answer.call.count ?? 0, people: answer.call.people ?? [] } : null),
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
  // people come and go without a `call.changed`: the faces and the count are looked at again now and then while the bar is up
  const live = !!going;
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [live, refresh]);
  return enabled ? going : null;
}

/** «٣ بالمكالمة»: the people in the call, in the Arabic number form (واحد / اتنين / n). */
function countWords(n: number): string {
  return ct(`calls.count.${arabicPlural(n)}`, { n: fmtNumber(n) });
}

/**
 * «مكالمة جارية · انضم» — the bar under the header while a call of this conversation is live, in the manner of Telegram's video chat bar: a solid `ok`
 * strip (the call is the one live thing on the screen), a phone icon with a quiet pulse, the faces of up to three people already in and how many are in,
 * and a chevron at the END that says «go in». It is ONE button; one press joins. One component with a prop-only body (`CallBarView`) so its look can be
 * tested without the live line. It is for people who are NOT in the call (`CallBar` hides it for the person inside).
 */
export function CallBarView({ onJoin, people = [], count = 0 }: { onJoin: () => void; people?: LiveCall["people"]; count?: number }) {
  const faces = people.slice(0, 3);
  return (
    <button
      type="button"
      data-call-bar
      onClick={onJoin}
      className="flex min-h-11 w-full items-center gap-2 bg-ok px-3 py-1 text-start text-sm font-semibold text-ok-fg hover:bg-ok/90 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      <PhoneCall aria-hidden="true" className="size-5 shrink-0 animate-pulse motion-reduce:animate-none" />
      <span className="min-w-0 flex-1 truncate">{ct("chatui.pane.call_bar")}</span>
      {faces.length > 0 && (
        <span className="flex shrink-0 items-center" aria-hidden="true">
          {faces.map((p, i) => (
            <span key={p.userId} data-call-face="" className={i === 0 ? "" : "-ms-2"}>
              <Avatar name={p.name} src={p.avatarUrl} className="size-7 ring-2 ring-ok" />
            </span>
          ))}
        </span>
      )}
      {count > 0 && <span className="shrink-0 text-xs font-medium">{countWords(count)}</span>}
      <ChevronLeft aria-hidden="true" className="size-5 shrink-0" />
    </button>
  );
}

export function CallBar({ conversationId, enabled }: { conversationId: string; enabled: boolean }) {
  const router = useRouter();
  const going = useLiveCall(conversationId, enabled);
  const call = useOptionalCall();
  if (!going) return null;
  // the person already in this call (here or in its small window) has the call's own controls: the bar is for the others
  if (call && insideCall(going.id, call.state)) return null;
  return <CallBarView onJoin={() => router.push(`/calls/${encodeURIComponent(going.id)}`)} people={going.people} count={going.count} />;
}
