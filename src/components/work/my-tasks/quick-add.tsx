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
    <form onSubmit={submit} className="mt-2 flex w-full min-w-0 items-center gap-2 rounded-[10px] bg-surface-2 px-2.5 py-0.5 text-muted" aria-label={t("mytasks.quick.label")}>
      <Plus className="size-4 shrink-0" aria-hidden />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={TASK_TITLE_MAX}
        placeholder={t("mytasks.quick.placeholder")}
        aria-label={t("mytasks.quick.label")}
        className="min-h-10 min-w-0 flex-1 text-ellipsis bg-transparent text-sm text-fg placeholder:text-muted focus-visible:outline-none md:min-h-9"
      />
      <button
        type="submit"
        disabled={pending || title.trim() === ""}
        className="min-h-8 shrink-0 rounded-lg bg-accent/10 px-3 text-[13px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
      >
        {t("mytasks.quick.add")}
      </button>
    </form>
  );
}
