"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { CircleDot, ExternalLink, FileText, Globe, Plug, Webhook } from "lucide-react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import { enumLabel, eventDetailLabel, eventLabel } from "@/lib/i18n/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** Must mirror N8N_EVENTS in src/server/services/n8n.ts. */
const N8N_EVENTS = [
  "task.created",
  "task.completed",
  "task.moved",
  "idea.created",
  "idea.accepted",
  "idea.rejected",
  "comment.created",
  "member.joined",
] as const;

interface N8nStatus {
  status: {
    connected: boolean;
    webhookUrl: string | null;
    events: string[];
    sharedSecret: string | null;
  };
  events: Array<{ id: string; direction: string; type: string; status: string; detail: string | null; createdAt: string }>;
}

interface GoogleStatus {
  connected: boolean;
  configured: boolean;
  /** Where the app's keys come from: the server's settings, typed on the site, or not yet. */
  appSource?: "env" | "site" | null;
  redirectUri?: string;
  library?: boolean;
  libraryOff?: boolean;
  files?: DriveFile[];
  filesError?: string | null;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  link: string | null;
}

export function AutomationView({ ctx, doorCard = null }: { ctx: { orgRole: string }; doorCard?: ReactNode }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const params = useSearchParams();
  const canManage = ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN";

  // Google OAuth redirects back with ?google=… — surface exactly one verdict.
  const googleResult = params.get("google");
  useEffect(() => {
    if (!googleResult) return;
    const verdict: Record<string, string> = {
      connected: t("google.connectedToast"),
      not_configured: t("google.notConfigured"),
    };
    toast(verdict[googleResult] ?? t("google.errorToast"), googleResult === "connected" ? "success" : "error");
  }, [googleResult]); // eslint-disable-line react-hooks/exhaustive-deps

  const n8n = useQuery({ queryKey: ["n8n"], queryFn: () => apiGet<N8nStatus>("/api/integrations/n8n") });

  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated || !n8n.data) return;
    if (n8n.data.status.webhookUrl) setWebhookUrl(n8n.data.status.webhookUrl);
    setSelectedEvents(n8n.data.status.events ?? []);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n8n.data]);

  const saveN8n = useMutation({
    mutationFn: (rotate: boolean) =>
      apiPost<{ generatedSecret?: string; connected: boolean }>("/api/integrations/n8n", {
        webhookUrl: webhookUrl.trim(),
        events: selectedEvents,
        rotateSecret: rotate,
      }),
    onSuccess: (res) => {
      if (res.generatedSecret) setGeneratedSecret(res.generatedSecret);
      toast(t("n8n.saved"), "success");
      qc.invalidateQueries({ queryKey: ["n8n"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const testN8n = useMutation({
    mutationFn: () => apiPost<{ delivered: boolean; detail?: string }>("/api/integrations/n8n/test"),
    onSuccess: (res) => {
      toast(res.delivered ? t("n8n.testOk") : `${t("n8n.testFail")}${res.detail ? ` — ${eventDetailLabel(res.detail)}` : ""}`, res.delivered ? "success" : "error");
      qc.invalidateQueries({ queryKey: ["n8n"] });
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const deleteN8n = useMutation({
    mutationFn: () => apiDelete("/api/integrations/n8n"),
    onSuccess: () => {
      setGeneratedSecret(null);
      qc.invalidateQueries({ queryKey: ["n8n"] });
      toast(t("n8n.removed"), "success");
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const [showFiles, setShowFiles] = useState(false);
  // The Drive file list is for org managers only (the server answers 403 otherwise) and is only
  // fetched when it is actually being shown (`?files=1`); the status itself is open to every member.
  const wantFiles = showFiles && canManage;
  const google = useQuery({
    queryKey: ["google", wantFiles],
    queryFn: () => apiGet<GoogleStatus>(`/api/integrations/google${wantFiles ? "?files=1" : ""}`),
  });

  const disconnectGoogle = useMutation({
    mutationFn: () => apiDelete("/api/integrations/google"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["google"] });
      toast(t("google.disconnected"), "success");
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{t("automation.title")}</h1>
        <p className="text-xs text-muted">{t("automation.subtitle")}</p>
      </header>

      {/* ---------------- n8n ---------------- */}
      <section className="space-y-4 rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-cat-2/10 text-cat-2">
              <Webhook className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">{enumLabel("IntegrationType", "N8N")}</h2>
              <p className="text-xs text-muted">{t("n8n.subtitle")}</p>
            </div>
          </div>
          {n8n.data && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                n8n.data.status.connected ? "bg-ok/10 text-ok" : "bg-surface-2 text-muted",
              )}
            >
              {n8n.data.status.connected ? t("n8n.connected") : t("n8n.notConnected")}
            </span>
          )}
        </div>

        {canManage ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                dir="ltr"
                placeholder="https://n8n.example.com/webhook/zaki"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                className="flex-1 font-mono text-sm"
                aria-label={t("automation.webhookLabel")}
              />
              <Button onClick={() => saveN8n.mutate(false)} disabled={saveN8n.isPending || !webhookUrl.trim()}>
                {t("n8n.save")}
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {N8N_EVENTS.map((e) => {
                const on = selectedEvents.includes(e);
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() =>
                      setSelectedEvents((prev) => (on ? prev.filter((x) => x !== e) : [...prev, e]))
                    }
                    aria-pressed={on}
                    className={cn(
                      "rounded-lg border px-2 py-1 text-xs transition-colors",
                      on ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:bg-surface-2",
                    )}
                  >
                    {eventLabel(e)}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => testN8n.mutate()} disabled={!n8n.data?.status.connected || testN8n.isPending}>
                <CircleDot className="size-4" />
                {t("n8n.test")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => saveN8n.mutate(true)} disabled={!n8n.data || saveN8n.isPending}>
                {t("n8n.rotate")}
              </Button>
              {n8n.data?.status.connected && (
                <Button variant="danger" size="sm" onClick={() => deleteN8n.mutate()} disabled={deleteN8n.isPending}>
                  {t("n8n.remove")}
                </Button>
              )}
            </div>

            {generatedSecret ? (
              <div className="rounded-lg border border-dashed border-border bg-surface-2 p-3">
                <p className="mb-1 text-xs text-muted">{t("n8n.secretOnce")}</p>
                <code dir="ltr" className="block break-all font-mono text-xs">
                  {generatedSecret}
                </code>
                <p className="mt-2 text-xs leading-5 text-muted">{t("n8n.inboundHelp")}</p>
                <code dir="ltr" className="mt-1 block whitespace-pre-wrap break-all font-mono text-xs text-muted">
                  {`POST {APP_URL}/api/integrations/n8n/inbound
x-zaki-org: {orgId}
x-zaki-timestamp: {unix seconds}
x-zaki-signature: sha256=HMAC_SHA256(secret, "{timestamp}.{raw body}")`}
                </code>
                <p className="mt-1 text-xs leading-5 text-muted">{t("n8n.inboundLegacy")}</p>
              </div>
            ) : n8n.data?.status.connected ? (
              <p className="text-xs text-muted">{t("n8n.secretStored")}</p>
            ) : null}
          </div>
        ) : ctx.orgRole === "GUEST" ? (
          <p className="text-xs text-muted">{t("n8n.guestNote")}</p>
        ) : (
          <p className="text-xs text-muted">{t("n8n.managerOnly")}</p>
        )}

        {/* event log — every attempt, success or failure */}
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-right text-xs">
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium">{t("log.direction")}</th>
                <th className="px-2 py-1.5 font-medium">{t("log.event")}</th>
                <th className="px-2 py-1.5 font-medium">{t("log.status")}</th>
                <th className="px-2 py-1.5 font-medium">{t("log.detail")}</th>
                <th className="px-2 py-1.5 font-medium">{t("log.time")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(n8n.data?.events ?? []).map((ev) => (
                <tr key={ev.id}>
                  <td className="px-2 py-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs",
                        ev.direction === "OUT" ? "bg-cat-2/10 text-cat-2" : "bg-info/10 text-info",
                      )}
                    >
                      {enumLabel("IntegrationDirection", ev.direction)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{eventLabel(ev.type)}</td>
                  <td className={cn("px-2 py-1.5", ev.status === "OK" ? "text-ok" : "text-danger")}>{enumLabel("IntegrationEventStatus", ev.status)}</td>
                  <td className="max-w-[16rem] truncate px-2 py-1.5 text-muted" dir="auto" title={ev.detail ? eventDetailLabel(ev.detail) : undefined}>
                    {ev.detail ? eventDetailLabel(ev.detail) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-muted">{fmtDateTime(ev.createdAt)}</td>
                </tr>
              ))}
              {(n8n.data?.events.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-center text-muted">
                    {t("log.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- Google Drive ---------------- */}
      <section className="space-y-4 rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-warn/10 text-warn">
              <Globe className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">{enumLabel("IntegrationType", "GOOGLE_DRIVE")}</h2>
              <p className="text-xs text-muted">{t("google.subtitle")}</p>
            </div>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              google.data?.connected
                ? "bg-ok/10 text-ok"
                : google.data?.configured
                  ? "bg-surface-2 text-muted"
                  : "bg-warn/10 text-warn",
            )}
          >
            {google.data?.connected ? t("google.connected") : google.data?.configured ? t("google.notConnected") : t("google.needsEnv")}
          </span>
        </div>

        {!google.data?.configured ? (
          canManage && google.data ? (
            <GoogleAppForm redirectUri={google.data.redirectUri ?? ""} replacing={false} onSaved={() => qc.invalidateQueries({ queryKey: ["google"] })} t={t} />
          ) : (
            <p className="text-xs leading-6 text-muted">{t("google.envHelp")}</p>
          )
        ) : google.data.connected ? (
          <div className="space-y-3">
            {google.data.libraryOff ? (
              <p className="text-xs leading-6 text-muted">{t("google.libraryFeatureOff")}</p>
            ) : google.data.library ? (
              <p className="text-xs leading-6 text-ok">{t("google.libraryOn")}</p>
            ) : (
              <div className="space-y-1 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6">
                <p className="text-warn">{t("google.libraryNeedsReconnect")}</p>
                <p>{t("google.libraryReconnectFix")}</p>
                {canManage && (
                  <Link href="/api/integrations/google/start">
                    <Button size="sm" className="mt-1">
                      <Plug className="size-4" />
                      {t("google.reconnect")}
                    </Button>
                  </Link>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <Button variant="secondary" size="sm" onClick={() => setShowFiles((s) => !s)}>
                  <FileText className="size-4" />
                  {showFiles ? t("google.hideFiles") : t("google.viewFiles")}
                </Button>
              )}
              {canManage && (
                <Button variant="danger" size="sm" onClick={() => disconnectGoogle.mutate()} disabled={disconnectGoogle.isPending}>
                  {t("google.disconnect")}
                </Button>
              )}
            </div>
            {google.data.library && canManage && (
              <div className="space-y-1 text-xs leading-6">
                <p className="text-warn">{t("google.disconnectWarn")}</p>
                <p className="text-muted">{t("google.disconnectFix")}</p>
              </div>
            )}
            {google.data.filesError && <p className="text-xs text-danger">{t(google.data.filesError)}</p>}
            {showFiles && canManage && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {google.data.files?.length ? (
                  google.data.files.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="line-clamp-1 text-xs">{f.name}</span>
                      {f.link && (
                        <a href={f.link} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                          <ExternalLink className="inline size-3" /> {t("google.open")}
                        </a>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="px-3 py-3 text-center text-xs text-muted">{t("google.noFiles")}</li>
                )}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {canManage ? (
              <Link href="/api/integrations/google/start">
                <Button size="sm">
                  <Plug className="size-4" />
                  {t("google.connect")}
                </Button>
              </Link>
            ) : null}
            <p className="text-xs text-muted">{t("google.readonlyNote")}</p>
          </div>
        )}
        {/* keys typed on the site can be replaced from here (the server's own settings, when set, win and are not shown) */}
        {canManage && google.data?.appSource === "site" ? (
          <details className="text-xs">
            <summary className="min-h-11 cursor-pointer py-2 text-muted">{t("google.app.change")}</summary>
            <GoogleAppForm redirectUri={google.data.redirectUri ?? ""} replacing onSaved={() => qc.invalidateQueries({ queryKey: ["google"] })} t={t} />
          </details>
        ) : null}
      </section>

      {/* ---------------- «باب الربط الخارجي»: drawn only while the owner's switch is on, for whoever holds «integrations.manage» ---------------- */}
      {doorCard}
    </div>
  );
}

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * «مفاتيح جوجل» typed on the site (the owner's ask, 2026-10-27: «بدي ادخلها بالسايت»): the app's id and secret from
 * Google's console, saved on the company (the secret encrypted, never shown again), with the return address ready to
 * copy into Google. Whoever runs integrations sees it while Drive has no app yet, or to replace the keys typed here.
 */
function GoogleAppForm({ redirectUri, replacing, onSaved, t }: { redirectUri: string; replacing: boolean; onSaved: () => void; t: TFn }) {
  const { toast } = useToast();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const save = useMutation({
    mutationFn: () => apiPost("/api/integrations/google/app", { clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
    onSuccess: () => {
      setClientSecret("");
      toast(t("google.app.saved"), "success");
      onSaved();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });
  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      <p className="text-xs leading-6 text-muted">{replacing ? t("google.app.replaceIntro") : t("google.app.intro")}</p>
      <label className="block space-y-1 text-xs">
        <span className="font-medium text-fg">{t("google.app.redirect")}</span>
        <span className="flex items-center gap-2">
          <code dir="ltr" className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1.5 text-start">{redirectUri}</code>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() =>
              void navigator.clipboard?.writeText(redirectUri).then(
                () => toast(t("google.app.copied"), "success"),
                () => undefined,
              )
            }
          >
            {t("google.app.copy")}
          </Button>
        </span>
      </label>
      <label className="block space-y-1 text-xs">
        <span className="font-medium text-fg">{t("google.app.clientId")}</span>
        <Input dir="ltr" autoComplete="off" spellCheck={false} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-abc….apps.googleusercontent.com" />
      </label>
      <label className="block space-y-1 text-xs">
        <span className="font-medium text-fg">{t("google.app.clientSecret")}</span>
        <Input dir="ltr" type="password" autoComplete="new-password" spellCheck={false} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
      </label>
      <Button type="submit" size="sm" disabled={save.isPending || !clientId.trim() || !clientSecret.trim()}>
        {t("google.app.save")}
      </Button>
    </form>
  );
}

function errText(err: unknown, t: TFn): string {
  if (err instanceof ApiError) {
    // A validation error names the exact problem (e.g. the webhook URL rules): show that, not a generic text.
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
