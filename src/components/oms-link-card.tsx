"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageSearch } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, ApiError } from "@/lib/api-client";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface OmsAnswer {
  switchOn: boolean;
  keyConfigured: boolean;
  connected: boolean;
  tokenSaved: boolean;
  baseUrl: string | null;
  tokenExpiresAt: string | null;
  daysLeft: number | null;
  tokenWarn: boolean;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  linked: number;
  missing: number;
}

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** The dictionary key that explains a failure's code (every 5xx shares one). */
const KNOWN_CODES = new Set(["no_base_url", "url_invalid", "url_https_only", "url_credentials", "url_private", "url_unresolvable", "no_token", "timeout", "network", "redirect", "bad_body", "bad_id", "too_big", "not_connected", "unknown", "http_401", "http_403", "http_404", "http_429", "http_4xx", "http_5xx"]);
export function omsErrorKey(code: string | null | undefined): string {
  if (!code) return "common.error";
  if (KNOWN_CODES.has(code)) return `oms.error.${code}`;
  if (/^http_5\d\d$/.test(code)) return "oms.error.http_5xx";
  if (/^http_4\d\d$/.test(code)) return "oms.error.http_4xx";
  return "oms.error.unknown";
}

/**
 * «ربط نظام الطلبات» (src/server/services/oms-link.ts), under «التكاملات», for the OWNER alone: the switch, the address, the token (typed
 * once, never shown again: the card only says «محفوظ»), the day the token ends (a warning 14 days before), «اقرأي هلّق», and the state of
 * the last read as a CODE'S sentence, never the other side's words. No price is typed here: the sheets only show what was read.
 * Every risk is shown as ⚠️ with its fix as 🔧.
 */
export function OmsLinkCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["oms-link"], queryFn: () => apiGet<OmsAnswer>("/api/integrations/oms") });
  const data = state.data;

  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [expires, setExpires] = useState("");

  useEffect(() => {
    if (!data) return;
    setBaseUrl(data.baseUrl ?? "");
    setExpires(data.tokenExpiresAt ?? "");
  }, [data?.baseUrl, data?.tokenExpiresAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => qc.invalidateQueries({ queryKey: ["oms-link"] });

  const flip = useMutation({
    mutationFn: (on: boolean) => apiPatch("/api/settings/features", { key: "omsLink", on }),
    onSuccess: () => {
      toast(t("oms.card.switchChanged"), "success");
      void refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });
  const save = useMutation({
    mutationFn: () => apiPut("/api/integrations/oms", { baseUrl: baseUrl.trim(), ...(token !== "" ? { token } : {}), tokenExpiresAt: expires === "" ? null : expires }),
    onSuccess: () => {
      // the token leaves the form the moment it is saved
      setToken("");
      toast(t("oms.card.saved"), "success");
      void refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });
  const sync = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; errorCode?: string; refreshed: number }>("/api/integrations/oms/sync"),
    onSuccess: (r) => {
      toast(r.ok ? t("oms.card.synced") : t(omsErrorKey(r.errorCode)), r.ok ? "success" : "error");
      void refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete("/api/integrations/oms"),
    onSuccess: () => {
      setBaseUrl("");
      setToken("");
      setExpires("");
      toast(t("oms.card.disconnected"), "success");
      void refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const busy = save.isPending || sync.isPending || remove.isPending;
  const complete = baseUrl.trim() !== "" && (token !== "" || data?.tokenSaved === true);
  const gone = data?.daysLeft !== null && data?.daysLeft !== undefined && data.daysLeft < 0;

  return (
    <section className="space-y-4 rounded-[14px] bg-surface-1 p-5" aria-labelledby="oms-title">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-cat-2/10 text-cat-2">
          <PackageSearch className="size-5" />
        </span>
        <div className="min-w-[10rem] flex-1">
          <h2 id="oms-title" className="text-sm font-semibold">
            {t("oms.card.title")}
          </h2>
          <p className="text-xs text-muted">{t("oms.card.hint")}</p>
        </div>
        {data ? <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{t(data.connected ? "oms.card.connected" : "oms.card.notConnected")}</span> : null}
        {data ? (
          <Button type="button" size="sm" variant={data.switchOn ? "secondary" : "primary"} disabled={flip.isPending} onClick={() => flip.mutate(!data.switchOn)}>
            {t(data.switchOn ? "oms.card.turnOff" : "oms.card.turnOn")}
          </Button>
        ) : null}
      </div>

      {data && !data.switchOn ? <Notice warn={t("oms.card.off")} fix={t("oms.card.offFix")} /> : null}
      {data && !data.keyConfigured ? <Notice warn={t("oms.err.no_key")} fix={t("oms.card.noKeyFix")} /> : null}
      {data && data.connected && data.tokenWarn ? (
        <Notice warn={gone ? t("oms.card.tokenGone") : t("oms.card.tokenSoon", { days: fmtNumber(data.daysLeft ?? 0) })} fix={t("oms.card.tokenFix")} />
      ) : null}
      {data && data.connected && data.lastErrorCode ? <Notice warn={`${t("oms.card.warn")}: ${t(omsErrorKey(data.lastErrorCode))}`} fix={t("oms.card.fix")} /> : null}

      {data && data.connected ? (
        <div className="space-y-1 text-xs text-muted">
          <p>{data.lastSyncAt ? `${t("oms.card.lastSync")}: ${fmtDateTime(data.lastSyncAt)}` : `${t("oms.card.lastSync")}: ${t("oms.card.never")}`}</p>
          <p>{t("oms.card.counts", { linked: fmtNumber(data.linked), missing: fmtNumber(data.missing) })}</p>
          {data.tokenExpiresAt ? <p>{`${t("oms.card.tokenEnds")}: ${data.tokenExpiresAt}`}</p> : null}
        </div>
      ) : null}

      {data && data.switchOn ? (
        <form
          className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-3"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            if (complete && !busy) save.mutate();
          }}
        >
          <label className="block space-y-1 text-xs">
            <span className="text-muted">{t("oms.card.baseUrl")}</span>
            <Input dir="ltr" inputMode="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} maxLength={300} autoComplete="off" />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted">{t("oms.card.token")}</span>
            <Input dir="ltr" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={data.tokenSaved ? t("oms.card.tokenSavedPlaceholder") : ""} autoComplete="new-password" maxLength={4000} />
            <span className="block text-muted">{t("oms.card.tokenHint")}</span>
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted">{t("oms.card.tokenEndsAt")}</span>
            <Input dir="ltr" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!complete || busy}>
              {t("oms.card.save")}
            </Button>
            {data.connected ? (
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => sync.mutate()}>
                {t("oms.card.syncNow")}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {data && data.connected ? (
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => remove.mutate()}>
          {t("oms.card.disconnect")}
        </Button>
      ) : null}
    </section>
  );
}

function Notice({ warn, fix }: { warn: string; fix: string }) {
  return (
    <div className="space-y-1 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6">
      <p className="text-warn">{`⚠️ ${warn}`}</p>
      <p>{`🔧 ${fix}`}</p>
    </div>
  );
}

function errText(err: unknown, t: TFn): string {
  if (err instanceof ApiError) {
    const first = Array.isArray(err.details) ? (err.details[0] as { message?: unknown } | undefined) : undefined;
    if (first && typeof first.message === "string") {
      const mapped = t(first.message);
      if (mapped !== first.message) return mapped;
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
