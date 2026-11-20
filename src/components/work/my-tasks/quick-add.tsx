"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { TASK_TITLE_MAX } from "@/lib/today";

/**
 * «مهمة سريعة»: a title is the WHOLE job. Enter adds it to «صندوق المهام» of the space the person is in (the server decides where; in «الشركة» their first
 * space) and the list refreshes. The title stays in the box until the server says yes, so a refusal loses nothing.
 */
export function QuickAdd({ onAdd, pending }: { onAdd: (title: string) => Promise<unknown>; pending: boolean }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = title.trim();
    if (!text || pending) return;
    try {
      await onAdd(text);
      setTitle("");
    } catch {
      // the screen already said why; the text stays
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 border-b border-border px-3 py-2" aria-label={t("mytasks.quick.label")}>
      <Plus className="size-4 shrink-0 text-fg-muted" aria-hidden />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={TASK_TITLE_MAX}
        placeholder={t("mytasks.quick.placeholder")}
        aria-label={t("mytasks.quick.label")}
        className="min-h-9 flex-1 bg-transparent text-sm text-fg placeholder:text-muted focus-visible:outline-none"
      />
      <button
        type="submit"
        disabled={pending || title.trim() === ""}
        className="min-h-9 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-40"
      >
        {t("mytasks.quick.add")}
      </button>
    </form>
  );
}
