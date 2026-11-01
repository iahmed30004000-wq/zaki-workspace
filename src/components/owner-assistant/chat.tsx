"use client";

import Link from "next/link";
import { useState } from "react";
import { apiDelete, apiPost, ApiError } from "@/lib/api-client";
import { fmtNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { ProposalCard } from "./proposal-card";
import type { ChatResult, ConversationItem, MaskReport, MessageView } from "@/server/services/owner-assistant-chat";
import type { UsageSummary } from "@/server/services/owner-assistant-settings";

/**
 * «مساعد المالك» — the conversation screen (owner only; the page decides who sees it).
 *
 * What is on it: the messages (the owner's questions as they were SENT, after the filter; the answers with real names put back by
 * the server), a «شو انبعت للنموذج» expander under every answer with the exact request, a proposal card for every suggestion
 * («وافق» / «ارفض»), the four quick questions, the window and space that scope the data (the board's filters, at most 92 days),
 * the usage meter, «امسح المحادثة», and a plain note about what the filter can and cannot see.
 */

export interface ChatScreenProps {
  conversationId: string | null;
  title: string;
  messages: MessageView[];
  conversations: ConversationItem[];
  spaces: { id: string; name: string }[];
  /** The chosen model is ready (Claude: a key is saved; a local one: its address and name are). */
  hasKey: boolean;
  usage: UsageSummary;
  /** A local model answers this assistant (`model` is its name, `relaxed` says the filter is loosened for it). */
  local?: { model: string; relaxed: boolean } | null;
}

const QUICK = ["assistant.quick.week", "assistant.quick.late", "assistant.quick.redistribute", "assistant.quick.risks"] as const;
const RANGES = [
  { key: "today", label: "ownerboard.filter.today" },
  { key: "7", label: "ownerboard.filter.d7" },
  { key: "14", label: "ownerboard.filter.d14" },
  { key: "30", label: "ownerboard.filter.d30" },
  { key: "custom", label: "ownerboard.filter.custom" },
] as const;

const KIND_LABEL: Record<string, string> = {
  phone: "assistant.masked.phone",
  email: "assistant.masked.email",
  url: "assistant.masked.url",
  handle: "assistant.masked.handle",
  id: "assistant.masked.id",
  secret: "assistant.masked.secret",
};

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div className="min-w-[10rem] flex-1">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={`h-full ${pct >= 90 ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** What the filter masked, in words: «اتنقّت بياناتك قبل الإرسال: 2 أرقام، 1 روابط». Nothing when nothing was masked. */
export function MaskedNote({ report }: { report: MaskReport | null }) {
  const { t } = useI18n();
  if (!report || report.total === 0) return null;
  const parts = [
    ...Object.entries(report.masked).filter(([, n]) => n > 0).map(([kind, n]) => `${fmtNumber(n)} ${t(KIND_LABEL[kind] ?? "assistant.masked.id")}`),
    ...(report.names > 0 ? [`${fmtNumber(report.names)} ${t("assistant.masked.names")}`] : []),
    ...(report.titles > 0 ? [`${fmtNumber(report.titles)} ${t("assistant.masked.titles")}`] : []),
  ];
  return (
    <p className="rounded-lg border border-info/40 bg-info/10 px-3 py-1.5 text-xs text-info" role="status" data-testid="ai-masked">
      {t("assistant.masked.title")}: {parts.join("، ")}
    </p>
  );
}

function SentView({ sent }: { sent: string }) {
  const { t } = useI18n();
  return (
    <details className="rounded-lg border border-border bg-surface-1 p-2 text-xs" data-testid="ai-sent">
      <summary className="cursor-pointer font-medium text-muted">{t("assistant.sent.toggle")}</summary>
      <p className="mt-2 text-muted">{t("assistant.sent.hint")}</p>
      <pre dir="ltr" className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface p-2 text-start text-xs leading-5">
        {sent}
      </pre>
    </details>
  );
}

export function ChatScreen(props: ChatScreenProps) {
  const { t } = useI18n();
  const [conversationId, setConversationId] = useState(props.conversationId);
  const [messages, setMessages] = useState<MessageView[]>(props.messages);
  const [reports, setReports] = useState<Record<string, MaskReport>>({});
  const [input, setInput] = useState("");
  const [range, setRange] = useState("14");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [space, setSpace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState(props.usage);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    try {
      const custom = range === "custom";
      const res = await apiPost<ChatResult>("/api/owner-assistant/chat", {
        message,
        ...(conversationId ? { conversationId } : {}),
        ...(custom ? { from, to } : { range }),
        ...(space ? { space } : {}),
      });
      setConversationId(res.conversationId);
      setMessages((list) => [...list, res.user, res.answer]);
      setReports((r) => ({ ...r, [res.answer.id]: res.report }));
      setUsage(res.usage);
      setInput("");
    } catch (err) {
      setError(err instanceof ApiError && err.messageKey ? t(err.messageKey) : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!conversationId || !window.confirm(t("assistant.clear_confirm"))) return;
    try {
      await apiDelete(`/api/owner-assistant/conversations/${conversationId}`);
      setMessages([]);
      setConversationId(null);
      setReports({});
      window.history.replaceState(null, "", "/owner/assistant");
    } catch (err) {
      setError(err instanceof ApiError && err.messageKey ? t(err.messageKey) : t("common.error"));
    }
  };

  return (
    <div dir="rtl" className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("assistant.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("assistant.subtitle")}</p>
        </div>
        <Link href="/owner/assistant/settings" className="text-sm text-info underline" data-testid="ai-settings-link">
          {t("assistant.settings_link")}
        </Link>
      </header>

      {!props.hasKey ? (
        <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status" data-testid="ai-no-key">
          {t(props.local ? "assistant.no_local_notice" : "assistant.no_key_notice")}{" "}
          <Link href="/owner/assistant/settings" className="underline">
            {t("assistant.settings_link")}
          </Link>
        </p>
      ) : null}

      {props.local ? (
        <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm leading-7 text-warn" role="note" data-testid="ai-local-note">
          {t("localai.chat_note", { model: props.local.model })}
          {props.local.relaxed ? ` ${t("localai.chat_note_relaxed")}` : ""}
        </p>
      ) : null}

      <details className="rounded-xl border border-border bg-surface p-3 text-sm shadow-card" data-testid="ai-privacy">
        <summary className="cursor-pointer font-medium">{t("assistant.privacy.title")}</summary>
        <p className="mt-2 leading-7 text-muted">{t("assistant.privacy.body")}</p>
        <p className="mt-1 leading-7 text-muted">{t("assistant.privacy.limit")}</p>
      </details>

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3 shadow-card" aria-label={t("assistant.scope.title")} data-testid="ai-scope">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("ownerboard.filter.range")}
          <select value={range} onChange={(e) => setRange(e.target.value)} className="rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg">
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {t(r.label)}
              </option>
            ))}
          </select>
        </label>
        {range === "custom" ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t("ownerboard.filter.from")}
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t("ownerboard.filter.to")}
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg" />
            </label>
          </>
        ) : null}
        {props.spaces.length > 0 ? (
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("ownerboard.filter.space")}
            <select value={space} onChange={(e) => setSpace(e.target.value)} className="rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-sm text-fg">
              <option value="">{t("ownerboard.filter.all_spaces")}</option>
              {props.spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="basis-full text-xs text-muted">
          {t("assistant.scope.hint")} {t("ownerboard.filter.maxdays")}
        </p>
      </section>

      <section className="flex flex-wrap gap-4 rounded-xl border border-border bg-surface p-3 shadow-card" aria-label={t("assistant.usage.title")} data-testid="ai-usage">
        <Meter label={t("assistant.usage.today", { used: fmtNumber(usage.requestsToday), limit: fmtNumber(usage.dailyLimit) })} used={usage.requestsToday} limit={usage.dailyLimit} />
        <Meter label={t("assistant.usage.month", { used: fmtNumber(usage.tokensThisMonth), budget: fmtNumber(usage.monthlyTokenBudget) })} used={usage.tokensThisMonth} limit={usage.monthlyTokenBudget} />
      </section>

      {props.conversations.length > 0 ? (
        <nav aria-label={t("assistant.history")} className="flex flex-wrap items-center gap-2 text-sm" data-testid="ai-history">
          <span className="text-muted">{t("assistant.history")}:</span>
          <Link href="/owner/assistant" className="rounded-full border border-border bg-surface px-3 py-1 text-xs">
            {t("assistant.new_chat")}
          </Link>
          {props.conversations.map((c) => (
            <Link key={c.id} href={`/owner/assistant?c=${c.id}`} className={`rounded-full border px-3 py-1 text-xs ${c.id === conversationId ? "border-accent bg-accent/10" : "border-border bg-surface"}`}>
              {c.title}
            </Link>
          ))}
        </nav>
      ) : null}

      <section className="space-y-3" aria-label={props.title || t("assistant.title")} data-testid="ai-messages">
        {messages.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">{t("assistant.empty")}</p> : null}
        {messages.map((m) => (
          <div key={m.id} className={`space-y-2 rounded-xl border p-3 ${m.role === "USER" ? "border-border bg-surface-1" : "border-border bg-surface shadow-card"}`} data-role={m.role}>
            <div className="text-xs font-medium text-muted">{m.role === "USER" ? t("assistant.you") : t("assistant.assistant")}</div>
            <p className="whitespace-pre-wrap break-words text-sm leading-7" data-testid="ai-text">
              {m.text}
            </p>
            {m.role === "ASSISTANT" ? <MaskedNote report={reports[m.id] ?? null} /> : null}
            {m.proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
            {m.sent ? <SentView sent={m.sent} /> : null}
          </div>
        ))}
      </section>

      <section className="space-y-2" aria-label={t("assistant.quick.title")}>
        <div className="flex flex-wrap gap-2" data-testid="ai-quick">
          {QUICK.map((key) => (
            <button key={key} type="button" disabled={busy || !props.hasKey} onClick={() => send(t(key))} className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm disabled:opacity-50">
              {t(key)}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label className="sr-only" htmlFor="ai-input">
            {t("assistant.input_label")}
          </label>
          <textarea id="ai-input" value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={2000} placeholder={t("assistant.input_placeholder")} className="min-h-[3rem] flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-fg" />
          <div className="flex gap-2 sm:flex-col">
            <button type="submit" disabled={busy || !props.hasKey || input.trim() === ""} className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-accent-fg disabled:opacity-50" data-testid="ai-send">
              {busy ? t("assistant.sending") : t("assistant.send")}
            </button>
            {conversationId ? (
              <button type="button" onClick={clear} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-danger" data-testid="ai-clear">
                {t("assistant.clear")}
              </button>
            ) : null}
          </div>
        </form>
        {error ? (
          <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert" data-testid="ai-error">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
