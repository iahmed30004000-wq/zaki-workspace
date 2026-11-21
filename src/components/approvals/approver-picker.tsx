"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ROLE_KEYS } from "@/lib/i18n/roles";
import { APPROVAL_LIMITS } from "@/lib/approvals/shared";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export interface Candidate {
  id: string;
  name: string;
  role: string;
}

/**
 * «المعتمدون»: one approver or a chain of up to three, IN ORDER. The people offered are the ones who work in the space (the server
 * checks again); the person who asks is never in the list. Each one chosen can be moved up or down or taken out.
 */
export function ApproverPicker({ people, value, onChange, idPrefix }: { people: Candidate[]; value: string[]; onChange: (next: string[]) => void; idPrefix: string }) {
  const { t } = useI18n();
  const [pick, setPick] = useState("");
  const byId = new Map(people.map((p) => [p.id, p] as const));
  const free = people.filter((p) => !value.includes(p.id));
  const full = value.length >= APPROVAL_LIMITS.approvers;

  const move = (i: number, by: -1 | 1) => {
    const next = [...value];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="space-y-2" data-approver-picker>
      {value.length === 0 ? <p className="text-xs text-fg-muted">{t("approvals.picker.none")}</p> : null}
      <ol className="space-y-1">
        {value.map((id, i) => {
          const person = byId.get(id);
          return (
            <li key={id} data-approver={id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-semibold text-fg">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-fg">
                {person?.name ?? id}
                {person ? <span className="ms-1 text-xs text-fg-muted">{t(ROLE_KEYS[person.role] ?? "role.member")}</span> : null}
              </span>
              <Button type="button" variant="ghost" size="icon" aria-label={t("approvals.picker.up")} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t("approvals.picker.down")} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t("approvals.picker.remove")} onClick={() => onChange(value.filter((v) => v !== id))}>
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ol>
      {full ? (
        <p className="text-xs text-fg-muted">{t("approvals.picker.full")}</p>
      ) : free.length === 0 ? (
        <p className="text-xs text-fg-muted">{t("approvals.picker.nobody_left")}</p>
      ) : (
        <div className="flex items-center gap-2">
          <Select id={`${idPrefix}-pick`} className="min-w-0 flex-1" aria-label={t("approvals.picker.choose")} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{t("approvals.picker.choose")}</option>
            {free.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {t(ROLE_KEYS[p.role] ?? "role.member")}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!pick}
            onClick={() => {
              if (!pick) return;
              onChange([...value, pick]);
              setPick("");
            }}
          >
            {t("common.add")}
          </Button>
        </div>
      )}
      <p className="text-xs text-fg-muted">{t("approvals.picker.order_hint")}</p>
    </div>
  );
}
