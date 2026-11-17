"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HomeDto } from "@/server/chat/dto";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ChatHome } from "./chat-home";
import { ct } from "@/lib/chat/text";
import { debounced } from "@/lib/chat/debounce";
import { MeetingButton } from "@/components/calls/meeting-button";

/**
 * The chat list, kept live. The loading skeleton shows only until the FIRST answer: a live refetch
 * (every new message anywhere) keeps the list in place instead of pushing it down, and the empty
 * «لسا ما عندك مساحات» is never shown for a list that has not arrived yet (review D9).
 */
export function ChatHomeClient({ guest, canMeet = !guest }: { guest: boolean; canMeet?: boolean }) {
  const [home, setHome] = useState<HomeDto>({ spaces: [], dms: [], canOversee: false });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  // a burst of events (a busy minute anywhere in the company) is ONE refetch, 300 ms after the last (F0.6)
  const refreshSoon = useMemo(() => debounced(refresh, 300), [refresh]);
  useEffect(() => () => refreshSoon.cancel(), [refreshSoon]);
  useRealtime((event) => { if (!event.conversationId || event.kind === "conversation.changed" || event.kind.startsWith("message.") || event.kind === "membership.changed") refreshSoon.call(); });
  useEffect(() => {
    let alive = true;
    // a newer request aborts the one still in flight, so a slow old answer can never overwrite a newer one
    const request = new AbortController();
    fetch("/api/chat/home", { cache: "no-store", signal: request.signal }).then(async (response) => {
      if (!response.ok) throw new Error("home");
      return response.json() as Promise<HomeDto>;
    }).then((data) => { if (alive) { setHome(data); setError(false); setLoaded(true); } }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; request.abort(); };
  }, [reload]);
  return <div className="min-h-full">{canMeet && <div className="mx-4 mt-4 flex justify-end"><MeetingButton /></div>}{!loaded && !error && <div role="status" aria-label={ct("chath.loading")} className="mx-4 mt-4 space-y-3"><div className="h-16 animate-pulse rounded-xl bg-surface-2"/><div className="h-28 animate-pulse rounded-xl bg-surface-2"/></div>}{error && <div role="alert" className="mx-4 mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">{ct("chath.load_failed")} <button type="button" onClick={refresh} className="min-h-11 underline">{ct("chath.retry")}</button></div>}{loaded && <ChatHome home={home} guest={guest} onChanged={refresh}/>}</div>;
}
