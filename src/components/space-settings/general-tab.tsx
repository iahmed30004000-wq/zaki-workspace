"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPatch, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspaceEditButton } from "@/components/workspace-edit-button";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

export interface GeneralTabProps {
  spaceId: string;
  name: string;
  description: string | null;
  emoji: string | null;
  /** STANDARD, CARDS or MANUFACTURING. */
  layout: string;
  /** A department's space takes its name and description from the department. */
  department: boolean;
}

/**
 * «عام» — the space's name, description, emoji and layout. The name and the description are the SAME button and dialog as before (`WorkspaceEditButton`, same props,
 * no page reload); the emoji is written through the same door (`PATCH /api/workspaces/[id]`, `{ emoji }`) and the server checks that it is a picture, not text.
 * The layout is shown, not changed: it is decided when the space is made. A department's space is read-only here and says where it is changed.
 */
export function GeneralTab({ spaceId, name, description, emoji, layout, department }: GeneralTabProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [draft, setDraft] = useState(emoji ?? "");

  const save = useMutation({
    mutationFn: (next: string | null) => apiPatch(`/api/workspaces/${spaceId}`, { emoji: next }),
    onSuccess: (_data, next) => {
      setDraft(next ?? "");
      toast(t("spset.general.emoji_saved"), "success");
      // the switcher lists the spaces with their emoji (client-fetched), the page title is drawn by the server
      void qc.invalidateQueries({ queryKey: ["orgs"] });
      router.refresh();
    },
    onError: (err) => {
      const key = err instanceof ApiError ? err.messageKey : undefined;
      const text = key ? t(key) : "";
      toast(text && text !== key ? text : t("common.error"), "error");
    },
  });

  return (
    <div className="space-y-5" data-space-settings-general>
      <section className="space-y-2 rounded-xl border border-border bg-surface-1 p-4">
        <dl className="space-y-2 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-fg-muted">{t("ws.name")}</dt>
            <dd className="min-w-0 flex-1 truncate font-semibold text-fg">
              <bdi>{name}</bdi>
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-fg-muted">{t("ws.desc")}</dt>
            <dd className="min-w-0 flex-1 text-fg">{description ? <bdi>{description}</bdi> : <span className="text-fg-muted">{t("spset.general.none")}</span>}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-xs text-fg-muted">{t("cards.space_type")}</dt>
            <dd className="min-w-0 flex-1 text-fg">
              {t(`cards.space_type.${layout}`)}
              <span className="block text-xs text-fg-muted">{t("spset.general.layout_hint")}</span>
            </dd>
          </div>
        </dl>
        {department ? (
          <div className="space-y-2 pt-1">
            <p className="text-xs leading-5 text-fg-muted">{t("spset.general.dept")}</p>
            <Link href="/departments" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg">
              {t("spaces.dept.go")}
            </Link>
          </div>
        ) : (
          <div className="flex justify-end pt-1">
            <WorkspaceEditButton workspaceId={spaceId} name={name} description={description} />
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-surface-1 p-4">
        <h2 className="text-sm font-semibold text-fg">{t("spset.general.emoji")}</h2>
        <p className="text-xs text-fg-muted">{t("spset.general.emoji_hint")}</p>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() && !save.isPending) save.mutate(draft.trim());
          }}
        >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={16} aria-label={t("spset.general.emoji")} className="w-24 text-center text-lg" />
          <Button type="submit" size="sm" disabled={save.isPending || !draft.trim() || draft.trim() === (emoji ?? "")}>
            {t("spset.general.emoji_save")}
          </Button>
          {emoji ? (
            <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate(null)}>
              {t("spset.general.emoji_clear")}
            </Button>
          ) : null}
        </form>
      </section>
    </div>
  );
}
