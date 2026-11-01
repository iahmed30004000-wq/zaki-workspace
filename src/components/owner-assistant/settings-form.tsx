"use client";

import Link from "next/link";
import { useState } from "react";
import { apiDelete, apiPut, ApiError } from "@/lib/api-client";
import { fmtNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { LocalPanel, localValueOf, type LocalValue } from "./local-panel";
import type { PublicSettings, UsageSummary } from "@/server/services/owner-assistant-settings";

/**
 * «مساعد المالك» — the settings screen. THE KEY FIELD IS WRITE-ONLY: it is masked, it is never filled in from the server, and
 * after saving the screen shows only «مفتاح محفوظ ••••xxxx» (the last four characters, computed when the key was saved) with
 * «تغيير المفتاح» and «احذف المفتاح». The key typed here is cleared from the page the moment it is sent.
 */

export interface SettingsFormProps {
  settings: PublicSettings;
  usage: UsageSummary;
  models: readonly string[];
}

const CUSTOM = "__custom__";

const errorText = (t: (k: string) => string, err: unknown) => (err instanceof ApiError && err.messageKey ? t(err.messageKey) : t("common.error"));

export function SettingsForm({ settings: initial, usage, models }: SettingsFormProps) {
  const { t } = useI18n();
  const [hasKey, setHasKey] = useState(initial.hasKey);
  const [last4, setLast4] = useState(initial.keyLast4);
  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const known = models.includes(initial.model);
  const [modelChoice, setModelChoice] = useState(known ? initial.model : CUSTOM);
  const [customModel, setCustomModel] = useState(known ? "" : initial.model);
  const [dailyLimit, setDailyLimit] = useState(String(initial.dailyLimit));
  const [budget, setBudget] = useState(String(initial.monthlyTokenBudget));
  const [allowNames, setAllowNames] = useState(initial.allowNames);
  const [allowTitles, setAllowTitles] = useState(initial.allowTitles);
  const [local, setLocal] = useState<LocalValue>(() => localValueOf(initial));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const saveKey = async () => {
    if (keyBusy || keyInput.trim() === "") return;
    setKeyBusy(true);
    setKeyMessage(null);
    try {
      const res = await apiPut<{ hasKey: boolean; keyLast4: string | null }>("/api/owner-assistant/key", { key: keyInput });
      setKeyInput("");
      setHasKey(res.hasKey);
      setLast4(res.keyLast4);
      setEditingKey(false);
      setKeyMessage({ ok: true, text: t("assistant.key.done") });
    } catch (err) {
      setKeyMessage({ ok: false, text: errorText(t, err) });
    } finally {
      setKeyBusy(false);
    }
  };

  const removeKey = async () => {
    if (keyBusy || !window.confirm(t("assistant.key.delete_confirm"))) return;
    setKeyBusy(true);
    setKeyMessage(null);
    try {
      const res = await apiDelete<{ hasKey: boolean; keyLast4: string | null }>("/api/owner-assistant/key");
      setKeyInput("");
      setHasKey(res.hasKey);
      setLast4(res.keyLast4);
      setEditingKey(false);
      setKeyMessage({ ok: true, text: t("assistant.key.removed") });
    } catch (err) {
      setKeyMessage({ ok: false, text: errorText(t, err) });
    } finally {
      setKeyBusy(false);
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiPut("/api/owner-assistant/settings", {
        model: modelChoice === CUSTOM ? customModel.trim() : modelChoice,
        dailyLimit: Number(dailyLimit),
        monthlyTokenBudget: Number(budget),
        allowNames,
        allowTitles,
        // «نموذج محلي»: an empty address or name clears it (the server judges the address: an internal host only)
        ownerProvider: local.ownerProvider,
        chatProvider: local.chatProvider,
        localBaseUrl: local.localBaseUrl.trim(),
        localModel: local.localModel.trim(),
        gatewayBaseUrl: local.gatewayBaseUrl.trim(),
        gatewayModel: local.gatewayModel.trim(),
        gatewayConfirmedLocal: local.gatewayConfirmedLocal,
        localRelaxRedaction: local.localRelaxRedaction,
      });
      setMessage({ ok: true, text: t("assistant.settings.saved") });
    } catch (err) {
      setMessage({ ok: false, text: errorText(t, err) });
    } finally {
      setSaving(false);
    }
  };

  const field = "rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-fg";
  const card = "space-y-3 rounded-xl border border-border bg-surface p-4 shadow-card";
  const showKeyField = !hasKey || editingKey;

  return (
    <div dir="rtl" className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("assistant.settings.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("assistant.settings.subtitle")}</p>
        </div>
        <Link href="/owner/assistant" className="text-sm text-info underline">
          {t("assistant.back_to_chat")}
        </Link>
      </header>

      <section className={card} aria-label={t("assistant.key.title")} data-testid="ai-key">
        <h2 className="text-sm font-semibold">{t("assistant.key.title")}</h2>
        <p className="text-sm leading-7 text-muted">{t("assistant.key.hint")}</p>
        {hasKey ? (
          <p className="text-sm font-medium text-ok" data-testid="ai-key-saved">
            {t("assistant.key.saved", { last4: last4 ?? "" })}
          </p>
        ) : (
          <p className="text-sm text-muted" data-testid="ai-key-none">
            {t("assistant.key.none")}
          </p>
        )}
        {showKeyField ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
              {t("assistant.key.label")}
              <input type="password" autoComplete="off" spellCheck={false} dir="ltr" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} className={`${field} text-start`} data-testid="ai-key-input" />
            </label>
            <button type="button" onClick={saveKey} disabled={keyBusy || keyInput.trim() === ""} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50" data-testid="ai-key-save">
              {t("assistant.key.save")}
            </button>
            {hasKey ? (
              <button
                type="button"
                onClick={() => {
                  setEditingKey(false);
                  setKeyInput("");
                }}
                className="rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm"
              >
                {t("assistant.key.cancel")}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditingKey(true)} className="rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm" data-testid="ai-key-change">
              {t("assistant.key.change")}
            </button>
            <button type="button" onClick={removeKey} disabled={keyBusy} className="rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm text-danger" data-testid="ai-key-delete">
              {t("assistant.key.delete")}
            </button>
          </div>
        )}
        {keyMessage ? (
          <p className={`text-sm ${keyMessage.ok ? "text-ok" : "text-danger"}`} role={keyMessage.ok ? "status" : "alert"}>
            {keyMessage.text}
          </p>
        ) : null}
      </section>

      <section className={card} aria-label={t("assistant.model.title")}>
        <h2 className="text-sm font-semibold">{t("assistant.model.title")}</h2>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("assistant.model.label")}
          <select value={modelChoice} onChange={(e) => setModelChoice(e.target.value)} className={field} data-testid="ai-model">
            {models.map((id) => (
              <option key={id} value={id}>
                {t(`assistant.model.${id}`)}
              </option>
            ))}
            <option value={CUSTOM}>{t("assistant.model.custom")}</option>
          </select>
        </label>
        {modelChoice === CUSTOM ? (
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("assistant.model.custom_label")}
            <input type="text" dir="ltr" spellCheck={false} value={customModel} onChange={(e) => setCustomModel(e.target.value)} className={`${field} text-start`} data-testid="ai-model-custom" />
          </label>
        ) : null}
      </section>

      <LocalPanel value={local} onChange={(patch) => setLocal((v) => ({ ...v, ...patch }))} saved={initial} hasGatewayKey={initial.hasGatewayKey} gatewayKeyLast4={initial.gatewayKeyLast4} />

      <section className={card} aria-label={t("assistant.limits.title")}>
        <h2 className="text-sm font-semibold">{t("assistant.limits.title")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("assistant.limits.daily")}
            <input type="number" min={1} max={10000} step={1} inputMode="numeric" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} className={field} data-testid="ai-daily" />
            <span>{t("assistant.limits.daily_hint")}</span>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("assistant.limits.budget")}
            <input type="number" min={0} max={100000000} step={1000} inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} className={field} data-testid="ai-budget" />
            <span>{t("assistant.limits.budget_hint")}</span>
          </label>
        </div>
        <p className="text-xs text-muted">
          {t("assistant.usage.today", { used: fmtNumber(usage.requestsToday), limit: fmtNumber(usage.dailyLimit) })} · {t("assistant.usage.month", { used: fmtNumber(usage.tokensThisMonth), budget: fmtNumber(usage.monthlyTokenBudget) })}
        </p>
      </section>

      <section className={card} aria-label={t("assistant.privacy_switches.title")}>
        <h2 className="text-sm font-semibold">{t("assistant.privacy_switches.title")}</h2>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={allowNames} onChange={(e) => setAllowNames(e.target.checked)} className="mt-1 size-4" data-testid="ai-allow-names" />
          <span>
            <span className="font-medium">{t("assistant.allow_names")}</span>
            <span className="block text-xs leading-6 text-muted">{t("assistant.allow_names_hint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={allowTitles} onChange={(e) => setAllowTitles(e.target.checked)} className="mt-1 size-4" data-testid="ai-allow-titles" />
          <span>
            <span className="font-medium">{t("assistant.allow_titles")}</span>
            <span className="block text-xs leading-6 text-warn" data-testid="ai-titles-warning">
              {t("assistant.allow_titles_hint")}
            </span>
          </span>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-accent-fg disabled:opacity-50" data-testid="ai-save">
          {t("assistant.settings.save")}
        </button>
        {message ? (
          <span className={`text-sm ${message.ok ? "text-ok" : "text-danger"}`} role={message.ok ? "status" : "alert"}>
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
