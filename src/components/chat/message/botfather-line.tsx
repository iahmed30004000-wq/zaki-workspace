"use client";

import React from "react";
import { apiGet } from "@/lib/api-client";
import type { SystemMeta } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";
import { BOTFATHER_WORDS } from "@/lib/chat/botfather";

/**
 * «بوت فاذر»'s answer, drawn like the assistant's: a card in the middle of the conversation (an opaque surface, the theme's text colour). When the answer carries a secret
 * (\`p.reveal\`) the card has «اعرض التوكن»: the screen asks \`GET /api/chat/botfather/reveal/<id>\` ONCE, shows the token and the webhook's secret with a warning, and the
 * server forgets them. Nothing secret is ever in the message itself, so it is not in the history, the search or the oversight view.
 */
export function BotFatherLine({ messageId, meta, time, createdAt }: { messageId: string; meta: SystemMeta; time: string; createdAt: string }) {
  const p = meta.p ?? {};
  const text = typeof p["text"] === "string" ? p["text"] : "";
  const hasSecret = p["reveal"] === 1;
  const [state, setState] = React.useState<{ kind: "idle" } | { kind: "busy" } | { kind: "shown"; token?: string; webhookSecret?: string } | { kind: "gone" }>({ kind: "idle" });
  const reveal = async () => {
    setState({ kind: "busy" });
    try {
      const got = await apiGet<{ token?: string; webhookSecret?: string }>(`/api/chat/botfather/reveal/${encodeURIComponent(messageId)}`);
      setState({ kind: "shown", ...(got.token ? { token: got.token } : {}), ...(got.webhookSecret ? { webhookSecret: got.webhookSecret } : {}) });
    } catch {
      setState({ kind: "gone" });
    }
  };
  return (
    <div role="note" dir="rtl" data-botfather-line className="my-3 flex justify-center px-3">
      <div className="w-full max-w-xl rounded-2xl border border-info/40 bg-surface-1 px-3 py-2 text-fg">
        <p className="mb-1 flex items-center gap-2 text-xs font-semibold">
          <span aria-hidden="true" className="text-info">🤖</span>
          <span>{ct("botfather.label")}</span>
          <time dateTime={createdAt} dir="ltr" className="ms-auto font-normal tabular-nums text-fg-muted">
            {time}
          </time>
        </p>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
        {hasSecret && state.kind !== "shown" ? (
          <div className="mt-2">
            {state.kind === "gone" ? (
              <p role="alert" className="text-xs text-danger">
                {ct("botfather.reveal_gone", BOTFATHER_WORDS)}
              </p>
            ) : (
              <button type="button" data-botfather-reveal onClick={() => void reveal()} disabled={state.kind === "busy"} className="min-h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm font-semibold text-accent disabled:opacity-60">
                {ct("botfather.reveal_button")}
              </button>
            )}
          </div>
        ) : null}
        {state.kind === "shown" ? (
          <div data-botfather-secrets className="mt-2 space-y-2 rounded-lg border border-warn/50 bg-surface-2 p-2">
            <p className="text-xs font-semibold text-warn">{ct("botfather.reveal_title")}</p>
            {state.token ? <Secret label={ct("botfather.reveal_token")} value={state.token} /> : null}
            {state.webhookSecret ? <Secret label={ct("botfather.reveal_secret")} value={state.webhookSecret} /> : null}
            <p className="text-xs text-fg-muted">{ct("botfather.reveal_warning")}</p>
            <button type="button" onClick={() => setState({ kind: "gone" })} className="min-h-9 rounded-lg px-3 text-sm text-fg-muted hover:bg-surface-1">
              {ct("botfather.reveal_close")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <label className="block text-xs text-fg-muted">
      {label}
      <input readOnly dir="ltr" value={value} onFocus={(e) => e.currentTarget.select()} className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg" />
    </label>
  );
}
