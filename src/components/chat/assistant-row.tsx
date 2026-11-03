"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";

/**
 * «المساعد» as the first name of the people lists (the new-message window and the little chat window). One tap opens (or finds) the person's
 * own conversation with the assistant and goes to it: the assistant answers there without «@». Drawn only when the server says so
 * (`assistant` in the directory's answer: switch on and «@المساعد» offered).
 */
export function AssistantRow({ onOpened, className }: { onOpened?: () => void; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/chat/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!r.ok) throw new Error("assistant");
      const { id } = (await r.json()) as { id: string };
      onOpened?.();
      router.push(`/chat/${encodeURIComponent(id)}`);
    } catch {
      setError(ct("assistantChat.open_failed"));
      setBusy(false);
    }
  }
  return (
    <div className={className} data-testid="assistant-row">
      <button
        type="button"
        disabled={busy}
        onClick={() => void open()}
        className={cn("flex min-h-12 w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:opacity-60")}
      >
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
          <Sparkles className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg">{ct("assistantChat.row_title")}</span>
          <span className="block truncate text-xs text-fg-muted">{ct("assistantChat.row_hint")}</span>
        </span>
      </button>
      {error ? (
        <p role="alert" className="px-3 pb-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
