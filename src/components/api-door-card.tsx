"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DoorOpen } from "lucide-react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Must mirror DOOR_PERMISSIONS in src/server/door/tokens.ts; reads first, because a new token is read-only until the owner says otherwise. */
const PERMISSIONS = ["ideas.read", "tasks.read", "ideas.write", "tasks.write"] as const;
const EXPIRY = ["30", "90", "365", "never"] as const;

interface TokenItem {
  id: string;
  name: string;
  hint: string;
  permissions: string[];
  space: { id: string; name: string };
  createdBy: { id: string; name: string };
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  status: "active" | "revoked" | "expired";
}

interface TokensAnswer {
  tokens: TokenItem[];
  spaces: { id: string; name: string }[];
  switchOn: boolean;
}

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * «باب الربط الخارجي» (src/server/services/api-tokens.ts), under «الأتمتة»: whoever holds «integrations.manage» makes a token
 * for another Zaki system (System 7), picks the ONE space it writes to and what it may do (reads first; writes are switched on on
 * purpose), sees when it was last used, and revokes it in one click. The whole token is shown once, right after it is made.
 */
export function ApiDoorCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["api-tokens"], queryFn: () => apiGet<TokensAnswer>("/api/integrations/api-tokens") });

  const [name, setName] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [perms, setPerms] = useState<string[]>(["ideas.read", "tasks.read"]);
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]>("90");
  const [shown, setShown] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiPost<{ token: string }>("/api/integrations/api-tokens", {
        name: name.trim(),
        permissions: perms,
        workspaceId: spaceId,
        expiresInDays: expiry === "never" ? null : Number(expiry),
      }),
    onSuccess: (res) => {
      setShown(res.token);
      setName("");
      toast(t("door.created"), "success");
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/integrations/api-tokens/${id}`),
    onSuccess: () => {
      toast(t("door.revoked"), "success");
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const tokens = list.data?.tokens ?? [];
  const spaces = list.data?.spaces ?? [];
  const switchOn = list.data?.switchOn ?? true;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface-1 p-5" aria-labelledby="door-title">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-cat-3/10 text-cat-3">
          <DoorOpen className="size-5" />
        </span>
        <div>
          <h2 id="door-title" className="text-sm font-semibold">
            {t("door.title")}
          </h2>
          <p className="text-xs text-muted">{t("door.subtitle")}</p>
        </div>
      </div>

      <div className="space-y-1 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6">
        <p className="text-warn">{t("door.warn")}</p>
        <p>{t("door.fix")}</p>
      </div>

      {/* the one place the whole token is ever shown */}
      {shown ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border bg-surface-2 p-3" role="status">
          <p className="text-xs font-medium text-fg">{t("door.once.title")}</p>
          <p className="text-xs text-muted">{t("door.once.body")}</p>
          <code dir="ltr" className="block break-all rounded bg-surface px-2 py-1.5 font-mono text-xs">
            {shown}
          </code>
          <p className="text-xs text-muted">{t("door.once.use")}</p>
          <code dir="ltr" className="block whitespace-pre-wrap break-all font-mono text-xs text-muted">
            {`POST ${origin}/api/v1/ideas
Authorization: Bearer <token>
Idempotency-Key: <unique per request>
Content-Type: application/json`}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                void navigator.clipboard?.writeText(shown).then(
                  () => toast(t("door.once.copied"), "success"),
                  () => undefined,
                )
              }
            >
              {t("door.once.copy")}
            </Button>
            <Button type="button" size="sm" onClick={() => setShown(null)}>
              {t("door.once.done")}
            </Button>
          </div>
        </div>
      ) : null}

      {!switchOn ? (
        <div className="space-y-1 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6">
          <p className="text-warn">{t("door.off.warn")}</p>
          <p>{t("door.off.fix")}</p>
        </div>
      ) : (
      <form
        className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!create.isPending) create.mutate();
        }}
      >
        <h3 className="text-xs font-semibold">{t("door.new.title")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-fg">{t("door.new.name")}</span>
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("door.new.name_ph")} />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-fg">{t("door.new.space")}</span>
            <Select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
              <option value="">{t("door.new.space_ph")}</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-fg">{t("door.new.perms")}</legend>
          <p className="text-xs text-muted">{t("door.new.perms_hint")}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {PERMISSIONS.map((p) => {
              const on = perms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPerms((all) => (on ? all.filter((x) => x !== p) : [...all, p]))}
                  className={cn(
                    "min-h-11 rounded-lg border px-2 py-1 text-xs transition-colors md:min-h-0",
                    on ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:bg-surface-2",
                  )}
                >
                  {t(`door.perm.${p}`)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="block space-y-1 text-xs sm:max-w-xs">
          <span className="font-medium text-fg">{t("door.new.expiry")}</span>
          <Select value={expiry} onChange={(e) => setExpiry(e.target.value as (typeof EXPIRY)[number])}>
            {EXPIRY.map((e) => (
              <option key={e} value={e}>
                {t(`door.new.exp.${e}`)}
              </option>
            ))}
          </Select>
        </label>
        {expiry === "never" ? <p className="text-xs text-warn">{t("door.new.never_warn")}</p> : null}
        <Button type="submit" size="sm" disabled={create.isPending || name.trim().length < 2 || !spaceId || perms.length === 0}>
          {t("door.new.create")}
        </Button>
      </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] text-right text-xs">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-2 py-1.5 font-medium">{t("door.col.name")}</th>
              <th className="px-2 py-1.5 font-medium">{t("door.col.space")}</th>
              <th className="px-2 py-1.5 font-medium">{t("door.col.perms")}</th>
              <th className="px-2 py-1.5 font-medium">{t("door.col.by")}</th>
              <th className="px-2 py-1.5 font-medium">{t("door.col.used")}</th>
              <th className="px-2 py-1.5 font-medium">{t("door.col.expires")}</th>
              <th className="px-2 py-1.5 font-medium">{t("door.col.status")}</th>
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
                <td className="px-2 py-1.5">{tk.permissions.map((p) => t(`door.perm.${p}`)).join("، ")}</td>
                <td className="px-2 py-1.5">{tk.createdBy.name}</td>
                <td className="px-2 py-1.5 text-muted">{tk.lastUsedAt ? fmtDateTime(tk.lastUsedAt) : t("door.never_used")}</td>
                <td className="px-2 py-1.5 text-muted">{tk.expiresAt ? fmtDateTime(tk.expiresAt) : t("door.never_expires")}</td>
                <td className="px-2 py-1.5">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      tk.status === "active" ? "bg-ok/10 text-ok" : "bg-surface-2 text-muted",
                    )}
                  >
                    {t(`door.status.${tk.status}`)}
                  </span>
                  {tk.revokedReason ? <span className="mt-1 block text-muted">{t(`door.reason.${tk.revokedReason}`)}</span> : null}
                </td>
                <td className="px-2 py-1.5">
                  {tk.status === "active" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={revoke.isPending}
                      onClick={() => {
                        if (window.confirm(t("door.revoke_confirm"))) revoke.mutate(tk.id);
                      }}
                    >
                      {t("door.revoke")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {tokens.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-3 text-center text-muted">
                  {t("door.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-6 text-muted">{t("door.note.person")}</p>
      <p className="text-xs leading-6 text-muted">{t("door.note.source")}</p>
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
