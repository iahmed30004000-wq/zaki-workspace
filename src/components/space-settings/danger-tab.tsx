"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SpaceDeleteButton } from "@/components/space-delete-button";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

export interface DangerTabProps {
  spaceId: string;
  name: string;
  canArchive: boolean;
  canDelete: boolean;
  /** A department's space goes with its department: it says where, and offers no delete of its own. */
  department: boolean;
}

/**
 * «خطر» — archive and delete, as they are today (A2.2 moves the buttons, it changes no rule): the archive is the OWNER's and the ADMINs' (`POST
 * /api/workspaces/[id]/archive`), the delete with all the space's work is the OWNER's alone and asks for the space's name typed (`SpaceDeleteButton`). The tab only
 * draws what the person can really do; the server decides again. ⚠️ A delete cannot be undone. 🔧 The screen says so and offers the archive first, which can be undone.
 * After either one the space is gone from the lists, so the person leaves for «كل المساحات».
 */
export function DangerTab({ spaceId, name, canArchive, canDelete, department }: DangerTabProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  function leave() {
    void qc.invalidateQueries({ queryKey: ["orgs"] });
    router.push("/spaces");
  }

  async function archive() {
    if (busy) return;
    setBusy(true);
    const r = await fetch(`/api/workspaces/${encodeURIComponent(spaceId)}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return toast(t("spaces.archive.failed"), "error");
    toast(t("spaces.archive.done"), "success");
    leave();
  }

  return (
    <div className="space-y-4" data-space-settings-danger>
      <p className="text-sm text-fg-muted">{t("spset.danger.hint")}</p>

      {canArchive ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-4">
          <div className="min-w-[14rem] flex-1">
            <h2 className="text-sm font-semibold text-fg">{t("spset.danger.archive")}</h2>
            <p className="text-xs leading-5 text-fg-muted">{t("spset.danger.archive_hint")}</p>
          </div>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void archive()}>
            {t("spset.danger.archive_do")}
          </Button>
        </section>
      ) : null}

      {canDelete ? (
        <section className="space-y-3 rounded-xl border border-danger/40 bg-surface-1 p-4">
          <div>
            <h2 className="text-sm font-semibold text-danger">{t("spset.danger.delete")}</h2>
            <p className="text-xs leading-5 text-fg-muted">{t("spset.danger.delete_hint")}</p>
          </div>
          <div className="space-y-0.5 text-xs text-fg-muted">
            <p>{t("spset.danger.warn")}</p>
            <p>{t("spset.danger.fix")}</p>
          </div>
          {department ? <p className="text-xs leading-5 text-fg">{t("spset.danger.dept")}</p> : null}
          <SpaceDeleteButton id={spaceId} name={name} labelled onDeleted={leave} />
        </section>
      ) : null}
    </div>
  );
}
