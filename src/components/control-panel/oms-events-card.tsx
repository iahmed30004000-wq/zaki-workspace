"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { EventsStatusDTO } from "@/server/integrations/oms-events";

/**
 * «أحداث نظام الطلبات» — the OWNER's card of the receiver (I1.1a built the door and the receiver; this is its screen, built here because the wiring package I1w had not started):
 * the address the orders system is told to send to, the secret that signs every delivery (made here and shown ONCE, or pasted from the orders system: it is write-only, the card
 * only ever learns «محفوظ»), what arrived in the last 24 hours and taking the receiver out. The door is `/api/integrations/oms/events/settings` (the owner alone, 404 while the
 * switch is off). Not here: the rules that post an event as a card into a topic and the daily card, which need a topic picker; they stay on the door.
 *
 * ⚠️ Whoever holds the secret can make the app believe an order changed. 🔧 It is shown once, kept encrypted, never returned by the door; «بدّل العنوان» and the removal cut the old one off.
 */

const URL_KEY = ["oms-events-status"] as const;
const DOOR = "/api/integrations/oms/events/settings";

const errorText = (t: (key: string) => string, err: unknown): string => {
  if (err instanceof ApiError) {
    const details = Array.isArray(err.details) ? (err.details as { message?: string }[]) : [];
    for (const d of details) if (d.message && t(d.message) !== d.message) return t(d.message);
    if (err.messageKey && t(err.messageKey) !== err.messageKey) return t(err.messageKey);
  }
  return t("common.error");
};

export function OmsEventsCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const query = useQuery({ queryKey: URL_KEY, queryFn: () => apiGet<EventsStatusDTO>(DOOR), retry: false, refetchOnWindowFocus: false });
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(work: () => Promise<EventsStatusDTO & { secret?: string }>, done: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await work();
      client.setQueryData(URL_KEY, next);
      setShown(next.secret ?? null);
      setPasted("");
      toast(t(done), "success");
    } catch (err) {
      setMessage(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  const s = query.data;
  const address = s?.path && typeof window !== "undefined" ? `${window.location.origin}${s.path}` : (s?.path ?? "");
  return (
    <section className="space-y-3 rounded-card border border-border bg-surface-1 p-4 shadow-card" data-testid="oms-events-card" aria-labelledby="oms-events-title">
      <header>
        <h3 id="oms-events-title" className="text-sm font-semibold">
          {t("cpv2.oms.title")}
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t("cpv2.oms.intro")}</p>
      </header>
      <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
        <p className="text-fg">{t("cpv2.oms.warn")}</p>
        <p className="mt-0.5 text-fg-muted">{t("cpv2.oms.fix")}</p>
      </div>

      {query.isLoading ? <Loader2 aria-hidden="true" className="size-4 animate-spin text-fg-muted" /> : null}
      {query.isError ? <p className="text-sm text-danger">{errorText(t, query.error)}</p> : null}

      {s ? (
        <div className="space-y-3">
          {!s.keyConfigured ? <p className="text-xs leading-5 text-danger">{t("oms.events.e.no_key")}</p> : null}
          {s.receiverId ? (
            <div className="space-y-2">
              <p className="text-xs text-fg-muted">{t("cpv2.oms.address")}</p>
              <p className="break-all rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs" dir="ltr" data-testid="oms-events-address">
                {address}
              </p>
              <p className="text-xs">{s.secretSaved ? t("cpv2.oms.secret_saved") : t("cpv2.oms.secret_missing")}</p>
              {shown ? (
                <div className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-xs" role="status">
                  <p className="text-fg">{t("cpv2.oms.secret_once")}</p>
                  <p className="mt-1 break-all font-mono text-xs" dir="ltr" data-testid="oms-events-secret">
                    {shown}
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label={t("cpv2.oms.paste")} type="password" autoComplete="new-password" spellCheck={false} dir="ltr" value={pasted} onChange={(e) => setPasted(e.target.value)} className="h-11 w-auto min-w-48 md:h-9" />
                <Button type="button" size="sm" variant="secondary" disabled={busy || pasted.trim().length === 0} onClick={() => void run(async () => {
                  await apiPut(DOOR, { secret: pasted.trim() });
                  return apiGet<EventsStatusDTO>(DOOR);
                }, "cpv2.oms.done_secret")}>
                  {t("cpv2.oms.save_secret")}
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => apiPost<EventsStatusDTO & { secret?: string }>(DOOR, { action: "generate_secret" }), "cpv2.oms.done_secret")}>
                  {t("cpv2.oms.make_secret")}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => apiPost<EventsStatusDTO>(DOOR, { action: "rotate_id" }), "cpv2.oms.done_rotate")}>
                  {t("cpv2.oms.rotate")}
                </Button>
                <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(t("cpv2.oms.remove_confirm"))) void run(() => apiDelete<EventsStatusDTO>(DOOR), "cpv2.oms.done_remove"); }}>
                  {t("cpv2.oms.remove")}
                </Button>
              </div>
              <p className="text-xs text-fg-muted">
                {s.lastEventAt ? t("cpv2.oms.last_event", { when: fmtDateTime(s.lastEventAt) }) : t("cpv2.oms.no_events")}
              </p>
              <ul className="flex flex-wrap gap-2 text-xs" data-testid="oms-events-counts">
                {Object.entries(s.last24h).map(([event, n]) => (
                  <li key={event} className="rounded-full border border-border bg-surface-2 px-2 py-0.5">
                    {t(`oms.events.title.${event}`) === `oms.events.title.${event}` ? event : t(`oms.events.title.${event}`)}: {fmtNumber(n)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Button type="button" size="sm" disabled={busy || !s.switchOn || !s.keyConfigured} onClick={() => void run(() => apiPost<EventsStatusDTO>(DOOR, { action: "create" }), "cpv2.oms.done_create")}>
              {t("cpv2.oms.create")}
            </Button>
          )}
          {!s.switchOn ? <p className="text-xs text-warn">{t("cpv2.oms.switch_off")}</p> : null}
        </div>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
