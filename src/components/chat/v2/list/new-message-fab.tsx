"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { SquarePen, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useOptionalToast } from "@/components/ui/toast";
import { callApi } from "@/components/calls/call-api";
import { ensurePush } from "@/components/calls/push-client";
import { ct } from "@/lib/chat/text";

/**
 * C2.2 — the phone's pencil, a round button at the bottom END of the list screen (the left corner in this right-to-left layout), above the home
 * indicator. It is the button set's own `fab` (D1: a screen does not invent its own accent button). The computer has the pencil in the list header
 * instead, so this is hidden from `md`.
 *
 * Batch 1 (2026-11-21): for a person who may open meetings (`canMeet`) it opens a small menu — «رسالة جديدة» and «اجتماع جديد» — instead of the full-width
 * meeting strip that used to sit under the folders. «اجتماع جديد» opens a meeting of the person's space at once (the same door as the meeting button of
 * the empty screen: POST /api/calls) and goes into it. Without `canMeet` the pencil is the plain «رسالة جديدة» button it always was.
 */
const FAB_CLASS = "absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] end-4 z-20 md:hidden";

export function NewMessageFab({ onClick, canMeet = false }: { onClick: () => void; canMeet?: boolean }) {
  const router = useRouter();
  const toast = useOptionalToast();
  const [busy, setBusy] = React.useState(false);

  async function newMeeting() {
    void ensurePush(true);
    setBusy(true);
    try {
      const out = await callApi<{ path: string }>("/api/calls", { title: null, video: true });
      router.push(out.path);
    } catch (e) {
      if (toast) toast.toast(e instanceof Error ? e.message : ct("calls.action_failed"), "error");
      setBusy(false);
    }
  }

  if (!canMeet) {
    return (
      <Button type="button" variant="fab" aria-label={ct("chath.new_dm")} data-chat-fab="" onClick={onClick} className={FAB_CLASS}>
        <SquarePen className="size-6" aria-hidden="true" />
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="fab" aria-label={ct("chath.new_dm")} data-chat-fab="" disabled={busy} className={FAB_CLASS}>
          <SquarePen className="size-6" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="z-[60]">
        <DropdownMenuItem onSelect={onClick}>
          <SquarePen aria-hidden="true" className="size-4" /> {ct("chath.new_dm")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void newMeeting()}>
          <Video aria-hidden="true" className="size-4" /> {ct("calls.meeting_new")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
