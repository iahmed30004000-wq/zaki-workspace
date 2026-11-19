"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { apiPatch, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

/** Rename / re-describe the current workspace (ws ADMIN or org admin). */
export function WorkspaceEditButton({
  workspaceId,
  name,
  description,
}: {
  workspaceId: string;
  name: string;
  description: string | null;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextName, setNextName] = useState(name);
  const [nextDesc, setNextDesc] = useState(description ?? "");

  const save = useMutation({
    mutationFn: () => apiPatch(`/api/workspaces/${workspaceId}`, { name: nextName, description: nextDesc || null }),
    onSuccess: () => {
      setOpen(false);
      toast(t("ws.renamed"), "success");
      // the space switcher reads the company's spaces list (client-fetched): ask it again; the page itself is drawn by the
      // server (its title and description), so it is drawn again in place, without leaving the page
      qc.invalidateQueries({ queryKey: ["orgs"] });
      router.refresh();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.messageKey) {
        const x = t(err.messageKey);
        toast(x !== err.messageKey ? x : t("common.error"), "error");
      } else {
        toast(t("common.error"), "error");
      }
    },
  });

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4 text-muted" />
        {t("ws.edit")}
      </Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title={t("ws.editTitle")}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (nextName.trim().length >= 2) save.mutate();
            }}
          >
            <Input value={nextName} onChange={(e) => setNextName(e.target.value)} required minLength={2} maxLength={80} />
            <Textarea value={nextDesc} onChange={(e) => setNextDesc(e.target.value)} rows={2} placeholder={t("ws.descPlaceholder")} />
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={save.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
