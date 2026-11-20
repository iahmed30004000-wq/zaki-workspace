"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SystemTokensAnswer } from "@/server/services/system-tokens";

const EXPIRY = ["90", "30", "365", "never"] as const;

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * «الإعدادات ← توكنات الأنظمة» (W1, src/server/services/system-tokens.ts): the OWNER picks a system («الميديا باير»), its space and an expiry (90 days
 * preselected); the scopes are the system's own and are only shown. The whole token appears once, right after it is made; the table shows the
 * last use and revokes in one click.
 */
export function SystemTokensCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["system-tokens"], queryFn: () => apiGet<SystemTokensAnswer>("/api/system-tokens") });

  const [system, setSystem] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]>("90");
  const [shown, setShown] = useState<string | null>(null);

  const systems = list.data?.systems ?? [];
  const chosen = systems.find((s) => s.key === (system || systems[0]?.key)) ?? null;

  const create = useMutation({
    mutationFn: () => apiPost<{ token: string }>("/api/system-tokens", { system: chosen?.key, workspaceId: spaceId, expiresInDays: expiry === "never" ? null : Number(expiry) }),
    onSuccess: (res) => {
      setShown(res.token);
      toast(t("systok.created"), "success");
      qc.invalidateQueries({ queryKey: ["system-tokens"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/system-tokens/${id}`),
    onSuccess: () => {
      toast(t("systok.revoked"), "success");
      qc.invalidateQueries({ queryKey: ["system-tokens"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const tokens = list.data?.tokens ?? [];
  const spaces = list.data?.spaces ?? [];
  const switchOn = list.data?.switchOn ?? true;

  return (
    <section className="space-y-4 rounded-[14px] bg-surface-1 p-5" aria-labelledby="systok-title">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-cat-3/10 text-cat-3">
          <KeyRound className="size-5" />
        </span>
        <div>
          <h2 id="systok-title" className="text-sm font-semibold">
            {t("systok.title")}
          </h2>
          <p className="text-xs text-muted">{t("systok.subtitle")}</p>
        </div>
      </div>

      <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6">{t("systok.warn")}</p>

      {shown ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border bg-surface-2 p-3" role="status">
          <p className="text-xs font-medium text-fg">{t("systok.once.title")}</p>
          <p className="text-xs text-muted">{t("systok.once.body")}</p>
          <code dir="ltr" className="block break-all rounded bg-surface px-2 py-1.5 font-mono text-xs">
            {shown}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                void navigator.clipboard?.writeText(shown).then(
                  () => toast(t("systok.once.copied"), "success"),
                  () => undefined,
                )
              }
            >
              {t("systok.once.copy")}
            </Button>
            <Button type="button" size="sm" onClick={() => setShown(null)}>
              {t("systok.once.done")}
            </Button>
          </div>
        </div>
      ) : null}

      {!switchOn ? (
        <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6 text-warn">{t("systok.off")}</p>
      ) : (
        <form
          className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("systok.system")}</span>
              <Select value={chosen?.key ?? ""} onChange={(e) => setSystem(e.target.value)}>
                {systems.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("systok.space")}</span>
              <Select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
                <option value="">{t("systok.space_ph")}</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("systok.expiry")}</span>
              <Select value={expiry} onChange={(e) => setExpiry(e.target.value as (typeof EXPIRY)[number])}>
                {EXPIRY.map((e) => (
                  <option key={e} value={e}>
                    {t(`door.new.exp.${e}`)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {chosen ? (
            <p className="text-xs text-muted">
              {t("systok.scopes")}: {chosen.permissions.map((p) => t(`systok.perm.${p}`)).join("، ")}
            </p>
          ) : null}
          {expiry === "never" ? <p className="text-xs text-warn">{t("door.new.never_warn")}</p> : null}
          <Button type="submit" size="sm" disabled={create.isPending || !chosen || !spaceId}>
            {t("systok.create")}
          </Button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[36rem] text-right text-xs">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-2 py-1.5 font-medium">{t("systok.col.system")}</th>
              <th className="px-2 py-1.5 font-medium">{t("systok.col.space")}</th>
              <th className="px-2 py-1.5 font-medium">{t("systok.col.perms")}</th>
              <th className="px-2 py-1.5 font-medium">{t("systok.col.used")}</th>
              <th className="px-2 py-1.5 font-medium">{t("systok.col.expires")}</th>
              <th className="px-2 py-1.5 font-medium">{t("systok.col.status")}</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tokens.map((tk) => (
              <tr key={tk.id}>
                <td className="px-2 py-1.5">
                  <span className="block font-medium">{tk.name}</span>
                  <code dir="ltr" className="font-mono text-muted">
                    {tk.hint}
                  </code>
                </td>
                <td className="px-2 py-1.5">{tk.space.name}</td>
                <td className="px-2 py-1.5">{tk.permissions.map((p) => t(`systok.perm.${p}`)).join("، ")}</td>
                <td className="px-2 py-1.5 text-muted">{tk.lastUsedAt ? fmtDateTime(tk.lastUsedAt) : t("door.never_used")}</td>
                <td className="px-2 py-1.5 text-muted">{tk.expiresAt ? fmtDateTime(tk.expiresAt) : t("door.never_expires")}</td>
                <td className="px-2 py-1.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tk.status === "active" ? "bg-ok/10 text-ok" : "bg-surface-2 text-muted")}>{t(`door.status.${tk.status}`)}</span>
                </td>
                <td className="px-2 py-1.5">
                  {tk.status === "active" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={revoke.isPending}
                      onClick={() => {
                        if (window.confirm(t("systok.revoke_confirm"))) revoke.mutate(tk.id);
                      }}
                    >
                      {t("systok.revoke")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {tokens.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-3 text-center text-muted">
                  {t("systok.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function errText(err: unknown, t: TFn): string {
  if (err instanceof ApiError) {
    if (err.code === "validation.failed" && Array.isArray(err.details) && err.details.length > 0) {
      const first = (err.details[0] as { message?: string }).message;
      const mapped = first ? t(first) : "";
      if (mapped && mapped !== first) return mapped;
    }
    if (err.messageKey) {
      const mapped = t(err.messageKey);
      if (mapped !== err.messageKey) return mapped;
    }
    if (err.code) {
      const translated = t(err.code);
      if (translated !== err.code) return translated;
    }
  }
  return t("common.error");
}
