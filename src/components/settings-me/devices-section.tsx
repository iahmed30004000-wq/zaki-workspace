"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AppDevices } from "@/components/app-link/app-link";
import { apiDelete, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { wipeChatCache } from "@/lib/chat/cache/wipe";
import { clearMirror } from "@/lib/device-prefs";
import { clearAllOutboxes } from "@/lib/chat/outbox/registry";
import { Group, WarnFix } from "@/components/settings-me/parts";

/**
 * C4.1 — «الأجهزة»: the Android app(s) paired with the account (`AppDevice`, the list of «ربط التطبيق» moved here), the browsers that receive notifications
 * (`PushSubscription`, with «افصل» = `DELETE /api/me/push/[id]`) and «اطلع من كل الأجهزة» (`POST /api/me/logout-everywhere`: ends every session of the person, THIS
 * device included — said on screen before the button is pressed, and the device's copy of the messages is wiped like at any sign-out).
 *
 * C4.2 — «الجلسات المفتوحة»: every device signed in to the account (`GET /api/me/sessions`, this one marked «هالجهاز») with «اطلع من هالجهاز» for ONE of them
 * (`DELETE /api/me/sessions/[id]`): that device is refused at its next request and the others keep working. Ending THIS device is a sign-out and says so first.
 */

/** The name of a browser the person will recognise, from its user agent: «كروم على ويندوز». Anything unknown is «متصفح ما بنعرف اسمه». */
export function browserLabelOf(userAgent: string | null | undefined, words: { unknown: string; on: string } = { unknown: "متصفح ما بنعرف اسمه", on: "على" }): string {
  const ua = userAgent ?? "";
  if (!ua) return words.unknown;
  const browser = /Edg\//.test(ua) ? "إيدج" : /OPR\/|Opera/.test(ua) ? "أوبرا" : /Firefox\//.test(ua) ? "فايرفوكس" : /SamsungBrowser\//.test(ua) ? "متصفح سامسونج" : /Chrome\/|CriOS\//.test(ua) ? "كروم" : /Safari\//.test(ua) ? "سفاري" : null;
  const system = /Android/.test(ua) ? "أندرويد" : /iPhone/.test(ua) ? "آيفون" : /iPad/.test(ua) ? "آيباد" : /Windows/.test(ua) ? "ويندوز" : /Mac OS X|Macintosh/.test(ua) ? "ماك" : /Linux|X11/.test(ua) ? "لينكس" : null;
  if (browser && system) return `${browser} ${words.on} ${system}`;
  return browser ?? system ?? words.unknown;
}

interface Subscription {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

function Browsers() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [list, setList] = useState<Subscription[] | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/me/push", { cache: "no-store", credentials: "same-origin" });
    if (res.ok) setList(((await res.json()) as { subscriptions: Subscription[] }).subscriptions);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    try {
      await apiDelete(`/api/me/push/${encodeURIComponent(id)}`);
      toast(t("settingsMe.v.browsers.removed"), "success");
    } catch {
      toast(t("settingsMe.failed"), "error");
    }
    await load();
  }

  if (list === null) return <p className="text-sm text-fg-muted">{t("settingsMe.loading")}</p>;
  if (list.length === 0) return <p className="text-sm text-fg-muted">{t("settingsMe.v.browsers.none")}</p>;
  return (
    <ul data-browsers className="space-y-2">
      {list.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
          <div className="min-w-[10rem] flex-1">
            <p className="truncate text-sm font-medium text-fg">{browserLabelOf(s.userAgent, { unknown: t("settingsMe.v.browsers.unknown"), on: "على" })}</p>
            <p className="text-xs text-fg-muted">{s.lastUsedAt ? t("settingsMe.v.browsers.last", { when: fmtDateTime(s.lastUsedAt) }) : t("settingsMe.v.browsers.never")}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => void remove(s.id)}>
            {t("settingsMe.v.browsers.remove")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** What a device leaves behind when the person signs out of it: nothing of the person stays queued or cached here for the next one. */
async function leaveThisDevice(): Promise<void> {
  await clearAllOutboxes();
  await wipeChatCache();
  clearMirror();
  window.location.href = "/login";
}

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
}

/** The label of a session's device: the Android app (its HTTP client says so) or a browser the person will recognise. */
export function sessionLabelOf(userAgent: string | null | undefined, words: { app: string; unknown: string; on: string }): string {
  if (userAgent && /okhttp/i.test(userAgent)) return words.app;
  return browserLabelOf(userAgent, { unknown: words.unknown, on: words.on });
}

function Sessions() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [list, setList] = useState<SessionRow[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch("/api/me/sessions", { cache: "no-store", credentials: "same-origin" });
    if (res.ok) setList(((await res.json()) as { sessions: SessionRow[] }).sessions);
    else setList([]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function end(row: SessionRow) {
    setBusy(true);
    try {
      await apiDelete(`/api/me/sessions/${encodeURIComponent(row.id)}`);
    } catch {
      toast(t("settingsMe.v.sessions.failed"), "error");
      setBusy(false);
      return;
    }
    if (row.current) {
      await leaveThisDevice();
      return;
    }
    toast(t("settingsMe.v.sessions.ended"), "success");
    setAsking(null);
    setBusy(false);
    await load();
  }

  if (list === null) return <p className="text-sm text-fg-muted">{t("settingsMe.loading")}</p>;
  if (list.length === 0) return <p className="text-sm text-fg-muted">{t("settingsMe.v.sessions.none")}</p>;
  const words = { app: t("settingsMe.v.sessions.app"), unknown: t("settingsMe.v.browsers.unknown"), on: t("settingsMe.v.sessions.on") };
  return (
    <ul data-sessions className="space-y-2">
      {list.map((s) => (
        <li key={s.id} data-session={s.current ? "current" : "other"} className="space-y-2 rounded-xl border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-[10rem] flex-1">
              <p className="truncate text-sm font-medium text-fg">
                {sessionLabelOf(s.userAgent, words)}
                {s.current ? <span className="ms-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">{t("settingsMe.v.sessions.current")}</span> : null}
              </p>
              <p className="text-xs text-fg-muted">{t("settingsMe.v.sessions.last", { when: fmtDateTime(s.lastSeenAt) })}</p>
              <p className="text-xs text-fg-muted">{t("settingsMe.v.sessions.since", { when: fmtDateTime(s.createdAt) })}</p>
            </div>
            {asking === s.id ? null : (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => (s.current ? setAsking(s.id) : void end(s))}>
                {t("settingsMe.v.sessions.end")}
              </Button>
            )}
          </div>
          {asking === s.id ? (
            <div role="alertdialog" aria-label={t("settingsMe.v.sessions.confirm")} className="space-y-2">
              <p className="text-sm text-fg">{t("settingsMe.v.sessions.confirm")}</p>
              <div className="flex gap-2">
                <Button type="button" variant="danger" disabled={busy} onClick={() => void end(s)}>
                  {t("settingsMe.v.everywhere.yes")}
                </Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setAsking(null)}>
                  {t("settingsMe.v.everywhere.cancel")}
                </Button>
              </div>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function LogoutEverywhere() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await apiPost("/api/me/logout-everywhere");
    } catch {
      toast(t("settingsMe.v.everywhere.failed"), "error");
      setBusy(false);
      return;
    }
    // this device signs out too
    await leaveThisDevice();
  }

  return (
    <div data-logout-everywhere className="space-y-3">
      <WarnFix warn={t("settingsMe.v.everywhere.warn")} fix={t("settingsMe.v.everywhere.fix")} />
      {asking ? (
        <div role="alertdialog" aria-label={t("settingsMe.v.everywhere.confirm")} className="space-y-2">
          <p className="text-sm text-fg">{t("settingsMe.v.everywhere.confirm")}</p>
          <div className="flex gap-2">
            <Button type="button" variant="danger" disabled={busy} onClick={() => void run()}>
              {t("settingsMe.v.everywhere.yes")}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
              {t("settingsMe.v.everywhere.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setAsking(true)}>
          {t("settingsMe.v.everywhere")}
        </Button>
      )}
    </div>
  );
}

export function DevicesSection({ appConnection }: { appConnection: boolean }) {
  const { t } = useI18n();
  return (
    <div data-section-body="devices">
      <Group title={t("settingsMe.v.apps")} hint={t("settingsMe.v.apps.hint")} id="v-apps">
        {appConnection ? (
          <div className="space-y-3">
            <AppDevices showHeading={false} />
            <Link href="/app-link" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-fg hover:bg-surface-2">
              {t("settingsMe.v.apps.pair")}
            </Link>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{t("settingsMe.v.apps.off")}</p>
        )}
      </Group>
      <Group title={t("settingsMe.v.browsers")} hint={t("settingsMe.v.browsers.hint")} id="v-browsers">
        <Browsers />
      </Group>
      <Group title={t("settingsMe.v.sessions")} hint={t("settingsMe.v.sessions.hint")} id="v-sessions">
        <Sessions />
      </Group>
      <Group title={t("settingsMe.v.everywhere")} hint={t("settingsMe.v.everywhere.hint")} id="v-everywhere">
        <LogoutEverywhere />
      </Group>
    </div>
  );
}
