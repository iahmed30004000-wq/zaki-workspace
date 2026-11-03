"use client";
import React from "react";
import { AR } from "@/lib/i18n/dict";

export type TranslationState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; text: string; target: "ar" | "en" } | { kind: "error"; key: string };

/**
 * The state of «ترجم» for ONE message (the `messageTranslate` switch): asked from the message menu, answered under the text in the same
 * bubble, hidden with «إخفاء». The translation lives only in this component: it is never saved and never sent to the conversation.
 * A failure is one plain line from the dictionary, never the provider's own words.
 */
export function useTranslation(messageId: string) {
  const [state, setState] = React.useState<TranslationState>({ kind: "idle" });
  const ask = async () => {
    setState({ kind: "busy" });
    try {
      const res = await fetch(`/api/chat/messages/${encodeURIComponent(messageId)}/translate`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { text?: unknown; target?: unknown; message?: unknown } | null;
      if (res.ok && body && typeof body.text === "string") {
        setState({ kind: "done", text: body.text, target: body.target === "en" ? "en" : "ar" });
        return;
      }
      setState({ kind: "error", key: typeof body?.message === "string" && AR[body.message] ? body.message : "translate.err_failed" });
    } catch {
      setState({ kind: "error", key: "translate.err_failed" });
    }
  };
  const hide = () => setState({ kind: "idle" });
  return { state, ask, hide };
}

/** What sits under the message text: nothing, «عم أترجم…», the translation with its ⚠️ note, or a short failure line. */
export function MessageTranslation({ state, onHide }: { state: TranslationState; onHide: () => void }) {
  if (state.kind === "idle") return null;
  if (state.kind === "busy") {
    return (
      <p data-translation="busy" role="status" className="mt-1 text-xs text-fg-muted">
        {AR["translate.busy"]}
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div data-translation="error" className="mt-1 flex items-center gap-2 text-xs">
        <p role="alert" className="text-danger">
          {AR[state.key]}
        </p>
        <button type="button" onClick={onHide} className="min-h-8 text-fg-muted underline">
          {AR["translate.hide"]}
        </button>
      </div>
    );
  }
  return (
    <div data-translation="done" className="mt-1.5 rounded-lg border-s-2 border-info/40 bg-info/10 px-2 py-1">
      <p className="mb-0.5 text-xs font-semibold text-info">{AR[state.target === "en" ? "translate.label_en" : "translate.label_ar"]}</p>
      <p dir={state.target === "en" ? "ltr" : "rtl"} className="whitespace-pre-wrap break-words text-sm leading-relaxed">
        {state.text}
      </p>
      <p className="mt-1 text-xs text-fg-muted">{AR["translate.note"]}</p>
      <button type="button" onClick={onHide} className="min-h-8 text-xs text-fg-muted underline">
        {AR["translate.hide"]}
      </button>
    </div>
  );
}
