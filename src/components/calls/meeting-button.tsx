"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ct } from "@/lib/chat/text";
import { callApi } from "./call-api";
import { ensurePush } from "./push-client";

/**
 * «اجتماع جديد»: a call with a link, in the space the person is in. The link opens it for the space's people only,
 * each with their own account (the owner's decision, 2026-10-25); the server checks it on every pass.
 *
 * C2.9 — looks only: the button set's `tonal` button with a lucide icon (44 px), and the form in the primitives (`Input`, `Button` primary and ghost). What it
 * asks and how it creates the call are untouched.
 */
export function MeetingButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    void ensurePush(true);
    setBusy(true);
    setError("");
    try {
      const out = await callApi<{ path: string }>("/api/calls", { title: title.trim() || null, video: true });
      router.push(out.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : ct("calls.action_failed"));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="tonal" onClick={() => setOpen(true)} className="min-h-11 md:h-11">
        <Video aria-hidden="true" className="size-5" />
        {ct("calls.meeting_new")}
      </Button>
    );
  }
  return (
    <form onSubmit={(e) => void create(e)} className="flex w-full flex-col gap-2 rounded-xl border border-border bg-surface-1 p-3">
      <label className="flex flex-col gap-1 text-sm">
        <span>{ct("calls.meeting_title")}</span>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="min-h-11 md:h-11" />
      </label>
      <p className="text-xs text-fg-muted">{ct("calls.meeting_hint")}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="min-h-11 font-semibold md:h-11">
          {ct("calls.meeting_create")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="min-h-11 md:h-11">
          {ct("chatc.cancel")}
        </Button>
      </div>
    </form>
  );
}
