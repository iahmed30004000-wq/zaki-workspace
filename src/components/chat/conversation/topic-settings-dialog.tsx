"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConversationDto } from "@/server/chat/dto";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import { Avatar } from "@/components/ui/avatar";
import { visibleToLine } from "@/lib/chat/privacy";

type TopicType = NonNullable<ConversationDto["topicType"]>;
type Audience = "space" | "section" | "people";
type Person = { id: string; name: string; avatarUrl?: string | null };

const TYPES: { value: TopicType; emoji: string }[] = [
  { value: "DISCUSSION", emoji: "💬" },
  { value: "ANNOUNCEMENTS", emoji: "📢" },
  { value: "TASKS", emoji: "✅" },
  { value: "IDEAS", emoji: "💡" },
  { value: "FOLLOWUP", emoji: "🔁" },
];

const audienceOf = (topic: ConversationDto): Audience => (topic.restricted ? "people" : topic.teamId ? "section" : "space");

/**
 * «إعدادات الموضوع» (the owner's ask, 2026-10-25: every topic has its own privacy — who sees and reads it, who
 * writes): its name and kind; who sees and reads it (the whole space, one «مقطع» of it, or named people of the
 * space); who writes (everybody who reads it, or the space's admins only). Under it the topic's management: close
 * or reopen it, pin it on top, archive it (or bring it back), delete it (only one nobody wrote in). For the space's
 * ADMIN and the OWNER; the server decides again (src/server/chat/topics.ts).
 */
export function TopicSettingsDialog({
  open,
  onOpenChange,
  topic,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: ConversationDto;
  onSaved: () => void;
}) {
  const router = useRouter();
  const spaceId = topic.space?.id ?? "";
  const [title, setTitle] = useState(topic.title);
  const [type, setType] = useState<TopicType>(topic.topicType ?? "DISCUSSION");
  const [audience, setAudience] = useState<Audience>(audienceOf(topic));
  const [sectionId, setSectionId] = useState(topic.teamId ?? "");
  const [writers, setWriters] = useState<"ALL" | "ADMINS">(topic.postingPolicy === "ADMINS" ? "ADMINS" : "ALL");
  const [sections, setSections] = useState<Person[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set((topic.members ?? []).map((m) => m.id)));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // every time it opens: what the topic says now
  useEffect(() => {
    if (!open) return;
    setTitle(topic.title);
    setType(topic.topicType ?? "DISCUSSION");
    setAudience(audienceOf(topic));
    setSectionId(topic.teamId ?? "");
    setWriters(topic.postingPolicy === "ADMINS" ? "ADMINS" : "ALL");
    setPicked(new Set((topic.members ?? []).map((m) => m.id)));
    setError("");
    setConfirmDelete(false);
  }, [open, topic]);

  // the space's «مقاطع» and people, once
  useEffect(() => {
    if (!open || !spaceId) return;
    let alive = true;
    if (!sections)
      fetch(`/api/workspaces/${encodeURIComponent(spaceId)}/teams`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ teams: Person[] }>) : { teams: [] }))
        .then((data) => { if (alive) setSections(data.teams.map((t) => ({ id: t.id, name: t.name }))); })
        .catch(() => { if (alive) setSections([]); });
    if (!people)
      fetch(`/api/workspaces/${encodeURIComponent(spaceId)}/members`, { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("members"); return r.json() as Promise<{ members: Person[] }>; })
        .then((data) => { if (alive) setPeople(data.members); })
        .catch(() => { if (alive) setError(ct("chath.topic.people_failed")); });
    return () => { alive = false; };
  }, [open, spaceId, sections, people]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !title.trim()) return;
    if (audience === "section" && !sectionId) return setError(ct("chatc.topic.pick_section"));
    if (audience === "people" && picked.size === 0) return setError(ct("chath.topic.pick_people"));
    setBusy(true);
    setError("");
    try {
      const body = {
        title: title.trim(),
        topicType: type,
        postingPolicy: writers,
        teamId: audience === "section" ? sectionId : null,
        restricted: audience === "people",
        ...(audience === "people" ? { memberIds: [...picked] } : {}),
      };
      const r = await fetch(`/api/chat/topics/${encodeURIComponent(topic.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("settings");
      onSaved();
      onOpenChange(false);
    } catch {
      setError(ct("chatc.topic.save_failed"));
    } finally {
      setBusy(false);
    }
  }

  /** One management step (close, pin, archive — or delete): the server decides again and says why not. */
  async function act(change: { closed?: boolean; pinned?: boolean; archived?: boolean } | "delete") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const url = `/api/chat/topics/${encodeURIComponent(topic.id)}`;
      const r =
        change === "delete"
          ? await fetch(url, { method: "DELETE" })
          : await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { message?: string };
        if (data.message === "chat.topic_has_messages") return setError(ct("chatc.topic.has_messages"));
        if (data.message === "chat.topic_system") return setError(ct("chatc.topic.system"));
        throw new Error("act");
      }
      if (change === "delete") {
        // the topic is gone: back to the chat
        router.push("/chat");
        return;
      }
      onSaved();
      onOpenChange(false);
    } catch {
      setError(ct("chatc.topic.act_failed"));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  // «رح يشوفه: …»: who will read the topic once it is saved as it stands on the screen (P0.4)
  const pickedNames = (people ?? (topic.members ?? []).map((m) => ({ id: m.id, name: m.name }))).filter((p) => picked.has(p.id)).map((p) => p.name);
  const sectionName = (sections ?? []).find((s) => s.id === sectionId)?.name;
  const visibleTo =
    audience === "people"
      ? visibleToLine({ audience: "people", names: pickedNames })
      : audience === "section"
        ? sectionName
          ? visibleToLine({ audience: "section", sectionName })
          : null
        : visibleToLine({ audience: "space", spaceName: topic.space?.name ?? "" });

  const field = "h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm";
  const manage = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-surface-2 disabled:opacity-60";
  const choice = "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{ct("chatc.topic.settings")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={(e) => void save(e)} className="space-y-4">
            <div>
              <label htmlFor="topic-settings-name" className="mb-1 block text-sm font-medium">{ct("chath.topic.name")}</label>
              <input id="topic-settings-name" required maxLength={120} value={title} onChange={(e) => setTitle(e.currentTarget.value)} className={field} />
            </div>

            <fieldset>
              <legend className="mb-1 text-sm font-medium">{ct("chath.topic.kind")}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TYPES.map((k) => (
                  <label key={k.value} className={choice}>
                    <input type="radio" name="topic-settings-type" checked={type === k.value} onChange={() => setType(k.value)} className="sr-only" />
                    <span aria-hidden="true">{k.emoji}</span>
                    {ct(`chath.topic.type.${k.value}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-1 text-sm font-medium">{ct("chatc.topic.who_reads")}</legend>
              <div className="space-y-2">
                <label className={choice}>
                  <input type="radio" name="topic-settings-audience" checked={audience === "space"} onChange={() => setAudience("space")} className="sr-only" />
                  {ct("chath.topic.for.space")}
                </label>
                {(sections?.length ?? 0) > 0 && (
                  <label className={choice}>
                    <input type="radio" name="topic-settings-audience" checked={audience === "section"} onChange={() => setAudience("section")} className="sr-only" />
                    {ct("chath.topic.for.section")}
                  </label>
                )}
                <label className={choice}>
                  <input type="radio" name="topic-settings-audience" checked={audience === "people"} onChange={() => setAudience("people")} className="sr-only" />
                  <span aria-hidden="true">🔒</span>
                  {ct("chath.topic.for.people")}
                </label>
              </div>
              <p className="mt-1 text-xs text-fg-muted">{ct(`chatc.topic.who_reads_hint.${audience}`)}</p>
            </fieldset>

            {audience === "section" && (
              <div>
                <label htmlFor="topic-settings-section" className="mb-1 block text-sm font-medium">{ct("chath.topic.section")}</label>
                <select id="topic-settings-section" value={sectionId} onChange={(e) => setSectionId(e.currentTarget.value)} className={field}>
                  <option value="">—</option>
                  {(sections ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            {audience === "people" && (
              <div>
                <p className="mb-1 text-sm font-medium">{ct("chath.topic.people")}</p>
                {!people && !error && <p role="status" className="text-sm text-fg-muted">{ct("chath.loading")}</p>}
                <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {(people ?? []).map((p) => (
                    <li key={p.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3">
                        <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} className="size-4" />
                        <Avatar name={p.name} src={p.avatarUrl} className="size-7 text-xs" />
                        <bdi className="min-w-0 flex-1 truncate">{p.name}</bdi>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {visibleTo && (
              <p data-visible-to role="status" className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
                {visibleTo}
              </p>
            )}

            <fieldset>
              <legend className="mb-1 text-sm font-medium">{ct("chatc.topic.who_writes")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={choice}>
                  <input type="radio" name="topic-settings-writers" checked={writers === "ALL"} onChange={() => setWriters("ALL")} className="sr-only" />
                  {ct("chatc.topic.writers.all")}
                </label>
                <label className={choice}>
                  <input type="radio" name="topic-settings-writers" checked={writers === "ADMINS"} onChange={() => setWriters("ADMINS")} className="sr-only" />
                  {ct("chatc.topic.writers.admins")}
                </label>
              </div>
            </fieldset>

            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy || !title.trim()} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg disabled:opacity-60">
              {ct("chatc.topic.save")}
            </button>
          </form>

          <section aria-labelledby="topic-manage" className="mt-6 space-y-2 border-t border-border pt-4">
            <h3 id="topic-manage" className="text-sm font-medium">{ct("chatc.topic.manage")}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {!topic.archived && (
                <button type="button" disabled={busy} onClick={() => void act({ closed: !topic.closed })} className={manage}>
                  <span aria-hidden="true">{topic.closed ? "🔓" : "🔐"}</span>
                  {ct(topic.closed ? "chatc.topic.reopen" : "chatc.topic.close")}
                </button>
              )}
              {!topic.archived && (
                <button type="button" disabled={busy} onClick={() => void act({ pinned: !topic.pinned })} className={manage}>
                  <span aria-hidden="true">📌</span>
                  {ct(topic.pinned ? "chatc.topic.unpin" : "chatc.topic.pin")}
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => void act({ archived: !topic.archived })} className={manage}>
                <span aria-hidden="true">🗄</span>
                {ct(topic.archived ? "chatc.topic.unarchive" : "chatc.topic.archive")}
              </button>
              {confirmDelete ? (
                <button type="button" disabled={busy} onClick={() => void act("delete")} className={`${manage} border-danger bg-danger/10 text-danger`}>
                  {ct("chatc.topic.delete_confirm")}
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)} className={`${manage} text-danger`}>
                  <span aria-hidden="true">🗑</span>
                  {ct("chatc.topic.delete")}
                </button>
              )}
            </div>
            <p className="text-xs text-fg-muted">{ct("chatc.topic.archive_hint")} {ct("chatc.topic.delete_hint")}</p>
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
