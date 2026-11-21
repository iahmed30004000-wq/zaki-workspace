"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/avatar";
import { ct } from "@/lib/chat/text";
import { foldedIncludes } from "@/lib/search/arabic";

type Person = { userId: string; user: { name: string; jobTitle: string | null; avatarUrl?: string | null } };

const NAME_MIN = 2;
const NAME_MAX = 60;

/**
 * «مجموعة جديدة» (the owner, 2026-11-21: «زر إنشاء المواضيع أو الجروب ما لقيته»): a name and the colleagues who are in it, then one private group chat
 * (`POST /api/chat/conversations` `{ kind: "GROUP" }`, the door that was there already) that opens at once. The people come from the chat directory (the active
 * non-guests, the viewer left out); the server decides again who may be in a group.
 */
export function NewGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || people) return;
    let alive = true;
    fetch("/api/chat/directory", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("directory");
        return r.json() as Promise<{ people: Person[] }>;
      })
      .then((data) => {
        if (alive) setPeople(data.people);
      })
      .catch(() => {
        if (alive) setError(ct("chath.dm.load_failed"));
      });
    return () => {
      alive = false;
    };
  }, [open, people]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const title = name.trim();
  const q = query.trim();
  const shown = (people ?? []).filter((p) => !q || foldedIncludes(p.user.name, q) || foldedIncludes(p.user.jobTitle ?? "", q));
  const ready = title.length >= NAME_MIN && picked.size > 0;

  async function create() {
    if (busy) return;
    if (picked.size === 0) {
      setError(ct("chath.group.needs_people"));
      return;
    }
    if (title.length < NAME_MIN) {
      setError(ct("chath.group.name_hint"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/chat/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "GROUP", title, memberIds: [...picked] }),
      });
      if (!r.ok) throw new Error("group");
      const { id } = (await r.json()) as { id: string };
      onOpenChange(false);
      router.push(`/chat/${encodeURIComponent(id)}`);
    } catch {
      setError(ct("chath.group.failed"));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{ct("chath.group.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <label htmlFor="new-group-name" className="mb-1 block text-sm font-medium">
            {ct("chath.group.name")}
          </label>
          <input
            id="new-group-name"
            type="text"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder={ct("chath.group.name_hint")}
            autoComplete="off"
            className="h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm"
          />
          <p className="mb-1 mt-4 text-sm font-medium">
            {ct("chath.group.people")}
            {picked.size > 0 ? <span className="ms-2 text-fg-muted">{picked.size}</span> : null}
          </p>
          <label htmlFor="new-group-search" className="sr-only">
            {ct("chath.dm.search")}
          </label>
          <input
            id="new-group-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={ct("chath.dm.search_hint")}
            className="h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm"
          />
          {error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          {!people && !error ? (
            <p role="status" className="mt-3 text-sm text-fg-muted">
              {ct("chath.loading")}
            </p>
          ) : null}
          {people && shown.length === 0 ? <p className="mt-3 text-sm text-fg-muted">{ct("chath.dm.none")}</p> : null}
          <ul className="mt-2 max-h-[40vh] divide-y divide-border overflow-y-auto">
            {shown.map((p) => {
              const on = picked.has(p.userId);
              return (
                <li key={p.userId}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(p.userId)}
                    className="flex min-h-12 w-full items-center gap-3 py-2 text-start hover:bg-surface-2"
                  >
                    <Avatar name={p.user.name} src={p.user.avatarUrl} className="size-9 text-xs" />
                    <span className="min-w-0 flex-1 truncate">
                      <bdi>{p.user.name}</bdi>
                      {p.user.jobTitle ? (
                        <small className="block truncate text-fg-muted">
                          <bdi>{p.user.jobTitle}</bdi>
                        </small>
                      ) : null}
                    </span>
                    <span aria-hidden="true" className={`grid size-6 shrink-0 place-items-center rounded-full border ${on ? "border-accent bg-accent text-accent-fg" : "border-border"}`}>
                      {on ? <Check className="size-4" /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => void create()}
            className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-base font-semibold text-accent-fg disabled:opacity-50"
          >
            {ct("chath.group.create")}
          </button>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
