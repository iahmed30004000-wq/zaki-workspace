"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Phone, Video } from "lucide-react";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ct } from "@/lib/chat/text";
import { useOptionalToast } from "@/components/ui/toast";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { callApi } from "./call-api";
import { ensurePush } from "./push-client";

/**
 * «مكالمة» in a conversation's header. While a call is going on here it is «انضم للمكالمة»; otherwise, for
 * whoever may write here, a menu: a voice or a video call, and in a topic «رنّ على الكل» (a DM always rings).
 * The server decides again on every step (src/server/policy/call.ts): this only offers.
 *
 * C2.9 — the look is the new tokens', the behaviour is not touched (the same component serves the old screen, the quick chat, the new header and the info
 * panel): in a header it is a flat 44 px icon (with the word from `sm`) among the other header icons, `outlined` makes it the bordered pill the info panel's
 * buttons are, and while a call is going on it is a green «انضم للمكالمة» pill. Icons are lucide, never emoji.
 */
export function CallButton({ conversationId, isDm, canStart, compact = false, outlined = false }: { conversationId: string; isDm: boolean; canStart: boolean; compact?: boolean; outlined?: boolean }) {
  const router = useRouter();
  const toast = useOptionalToast();
  const [going, setGoing] = React.useState<{ id: string } | null>(null);
  // a topic or a group does not ring everybody unless the person asks for it (a private call always rings)
  const [ring, setRing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const base = `/api/chat/conversations/${encodeURIComponent(conversationId)}/call`;

  const refresh = React.useCallback(() => {
    void callApi<{ call: { id: string } | null }>(base).then((r) => setGoing(r.call), () => setGoing(null));
  }, [base]);
  React.useEffect(refresh, [refresh]);
  useRealtime((event) => {
    if (event.kind === "call.changed" && event.conversationId === conversationId) refresh();
  });

  async function start(video: boolean) {
    // the first call is the moment to agree to be rung when the site is closed (a tap: browsers ask only then)
    void ensurePush(true);
    setBusy(true);
    try {
      const out = await callApi<{ id: string }>(base, { video, ring: isDm || ring });
      router.push(`/calls/${encodeURIComponent(out.id)}`);
    } catch (e) {
      const text = e instanceof Error ? e.message : ct("calls.action_failed");
      if (toast) toast.toast(text, "error");
      setBusy(false);
    }
  }

  // `compact`: a small round icon for a narrow head (the quick chat's window); the same menu and the same rules
  const look = compact
    ? "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm"
    : "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
  if (going && compact) {
    return (
      <button type="button" aria-label={ct("calls.join_going")} title={ct("calls.join_going")} onClick={() => router.push(`/calls/${encodeURIComponent(going.id)}`)} className={`${look} bg-ok/15 text-ok hover:bg-ok/20`}>
        <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-ok motion-reduce:animate-none" />
      </button>
    );
  }
  if (going) {
    return (
      <button type="button" data-call-join="" onClick={() => router.push(`/calls/${encodeURIComponent(going.id)}`)} className={`${look} rounded-full bg-ok px-3 font-semibold text-ok-fg hover:bg-ok/90`}>
        <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-ok-fg motion-reduce:animate-none" />
        {ct("calls.join_going")}
      </button>
    );
  }
  if (!canStart) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={busy} aria-label={ct("calls.menu_label")} title={ct("calls.menu_label")} className={compact ? `${look} text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-60` : `${look} ${outlined ? "border border-border px-4" : ""} text-fg hover:bg-surface-2 disabled:opacity-60`}>
          <Phone aria-hidden="true" className={compact ? "size-4" : "size-5"} />
          {/* a phone keeps the head to one row: the icon alone there */}
          {compact ? null : <span className="hidden sm:inline">{busy ? ct("calls.starting") : ct("calls.button")}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void start(false)}>
          <Phone aria-hidden="true" className="size-4" /> {ct("calls.audio")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void start(true)}>
          <Video aria-hidden="true" className="size-4" /> {ct("calls.video")}
        </DropdownMenuItem>
        {!isDm && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={ring} onCheckedChange={(v) => setRing(v === true)} onSelect={(e) => e.preventDefault()}>
              {ct("calls.ring_all")}
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
