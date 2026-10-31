"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ApiError, apiPost } from "@/lib/api-client";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { LIMITS } from "@/lib/docs/markup";
import type { DocItem, DocListItem } from "@/lib/docs/shared";

/** The reason a request was refused, as the sentence the person reads. */
export function docErrorText(t: (key: string) => string, err: unknown): string {
  if (err instanceof ApiError) {
    const key = err.messageKey ?? err.code;
    const text = t(key);
    if (text !== key) return text;
    const issues = Array.isArray(err.details) ? (err.details as Array<{ message?: string }>) : [];
    for (const issue of issues) {
      const hit = issue.message ? t(issue.message) : "";
      if (hit && hit !== issue.message) return hit;
    }
  }
  return t("common.error");
}

/**
 * «المستندات» — the list of a space's documents, and the box that starts a new one. The server decided what this person
 * may read (an external partner is handed only the shared ones) and whether they may create; this draws it.
 */
export function DocumentsView({ spaceId, spaceName, initial, canCreate }: { spaceId: string; spaceName: string; initial: DocListItem[]; canCreate: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy || title.trim().length === 0) return;
    setBusy(true);
    try {
      const res = await apiPost<{ document: DocItem }>("/api/documents", { spaceId, title: title.trim() });
      router.push(`/documents/${res.document.id}`);
    } catch (err) {
      toast(docErrorText(t, err), "error");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <header>
        <h1 className="text-lg font-semibold">{t("docs.title")}</h1>
        <p className="text-xs text-fg-muted">{t("docs.subtitle", { space: spaceName })}</p>
      </header>

      {canCreate && (
        <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-1 p-3">
          <label className="min-w-0 flex-1 text-xs text-fg-muted">
            {t("docs.new_title_label")}
            <Input value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} placeholder={t("docs.new_title_ph")} className="mt-1" />
          </label>
          <Button type="submit" disabled={busy || title.trim().length === 0}>
            <Plus className="size-4" />
            {t("docs.new")}
          </Button>
        </form>
      )}

      {initial.length === 0 ? (
        <EmptyState title={canCreate ? t("docs.empty") : t("docs.empty_partner")} {...(canCreate ? { hint: t("docs.empty_hint") } : {})} />
      ) : (
        <ul className="grid gap-2">
          {initial.map((d) => (
            <li key={d.id}>
              <Link href={`/documents/${d.id}`} className="flex items-start gap-3 rounded-xl border border-border bg-surface-1 p-3 transition-colors hover:bg-surface-2">
                <FileText className="mt-0.5 size-5 shrink-0 text-info" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-fg">{d.title}</span>
                    {d.sharedWithPartners && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-xs text-info">
                        <Users className="size-3" />
                        {t("docs.badge_shared")}
                      </span>
                    )}
                  </span>
                  {d.excerpt && <span className="mt-0.5 block truncate text-xs text-fg-muted">{d.excerpt}</span>}
                  <span className="mt-1 block text-xs text-fg-muted">
                    {t("docs.updated", { when: fmtAgo(d.updatedAt) })}
                    {d.authorName ? ` · ${t("docs.by", { who: d.authorName })}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
