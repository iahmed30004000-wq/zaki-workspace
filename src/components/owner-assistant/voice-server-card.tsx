"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiGet, apiPut, ApiError } from "@/lib/api-client";
import { fmtNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  DEVICE_SETTING_AUTO,
  GPU_COMPOSE_FILE,
  HOSTED_SETTING_LOCAL,
  canChooseVoiceServer,
  cpuHelpKey,
  modelNameKey,
  needsCardSteps,
  transcriptButtonReason,
  type VoiceRunning,
  type VoiceServerStatus,
} from "@/lib/voice-server";

/**
 * «تحويل الصوت لنص على السيرفر» — the owner's card on the AI settings screen: what the voice program on HIS server is doing right now (read when the
 * screen opens and on «افحص مرة ثانية», never on a timer), ONE button that chooses it as the transcription service or lets it go, and, when «اكتب النص»
 * is not in the chat, why. Everything that is wrong or slower than it could be is a ⚠️ with its 🔧 under it. No address and no key appear here.
 */

/** A name the person must find outside this app (a file, a setting of the program): shown exactly as written there. */
function Chip({ children }: { children: string }) {
  return (
    <code dir="ltr" className="mx-1 inline-block select-all rounded-md border border-border bg-surface-2 px-1.5 text-xs text-fg">
      {children}
    </code>
  );
}

function WarnLines({ warn, fix, children }: { warn: string; fix: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm leading-7 text-warn">{warn}</p>
      <p className="text-sm leading-7 text-fg">
        {fix}
        {children}
      </p>
    </div>
  );
}

function Running({ agent }: { agent: VoiceRunning }) {
  const { t } = useI18n();
  const memory = agent.gpu?.memoryMb ? Math.round(agent.gpu.memoryMb / 1024) : null;
  return (
    <div className="space-y-2">
      <p className={`text-sm font-semibold ${agent.state === "gpu" ? "text-ok" : "text-fg"}`}>{t(agent.state === "gpu" ? "gpuVoice.on_gpu" : "gpuVoice.on_cpu")}</p>
      {agent.state === "gpu" && agent.gpu ? (
        <p className="text-sm text-fg">
          {t("gpuVoice.card_name")} <bdi dir="ltr">{agent.gpu.name}</bdi>
          {memory ? ` · ${t("gpuVoice.card_memory", { gb: fmtNumber(memory) })}` : null}
        </p>
      ) : null}
      <p className="text-sm text-fg">
        {t("gpuVoice.model_label")} {t(modelNameKey(agent.model))}
        {agent.model ? <Chip>{agent.model}</Chip> : null}
      </p>
      {agent.fallback ? <WarnLines warn={t("gpuVoice.fallback.warn")} fix={t("gpuVoice.fallback.fix")} /> : null}
      {agent.state === "cpu" ? (
        <WarnLines warn={t("gpuVoice.cpu.warn")} fix={t(cpuHelpKey(agent.reason))}>
          {agent.reason === "forced_cpu" ? <Chip>{DEVICE_SETTING_AUTO}</Chip> : null}
        </WarnLines>
      ) : null}
      {agent.state === "cpu" && needsCardSteps(agent.reason) ? (
        <div data-testid="voice-server-steps">
          <p className="text-sm text-fg">{t("gpuVoice.steps_title")}</p>
          <ol className="list-decimal space-y-1 ps-6 text-sm leading-7 text-fg">
            <li>{t("gpuVoice.step.driver")}</li>
            <li>
              {t("gpuVoice.step.compose")}
              <Chip>{GPU_COMPOSE_FILE}</Chip>
            </li>
            <li>{t("gpuVoice.step.redeploy")}</li>
          </ol>
          <p className="text-xs leading-6 text-muted">{t("gpuVoice.step.untried")}</p>
        </div>
      ) : null}
    </div>
  );
}

export function VoiceServerView({
  status,
  failed,
  busy,
  message,
  onToggle,
  onRefresh,
}: {
  /** null: not read yet. */
  status: VoiceServerStatus | null;
  failed: boolean;
  busy: boolean;
  message?: { ok: boolean; text: string } | null;
  onToggle: (on: boolean) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const agent = status?.agent ?? null;
  const selected = status?.source === "agent";
  const hosted = agent && (agent.state === "cpu" || agent.state === "gpu" || agent.state === "loading") && agent.hostedMeetings;
  const why = status ? transcriptButtonReason(status) : null;
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-card" aria-label={t("gpuVoice.title")} data-testid="voice-server" data-state={agent?.state ?? "checking"}>
      <h2 className="text-sm font-semibold">{t("gpuVoice.title")}</h2>
      <p className="text-sm leading-7 text-muted">{t("gpuVoice.hint")}</p>
      {failed ? (
        <p className="text-sm text-danger" role="alert">
          {t("gpuVoice.check_failed")}
        </p>
      ) : !agent ? (
        <p className="text-sm text-muted" role="status">
          {t("gpuVoice.checking")}
        </p>
      ) : agent.state === "cpu" || agent.state === "gpu" ? (
        <Running agent={agent} />
      ) : agent.state === "loading" ? (
        <p className="text-sm leading-7 text-fg" role="status">
          {t("gpuVoice.loading")}
        </p>
      ) : (
        <WarnLines warn={t(`gpuVoice.${agent.state}.warn`)} fix={t(`gpuVoice.${agent.state}.fix`)} />
      )}
      {hosted ? (
        <WarnLines warn={t("gpuVoice.hosted.warn")} fix={t("gpuVoice.hosted.fix")}>
          <Chip>{HOSTED_SETTING_LOCAL}</Chip>
        </WarnLines>
      ) : null}
      {selected ? <p className="text-sm font-medium text-ok">{t("gpuVoice.selected")}</p> : null}
      {why ? (
        <p className={`text-sm leading-7 ${why === "shown" ? "text-muted" : "text-warn"}`} data-testid="voice-server-why" data-why={why}>
          {t(`gpuVoice.why.${why}`)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={selected ? "secondary" : "primary"} disabled={busy || !status || (!selected && !canChooseVoiceServer(status.agent))} onClick={() => onToggle(!selected)} className="h-auto min-h-11 whitespace-normal py-2" data-testid="voice-server-toggle">
          {t(selected ? "gpuVoice.off_button" : "gpuVoice.on_button")}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onRefresh} data-testid="voice-server-refresh">
          {t("gpuVoice.refresh")}
        </Button>
      </div>
      {status && !selected && status.source !== null ? <p className="text-xs leading-6 text-muted">{t("gpuVoice.replaces")}</p> : null}
      {message ? (
        <p className={`text-sm ${message.ok ? "text-ok" : "text-danger"}`} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

/** The refusal's own sentence when the server sent one. */
function refusal(t: (key: string) => string, err: unknown): string {
  if (err instanceof ApiError) {
    const details = Array.isArray(err.details) ? (err.details as { message?: string }[]) : [];
    for (const d of details) if (d.message && t(d.message) !== d.message) return t(d.message);
  }
  return t("common.error");
}

export function VoiceServerCard({
  savedTimes,
  onSourceChange,
}: {
  /** how many times the screen's «حفظ» succeeded: the list below it may have changed the choice, so the card reads again */
  savedTimes: number;
  /** the card changed the saved choice: the screen's own list must follow, or its «حفظ» would put the old one back */
  onSourceChange: (source: VoiceServerStatus["source"]) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<VoiceServerStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await apiGet<VoiceServerStatus>("/api/owner-assistant/voice-server"));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, savedTimes]);

  const refresh = async () => {
    setBusy(true);
    setMessage(null);
    await load();
    setBusy(false);
  };

  const toggle = async (on: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiPut<{ settings: { transcribeSource: VoiceServerStatus["source"] } }>("/api/owner-assistant/settings", { transcribeSource: on ? "agent" : null });
      onSourceChange(res.settings.transcribeSource);
      setMessage({ ok: true, text: t(on ? "gpuVoice.turned_on" : "gpuVoice.turned_off") });
    } catch (err) {
      setMessage({ ok: false, text: refusal(t, err) });
    }
    await load();
    setBusy(false);
  };

  return <VoiceServerView status={status} failed={failed} busy={busy} message={message} onToggle={(on) => void toggle(on)} onRefresh={() => void refresh()} />;
}
