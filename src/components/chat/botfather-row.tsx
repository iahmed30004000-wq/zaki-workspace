"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";

/**
 * «بوت فاذر» as a name of the new-message list: one tap opens (or finds) the person's own chat with the bot maker and goes to it. Drawn only when the server says so
 * (`botFather` in the directory's answer: the owner or an admin, the switch on).
 */
export function BotFatherRow({ onOpened, className }: { onOpened?: () => void; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/chat/botfather", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!r.ok) throw new Error("botfather");
      const { id } = (await r.json()) as { id: string };
      onOpened?.();
      router.push(`/chat/${encodeURIComponent(id)}`);
    } catch {
      setError(ct("botfather.err_failed"));
      setBusy(false);
    }
  }
  return (
    <div className={className} data-testid="botfather-row">
      <button
        type="button"
        disabled={busy}
        onClick={() => void open()}
        className={cn("flex min-h-12 w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:opacity-60")}
      >
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
          <Bot className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg">{ct("botfather.label")}</span>
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
