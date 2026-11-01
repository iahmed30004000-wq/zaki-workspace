"use client";

import { useState } from "react";
import { apiDelete, apiPost, apiPut, ApiError } from "@/lib/api-client";
import { fmtNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ProviderKind } from "@/server/ai/registry";
import type { ProbeResult } from "@/server/ai/local-provider";
import type { PublicSettings } from "@/server/services/owner-assistant-settings";

/**
 * «نموذج محلي» — the part of the settings screen that chooses WHICH MODEL each assistant uses and where the local one lives.
 *
 *   - A provider per assistant: Claude (the external model), «محلي» (Ollama on the owner's own server) or an OpenAI-compatible gateway.
 *   - The address and the name of each local model. The address is judged by the SERVER (an internal host only); the screen only says so.
 *   - «اختبر الاتصال»: lists the installed models, pings the named one with 5 tokens and shows the time. Clicking a listed model fills its name.
 *   - The gateway's optional key is write-only, exactly like the Claude key: typed once, never shown again, only its last four characters.
 *   - The privacy switches, each with its ⚠️ and its 🔧 in sight: the relaxed filter (local only) and the «the model behind the
 *     gateway is local» confirmation (without it a gateway is treated as an external model and the filter stays on).
 */

export interface LocalValue {
  ownerProvider: ProviderKind;
  chatProvider: ProviderKind;
  localBaseUrl: string;
  localModel: string;
  gatewayBaseUrl: string;
  gatewayModel: string;
  gatewayConfirmedLocal: boolean;
  localRelaxRedaction: boolean;
}

export const localValueOf = (s: PublicSettings): LocalValue => ({
  ownerProvider: s.ownerProvider,
  chatProvider: s.chatProvider,
  localBaseUrl: s.localBaseUrl ?? "",
  localModel: s.localModel ?? "",
  gatewayBaseUrl: s.gatewayBaseUrl ?? "",
  gatewayModel: s.gatewayModel ?? "",
  gatewayConfirmedLocal: s.gatewayConfirmedLocal,
  localRelaxRedaction: s.localRelaxRedaction,
});

type TestResponse = ProbeResult & { provider: "ollama" | "openai" };

const errorText = (t: (k: string) => string, err: unknown) => (err instanceof ApiError && err.messageKey ? t(err.messageKey) : t("common.error"));
const PROVIDERS: readonly ProviderKind[] = ["claude", "ollama", "openai"];

export function LocalPanel({ value, onChange, saved, hasGatewayKey: initialHasKey, gatewayKeyLast4: initialLast4 }: { value: LocalValue; onChange: (patch: Partial<LocalValue>) => void; saved: PublicSettings; hasGatewayKey: boolean; gatewayKeyLast4: string | null }) {
  const { t } = useI18n();
  const field = "rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-fg";
  const card = "space-y-3 rounded-xl border border-border bg-surface p-4 shadow-card";

  const [hasKey, setHasKey] = useState(initialHasKey);
  const [last4, setLast4] = useState(initialLast4);
  const [keyInput, setKeyInput] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState<"ollama" | "openai" | null>(null);
  const [result, setResult] = useState<{ provider: "ollama" | "openai"; data: TestResponse } | null>(null);
  const [testError, setTestError] = useState<{ provider: "ollama" | "openai"; text: string } | null>(null);

  const anyLocal = value.ownerProvider !== "claude" || value.chatProvider !== "claude";

  const test = async (provider: "ollama" | "openai") => {
    if (testing) return;
    setTesting(provider);
    setResult(null);
    setTestError(null);
    try {
      const body = provider === "ollama" ? { provider, baseUrl: value.localBaseUrl, model: value.localModel } : { provider, baseUrl: value.gatewayBaseUrl, model: value.gatewayModel };
      setResult({ provider, data: await apiPost<TestResponse>("/api/owner-assistant/local/test", body) });
    } catch (err) {
      setTestError({ provider, text: errorText(t, err) });
    } finally {
      setTesting(null);
    }
  };

  const saveKey = async () => {
    if (keyBusy || keyInput.trim() === "") return;
    setKeyBusy(true);
    setKeyMessage(null);
    try {
      const res = await apiPut<{ hasGatewayKey: boolean; gatewayKeyLast4: string | null }>("/api/owner-assistant/local/key", { key: keyInput });
      setKeyInput("");
      setHasKey(res.hasGatewayKey);
      setLast4(res.gatewayKeyLast4);
      setKeyMessage({ ok: true, text: t("localai.gateway.key_done") });
    } catch (err) {
      setKeyMessage({ ok: false, text: errorText(t, err) });
    } finally {
      setKeyBusy(false);
    }
  };

  const removeKey = async () => {
    if (keyBusy || !window.confirm(t("localai.gateway.key_delete_confirm"))) return;
    setKeyBusy(true);
    setKeyMessage(null);
    try {
      const res = await apiDelete<{ hasGatewayKey: boolean; gatewayKeyLast4: string | null }>("/api/owner-assistant/local/key");
      setHasKey(res.hasGatewayKey);
      setLast4(res.gatewayKeyLast4);
      setKeyMessage({ ok: true, text: t("localai.gateway.key_removed") });
    } catch (err) {
      setKeyMessage({ ok: false, text: errorText(t, err) });
    } finally {
      setKeyBusy(false);
    }
  };

  const failure = (provider: "ollama" | "openai") =>
    testError && testError.provider === provider ? (
      <p className="text-sm text-danger" role="alert" data-testid={`ai-test-error-${provider}`}>
        {testError.text}
      </p>
    ) : null;

  const outcome = (provider: "ollama" | "openai", model: string) => {
    if (!result || result.provider !== provider) return null;
    const r = result.data;
    return (
      <div className="space-y-1 rounded-lg border border-border bg-surface-1 p-3 text-sm" role="status" data-testid={`ai-test-result-${provider}`}>
        <p className="text-ok">{t("localai.test.listed", { ms: fmtNumber(r.listMs), count: fmtNumber(r.models.length) })}</p>
        {model ? <p className={r.installed === false ? "text-warn" : "text-ok"}>{r.installed === false ? t("localai.test.not_installed", { model }) : r.installed === true ? t("localai.test.installed", { model }) : null}</p> : null}
        {r.ping ? (
          r.ping.ok ? (
            <p className="text-ok" data-testid="ai-test-ping">{t("localai.test.ping_ok", { ms: fmtNumber(r.ping.ms) })}</p>
          ) : (
            <p className="text-danger">
              {t("localai.test.ping_failed")} {t(r.ping.key)}
            </p>
          )
        ) : null}
        <p className="text-xs text-muted">{r.models.length > 0 ? t("localai.test.models") : t("localai.test.none")}</p>
        {r.models.length > 0 ? (
          <div className="flex flex-wrap gap-2" dir="ltr">
            {r.models.map((name) => (
              <button key={name} type="button" onClick={() => onChange(provider === "ollama" ? { localModel: name } : { gatewayModel: name })} className="rounded-full border border-border bg-surface px-3 py-1 text-xs">
                {name}
              </button>
            ))}
          </div>
        ) : null}
        <p className="text-xs text-muted">{t("localai.test.cpu_note")}</p>
      </div>
    );
  };

  return (
    <>
      <section className={card} aria-label={t("localai.provider.title")} data-testid="ai-providers">
        <h2 className="text-sm font-semibold">{t("localai.title")}</h2>
        <p className="text-sm leading-7 text-muted">{t("localai.intro")}</p>
        <h3 className="text-sm font-medium">{t("localai.provider.title")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("localai.provider.owner")}
            <select value={value.ownerProvider} onChange={(e) => onChange({ ownerProvider: e.target.value as ProviderKind })} className={field} data-testid="ai-provider-owner">
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`localai.provider.${p}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("localai.provider.chat")}
            <select value={value.chatProvider} onChange={(e) => onChange({ chatProvider: e.target.value as ProviderKind })} className={field} data-testid="ai-provider-chat">
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`localai.provider.${p}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted">{t("localai.provider.hint")}</p>
        {anyLocal ? (
          <p className="text-xs leading-6 text-warn" data-testid="ai-queue-note">
            {t("localai.queue_note")}
          </p>
        ) : null}
      </section>

      <section className={card} aria-label={t("localai.ollama.title")} data-testid="ai-ollama">
        <h2 className="text-sm font-semibold">{t("localai.ollama.title")}</h2>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("localai.url.label")}
          <input type="text" dir="ltr" spellCheck={false} autoComplete="off" placeholder="http://ollama:11434" value={value.localBaseUrl} onChange={(e) => onChange({ localBaseUrl: e.target.value })} className={`${field} text-start`} data-testid="ai-local-url" />
          <span>{t("localai.url.hint")}</span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("localai.model.label")}
          <input type="text" dir="ltr" spellCheck={false} autoComplete="off" placeholder="qwen2.5:3b-instruct" value={value.localModel} onChange={(e) => onChange({ localModel: e.target.value })} className={`${field} text-start`} data-testid="ai-local-model" />
          <span>{t("localai.model.hint")}</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => test("ollama")} disabled={testing !== null || value.localBaseUrl.trim() === ""} className="rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm disabled:opacity-50" data-testid="ai-test-ollama">
            {testing === "ollama" ? t("localai.test.running") : t("localai.test.button")}
          </button>
          <span className="text-xs text-muted">{t("localai.test.save_hint")}</span>
        </div>
        {outcome("ollama", value.localModel.trim())}
        {failure("ollama")}
      </section>

      <section className={card} aria-label={t("localai.gateway.title")} data-testid="ai-gateway">
        <h2 className="text-sm font-semibold">{t("localai.gateway.title")}</h2>
        <p className="text-xs leading-6 text-warn" data-testid="ai-gateway-warning">
          {t("localai.gateway.hint")}
        </p>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("localai.url.label")}
          <input
            type="text"
            dir="ltr"
            spellCheck={false}
            autoComplete="off"
            placeholder="http://hermes:8642"
            value={value.gatewayBaseUrl}
            // a confirmation belongs to ONE address: a different one starts unconfirmed
            onChange={(e) => onChange({ gatewayBaseUrl: e.target.value, ...(e.target.value.trim() !== (saved.gatewayBaseUrl ?? "") ? { gatewayConfirmedLocal: false } : {}) })}
            className={`${field} text-start`}
            data-testid="ai-gateway-url"
          />
          <span>{t("localai.gateway.url_hint")}</span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("localai.model.label")}
          <input type="text" dir="ltr" spellCheck={false} autoComplete="off" value={value.gatewayModel} onChange={(e) => onChange({ gatewayModel: e.target.value })} className={`${field} text-start`} data-testid="ai-gateway-model" />
        </label>
        <div className="space-y-2" data-testid="ai-gateway-key">
          <h3 className="text-xs font-medium">{t("localai.gateway.key_title")}</h3>
          <p className="text-xs leading-6 text-muted">{t("localai.gateway.key_hint")}</p>
          <p className={`text-sm ${hasKey ? "font-medium text-ok" : "text-muted"}`}>{hasKey ? t("localai.gateway.key_saved", { last4: last4 ?? "" }) : t("localai.gateway.key_none")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <input type="password" autoComplete="off" spellCheck={false} dir="ltr" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} className={`${field} flex-1 text-start`} aria-label={t("localai.gateway.key_title")} data-testid="ai-gateway-key-input" />
            <button type="button" onClick={saveKey} disabled={keyBusy || keyInput.trim() === ""} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50" data-testid="ai-gateway-key-save">
              {t("assistant.key.save")}
            </button>
            {hasKey ? (
              <button type="button" onClick={removeKey} disabled={keyBusy} className="rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm text-danger">
                {t("assistant.key.delete")}
              </button>
            ) : null}
          </div>
          {keyMessage ? (
            <p className={`text-sm ${keyMessage.ok ? "text-ok" : "text-danger"}`} role={keyMessage.ok ? "status" : "alert"}>
              {keyMessage.text}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => test("openai")} disabled={testing !== null || value.gatewayBaseUrl.trim() === ""} className="rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm disabled:opacity-50" data-testid="ai-test-openai">
            {testing === "openai" ? t("localai.test.running") : t("localai.test.button")}
          </button>
        </div>
        {outcome("openai", value.gatewayModel.trim())}
        {failure("openai")}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={value.gatewayConfirmedLocal} onChange={(e) => onChange({ gatewayConfirmedLocal: e.target.checked })} className="mt-1 size-4" data-testid="ai-gateway-confirm" />
          <span>
            <span className="font-medium">{t("localai.gateway.confirm")}</span>
            <span className="block text-xs leading-6 text-warn" data-testid="ai-gateway-confirm-warning">
              {t("localai.gateway.confirm_hint")}
            </span>
          </span>
        </label>
      </section>

      <section className={card} aria-label={t("localai.relax.title")} data-testid="ai-relax">
        <h2 className="text-sm font-semibold">{t("localai.relax.title")}</h2>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={value.localRelaxRedaction} onChange={(e) => onChange({ localRelaxRedaction: e.target.checked })} className="mt-1 size-4" data-testid="ai-relax-switch" />
          <span>
            <span className="font-medium">{t("localai.relax.label")}</span>
            <span className="block text-xs leading-6 text-muted">{t("localai.relax.hint")}</span>
            <span className="block text-xs leading-6 text-warn" data-testid="ai-relax-warning">
              {t("localai.relax.warn")}
            </span>
            <span className="block text-xs leading-6 text-muted">{t("localai.relax.gateway_needs")}</span>
          </span>
        </label>
      </section>
    </>
  );
}
