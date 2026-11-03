"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, ApiError } from "@/lib/api-client";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_FOLDER, DEFAULT_PORT_SSL, DEFAULT_PORT_STARTTLS } from "@/lib/mail-to-task";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type State = "none" | "off" | "starting" | "running" | "disabled";

interface MailAnswer {
  switchOn: boolean;
  keyConfigured: boolean;
  passwordSaved: boolean;
  config: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    folder: string;
    workspaceId: string;
    projectId: string;
    assigneeId: string | null;
    allowList: string[];
    markSeen: boolean;
  } | null;
  state: State;
  failures: number;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastErrorKey: string | null;
  createdCount: number;
  skippedCount: number;
  spaces: { id: string; name: string; projects: { id: string; name: string }[] }[];
  people: { id: string; name: string }[];
}

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * «بريد يصير مهمة» (src/server/services/mail-to-task.ts), under «الأتمتة», for the OWNER alone: the switch, the mailbox settings, the place
 * the tasks go to, «افحص الاتصال», and the state (running, failing, or «تعطّل»). The password is typed here by the owner and is never shown
 * again: the card only says «محفوظة». Every risk is shown as ⚠️ with its fix as 🔧.
 */
export function MailToTaskCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["mail-to-task"], queryFn: () => apiGet<MailAnswer>("/api/integrations/mail-to-task") });
  const data = state.data;

  const [host, setHost] = useState("");
  const [port, setPort] = useState(String(DEFAULT_PORT_SSL));
  const [secure, setSecure] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [allow, setAllow] = useState("");
  const [markSeen, setMarkSeen] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  useEffect(() => {
    const c = data?.config;
    if (!c) return;
    setHost(c.host);
    setPort(String(c.port));
    setSecure(c.secure);
    setUsername(c.username);
    setFolder(c.folder);
    setWorkspaceId(c.workspaceId);
    setProjectId(c.projectId);
    setAssigneeId(c.assigneeId ?? "");
    setAllow(c.allowList.join("\n"));
    setMarkSeen(c.markSeen);
  }, [data?.config]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => qc.invalidateQueries({ queryKey: ["mail-to-task"] });

  const body = () => ({
    host: host.trim(),
    port: Number(port),
    secure,
    username: username.trim(),
    ...(password !== "" ? { password } : {}),
    folder: folder.trim() === "" ? DEFAULT_FOLDER : folder.trim(),
    workspaceId,
    projectId,
    assigneeId: assigneeId === "" ? null : assigneeId,
    allowList: allow.split(/[\s,;]+/).filter((s) => s !== ""),
    markSeen,
  });

  const flip = useMutation({
    mutationFn: (on: boolean) => apiPatch("/api/settings/features", { key: "emailToTask", on }),
    onSuccess: () => {
      toast(t("mail.switch.changed"), "success");
      void refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });
  const save = useMutation({
    mutationFn: () => apiPut("/api/integrations/mail-to-task", body()),
    onSuccess: () => {
      // the password leaves the form the moment it is saved
      setPassword("");
      setTested(null);
      toast(t("mail.saved"), "success");
      void refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });
  const test = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; count?: number; reasonKey?: string }>("/api/integrations/mail-to-task/test", body()),
    onSuccess: (r) => setTested(r.ok ? t("mail.test.ok", { count: fmtNumber(r.count ?? 0) }) : t(r.reasonKey ?? "mail.err.unknown")),
    onError: (err) => setTested(errText(err, t)),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete("/api/integrations/mail-to-task"),
    onSuccess: () => {
      setHost("");
      setUsername("");
      setPassword("");
      setAllow("");
      setTested(null);
      toast(t("mail.removed"), "success");
      void refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const space = data?.spaces.find((s) => s.id === workspaceId) ?? null;
  const portNumber = Number(port);
  const complete =
    host.trim() !== "" &&
    username.trim() !== "" &&
    workspaceId !== "" &&
    projectId !== "" &&
    Number.isInteger(portNumber) &&
    portNumber >= 1 &&
    portNumber <= 65535 &&
    (password !== "" || data?.passwordSaved === true);
  const active = data?.switchOn === true;
  const busy = save.isPending || test.isPending || remove.isPending;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface-1 p-5" aria-labelledby="mail-title">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-cat-3/10 text-cat-3">
          <MailPlus className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="mail-title" className="text-sm font-semibold">
            {t("mail.title")}
          </h2>
          <p className="text-xs text-muted">{t("mail.subtitle")}</p>
        </div>
        {data ? <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{t(`mail.state.${data.state}`)}</span> : null}
        {data ? (
          <Button type="button" size="sm" variant={data.switchOn ? "secondary" : "primary"} disabled={flip.isPending} onClick={() => flip.mutate(!data.switchOn)}>
            {t(data.switchOn ? "mail.switch.turn_off" : "mail.switch.turn_on")}
          </Button>
        ) : null}
      </div>

      <Notice warn={t("mail.warn")} fix={t("mail.fix")} />
      {data && !data.switchOn ? <Notice warn={t("mail.off.warn")} fix={t("mail.off.fix")} /> : null}
      {data && !data.keyConfigured ? <Notice warn={t("mail.no_key.warn")} fix={t("mail.no_key.fix")} /> : null}
      {data && data.state === "disabled" ? (
        <Notice warn={t("mail.disabled.warn", { n: fmtNumber(data.failures), reason: t(data.lastErrorKey ?? "mail.err.unknown") })} fix={t("mail.disabled.fix")} />
      ) : null}
      {data && data.state !== "disabled" && data.failures > 0 ? (
        <p className="text-xs text-warn">{t("mail.failing", { n: fmtNumber(data.failures), reason: t(data.lastErrorKey ?? "mail.err.unknown") })}</p>
      ) : null}

      {data && data.config ? (
        <div className="space-y-1 text-xs text-muted">
          <p>{data.lastOkAt ? t("mail.last_ok", { when: fmtDateTime(data.lastOkAt) }) : t("mail.last_ok_none")}</p>
          <p>{t("mail.counts", { created: fmtNumber(data.createdCount), skipped: fmtNumber(data.skippedCount) })}</p>
        </div>
      ) : null}

      {data && active ? (
        <form
          className="space-y-4 rounded-lg border border-border bg-surface-2/40 p-3"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            if (complete && !busy) save.mutate();
          }}
        >
          <h3 className="text-xs font-semibold">{t("mail.section.connection")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs sm:col-span-2">
              <span className="font-medium text-fg">{t("mail.host")}</span>
              <Input dir="ltr" value={host} maxLength={253} onChange={(e) => setHost(e.target.value)} autoComplete="off" />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("mail.security")}</span>
              <Select
                value={secure ? "ssl" : "starttls"}
                onChange={(e) => {
                  const next = e.target.value === "ssl";
                  setSecure(next);
                  // the usual port follows the choice while the owner has not typed another one
                  if (port === String(DEFAULT_PORT_SSL) || port === String(DEFAULT_PORT_STARTTLS)) setPort(String(next ? DEFAULT_PORT_SSL : DEFAULT_PORT_STARTTLS));
                }}
              >
                <option value="ssl">{t("mail.security.ssl")}</option>
                <option value="starttls">{t("mail.security.starttls")}</option>
              </Select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("mail.port")}</span>
              <Input dir="ltr" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("mail.username")}</span>
              <Input dir="ltr" value={username} maxLength={254} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("mail.password")}</span>
              <Input
                dir="ltr"
                type="password"
                value={password}
                maxLength={256}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={data.passwordSaved ? t("mail.password.saved") : ""}
              />
              <span className="block text-muted">{data.passwordSaved ? t("mail.password.keep") : t("mail.password.hint")}</span>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("mail.folder")}</span>
              <Input dir="ltr" value={folder} maxLength={120} onChange={(e) => setFolder(e.target.value)} />
            </label>
          </div>

          <h3 className="text-xs font-semibold">{t("mail.section.destination")}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("mail.space")}</span>
              <Select
                value={workspaceId}
                onChange={(e) => {
                  setWorkspaceId(e.target.value);
                  setProjectId("");
                }}
              >
                <option value="">{t("mail.pick")}</option>
                {data.spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("mail.project")}</span>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!space}>
                <option value="">{t("mail.pick")}</option>
                {(space?.projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("mail.assignee")}</span>
              <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">{t("mail.assignee.nobody")}</option>
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <label className="block space-y-1 text-xs">
            <span className="font-medium text-fg">{t("mail.allow")}</span>
            <Textarea dir="ltr" rows={3} value={allow} onChange={(e) => setAllow(e.target.value)} />
            <span className="block text-muted">{t("mail.allow.hint")}</span>
          </label>

          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={markSeen} onChange={(e) => setMarkSeen(e.target.checked)} />
            <span>
              <span className="block font-medium text-fg">{t("mail.mark_seen")}</span>
              <span className="block text-muted">{t("mail.mark_seen.hint")}</span>
            </span>
          </label>

          <p className="text-xs text-muted">{t("mail.starts_note")}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!complete || busy || !data.keyConfigured}>
              {t("mail.save")}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={!complete || busy} onClick={() => test.mutate()}>
              {test.isPending ? t("mail.testing") : t("mail.test")}
            </Button>
            {data.config ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("mail.remove.confirm"))) remove.mutate();
                }}
              >
                {t("mail.remove")}
              </Button>
            ) : null}
          </div>
          {tested ? (
            <p role="status" className="text-xs text-fg">
              {tested}
            </p>
          ) : null}
        </form>
      ) : null}

      {data && !active && data.config ? (
        <Button type="button" size="sm" variant="secondary" disabled={remove.isPending} onClick={() => window.confirm(t("mail.remove.confirm")) && remove.mutate()}>
          {t("mail.remove")}
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
    // a refusal of the save carries its dictionary key in the first issue
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
