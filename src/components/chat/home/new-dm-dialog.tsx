"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import { foldedIncludes } from "@/lib/search/arabic";
import { Avatar } from "@/components/ui/avatar";
import { AssistantRow } from "@/components/chat/assistant-row";

type Person = { userId: string; user: { name: string; jobTitle: string | null; avatarUrl?: string | null } };

/**
 * «رسالة جديدة»: pick a colleague and land in the DM with them (opened or found by the server).
 * The list is the chat directory (ACTIVE non-guests, the viewer excluded); the server decides again.
 */
export function NewDmDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [assistant, setAssistant] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || people) return;
    let alive = true;
    fetch("/api/chat/directory", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("directory"); return r.json() as Promise<{ people: Person[]; assistant?: boolean }>; })
      .then((data) => { if (alive) { setPeople(data.people); setAssistant(data.assistant === true); } })
      .catch(() => { if (alive) setError(ct("chath.dm.load_failed")); });
    return () => { alive = false; };
  }, [open, people]);
  async function start(userId: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/chat/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "DM", userId }) });
      if (!r.ok) throw new Error("dm");
      const { id } = await r.json() as { id: string };
      router.push(`/chat/${encodeURIComponent(id)}`);
    } catch {
      setError(ct("chath.dm.open_failed"));
      setBusy(false);
    }
  }
  const q = query.trim();
  // spelling-tolerant: «احمد» finds «أحمد» (src/lib/search/arabic.ts)
  const shown = (people ?? []).filter((p) => !q || foldedIncludes(p.user.name, q) || foldedIncludes(p.user.jobTitle ?? "", q));
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="md">
      <DialogHeader><DialogTitle>{ct("chath.dm.title")}</DialogTitle></DialogHeader>
      <DialogBody>
        <label htmlFor="new-dm-search" className="sr-only">{ct("chath.dm.search")}</label>
        <input id="new-dm-search" type="search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder={ct("chath.dm.search_hint")} className="h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm" />
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        {!people && !error && <p role="status" className="mt-3 text-sm text-fg-muted">{ct("chath.loading")}</p>}
        {assistant && (!q || foldedIncludes(ct("assistantChat.row_title"), q)) && <AssistantRow className="mt-3 border-b border-border" onOpened={() => onOpenChange(false)} />}
        {people && !shown.length && <p className="mt-3 text-sm text-fg-muted">{ct("chath.dm.none")}</p>}
        <ul className="mt-3 divide-y divide-border">{shown.map((p) => <li key={p.userId}><button type="button" disabled={busy} onClick={() => void start(p.userId)} className="flex min-h-12 w-full items-center gap-3 py-2 text-start hover:bg-surface-2 disabled:opacity-60">
          <Avatar name={p.user.name} src={p.user.avatarUrl} className="size-9 text-xs" />
          <span className="min-w-0 flex-1 truncate"><bdi>{p.user.name}</bdi>{p.user.jobTitle && <small className="block truncate text-fg-muted"><bdi>{p.user.jobTitle}</bdi></small>}</span>
        </button></li>)}</ul>
      </DialogBody>
    </DialogContent>
  </Dialog>;
}
