"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KnowledgeSettingsDTO } from "@/server/services/knowledge";

/**
 * The owner's settings of «المنتجات» (Q1.1): which space holds the sheets, who writes them besides the space's managers, who approves besides
 * the owner (the D-Q4 default: the supervisors he names), and the one sentence of delivery that the offer message uses.
 */
export function KnowledgeSettingsCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["knowledge-settings"], queryFn: () => apiGet<KnowledgeSettingsDTO>("/api/knowledge/settings") });
  const data = state.data;
  const [spaceId, setSpaceId] = useState("");
  const [editors, setEditors] = useState<string[]>([]);
  const [approvers, setApprovers] = useState<string[]>([]);
  const [line, setLine] = useState("");

  useEffect(() => {
    if (!data) return;
    setSpaceId(data.spaceId ?? "");
    setEditors(data.editorIds);
    setApprovers(data.approverIds);
    setLine(data.deliveryLine);
  }, [data]);

  const save = useMutation({
    mutationFn: () => apiPut("/api/knowledge/settings", { spaceId: spaceId || null, editorIds: editors, approverIds: approvers, deliveryLine: line }),
    onSuccess: () => {
      toast(t("knowledge.settings_saved"), "success");
      void qc.invalidateQueries({ queryKey: ["knowledge-settings"] });
    },
    onError: (err) => {
      const first = err instanceof ApiError && Array.isArray(err.details) ? (err.details[0] as { message?: unknown } | undefined) : undefined;
      toast(first && typeof first.message === "string" ? t(first.message) : t("common.error"), "error");
    },
  });

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  if (!data) return null;
  return (
    <form
      className="space-y-4 rounded-[14px] bg-surface-1 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      <h2 className="text-sm font-semibold">{t("knowledge.settings")}</h2>
      <label className="block space-y-1 text-xs">
        <span className="text-muted">{t("knowledge.s.space")}</span>
        <select className="w-full rounded-md border border-border bg-surface-1 p-2 text-sm" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
          <option value="">{t("knowledge.s.space_none")}</option>
          {data.spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="block text-muted">{t("knowledge.s.space_hint")}</span>
      </label>
      <fieldset className="space-y-1 text-xs">
        <legend className="text-muted">{t("knowledge.s.editors")}</legend>
        <div className="flex flex-wrap gap-3">
          {data.people.map((p) => (
            <label key={p.id} className="flex items-center gap-1">
              <input type="checkbox" checked={editors.includes(p.id)} onChange={() => toggle(editors, setEditors, p.id)} />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-1 text-xs">
        <legend className="text-muted">{t("knowledge.s.approvers")}</legend>
        <div className="flex flex-wrap gap-3">
          {data.people.map((p) => (
            <label key={p.id} className="flex items-center gap-1">
              <input type="checkbox" checked={approvers.includes(p.id)} onChange={() => toggle(approvers, setApprovers, p.id)} />
              {p.name}
            </label>
          ))}
        </div>
        <span className="block text-muted">{t("knowledge.s.approvers_hint")}</span>
      </fieldset>
      <label className="block space-y-1 text-xs">
        <span className="text-muted">{t("knowledge.s.delivery")}</span>
        <Input value={line} onChange={(e) => setLine(e.target.value)} maxLength={120} />
      </label>
      <Button type="submit" size="sm" disabled={save.isPending}>
        {t("knowledge.save")}
      </Button>
    </form>
  );
}
