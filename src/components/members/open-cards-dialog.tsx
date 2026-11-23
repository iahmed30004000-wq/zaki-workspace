"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";

interface OpenCard {
  id: string;
  number: number;
  title: string;
  workspaceName: string;
  columnName: string;
}
interface BulkResult {
  moved: string[];
  requested: string[];
  skipped: Array<{ id: string; reason: string }>;
}
interface DirectoryPerson {
  userId: string;
  user: { id: string; name: string };
}

/**
 * «مهامه المفتوحة»: the open cards of a person who left (or is leaving), listed, with ONE action: unassign them all, or hand them all to somebody. It is the screen of
 * `GET/POST /api/tasks/bulk-assign`: the server decides which cards the person asking may arrange, and each card goes through the route of the task itself (the rank rule
 * included), so a card that cannot move is named in the answer, not lost. `workspaceId` narrows it to the space the person was just removed from; `silentWhenEmpty` closes the
 * dialog without a word when there is nothing to arrange (right after a removal).
 */
export function OpenCardsDialog({
  person,
  workspaceId,
  silentWhenEmpty = false,
  onClose,
}: {
  person: { id: string; name: string };
  workspaceId?: string;
  silentWhenEmpty?: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);

  const query = workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : "";
  const cards = useQuery({
    queryKey: ["bulk-open-cards", person.id, workspaceId ?? ""],
    queryFn: () => apiGet<{ count: number; tasks: OpenCard[] }>(`/api/tasks/bulk-assign?from=${encodeURIComponent(person.id)}${query}`),
    retry: false,
  });
  const directory = useQuery({ queryKey: ["ws-directory"], queryFn: () => apiGet<{ people: DirectoryPerson[] }>("/api/chat/directory"), enabled: cards.isSuccess && cards.data.count > 0 });

  const empty = cards.isSuccess && cards.data.count === 0;
  useEffect(() => {
    if (empty && silentWhenEmpty) onClose();
  }, [empty, silentWhenEmpty, onClose]);

  const apply = useMutation({
    mutationFn: (to: string | null) => apiPost<BulkResult>("/api/tasks/bulk-assign", { from: person.id, to, ...(workspaceId ? { workspaceId } : {}) }),
    onSuccess: (out) => {
      setResult(out);
      void qc.invalidateQueries({ queryKey: ["bulk-open-cards"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err) => {
      const key = err instanceof ApiError ? err.messageKey : undefined;
      const shown = key ? t(key) : "";
      toast(shown && shown !== key ? shown : t("common.error"), "error");
    },
  });

  const people = (directory.data?.people ?? []).filter((p) => p.userId !== person.id);
  if (empty && silentWhenEmpty) return null;

  return (
    <Modal open title={t("bulk.title", { name: person.name })} onClose={onClose}>
      <div className="space-y-3" data-bulk-assign="">
        {cards.isLoading ? <p className="text-sm text-fg-muted">…</p> : null}
        {cards.isError ? (
          <p role="alert" className="text-sm text-danger">
            {t("common.error")}
          </p>
        ) : null}
        {empty && !result ? <p className="text-sm text-fg-muted">{t("bulk.none", { name: person.name })}</p> : null}

        {result ? (
          <div role="status" className="space-y-1 text-sm" data-bulk-result="">
            <p className="font-medium text-fg">{t("bulk.done", { moved: result.moved.length, requested: result.requested.length, skipped: result.skipped.length })}</p>
            {result.requested.length ? <p className="text-fg-muted">{t("bulk.requested_note")}</p> : null}
            {result.skipped.length ? <p className="text-fg-muted">{t("bulk.skipped_note")}</p> : null}
          </div>
        ) : cards.isSuccess && cards.data.count > 0 ? (
          <>
            <p className="text-sm font-medium text-fg">{t("bulk.count", { n: cards.data.count })}</p>
            <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border" data-bulk-list="">
              {cards.data.tasks.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-fg">
                    <bdi>{c.title}</bdi>
                  </span>
                  <span className="shrink-0 text-xs text-fg-muted">
                    <bdi>{c.workspaceName}</bdi>
                  </span>
                </li>
              ))}
            </ul>
            <label className="block text-xs font-medium text-fg-muted" htmlFor="bulk-target">
              {t("bulk.pick")}
            </label>
            <Select id="bulk-target" value={target} onChange={(e) => setTarget(e.target.value)} disabled={apply.isPending}>
              <option value="">{t("bulk.pick_none")}</option>
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.user.name}
                </option>
              ))}
            </Select>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={apply.isPending}>
                {t("bulk.later")}
              </Button>
              <Button type="button" onClick={() => apply.mutate(target || null)} disabled={apply.isPending} data-bulk-apply="">
                {target ? t("bulk.apply_move") : t("bulk.apply_unassign")}
              </Button>
            </div>
          </>
        ) : null}
        {result ? (
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              {t("bulk.close")}
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
