"use client";

import React from "react";
import { BadgeCheck } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import type { SystemMeta } from "@/server/chat/dto";
import { ct } from "@/lib/chat/text";
import { BOTFATHER_WORDS, decodeKeyboard } from "@/lib/chat/botfather";

type Secrets = { kind: "idle" } | { kind: "busy" } | { kind: "shown"; token?: string; webhookSecret?: string } | { kind: "gone" };

/**
 * «بوت فاذر»'s answer, drawn as Telegram draws a bot's message: a bubble on the incoming side with the bot's name and check mark, and its buttons in rows under it. A press
 * goes to `POST /api/chat/botfather/press` (the server takes only a button the line really has); a menu button redraws this very line, which arrives like any edit.
 * When the answer carries a secret (`p.reveal`) the bubble has «اعرض التوكن»: the screen asks `GET /api/chat/botfather/reveal/<id>` ONCE, shows the token and the webhook's
 * secret with a warning, and the server forgets them. Nothing secret is ever in the message itself, so it is not in the history, the search or the oversight view.
 */
export function BotFatherLine({ messageId, meta, time, createdAt }: { messageId: string; meta: SystemMeta; time: string; createdAt: string }) {
  const p = meta.p ?? {};
  const text = typeof p["text"] === "string" ? p["text"] : "";
  const hasSecret = p["reveal"] === 1;
  const keyboard = decodeKeyboard(p["kb"]);
  const [state, setState] = React.useState<Secrets>({ kind: "idle" });
  const [pressing, setPressing] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState("");
  // a menu button redraws the line: what was shown or refused for the old words goes with them
  const drawn = `${text}\u0000${String(p["kb"] ?? "")}`;
  const [seen, setSeen] = React.useState(drawn);
  if (seen !== drawn) {
    setSeen(drawn);
    setState({ kind: "idle" });
    setFailed("");
  }
  const reveal = async () => {
    setState({ kind: "busy" });
    try {
      const got = await apiGet<{ token?: string; webhookSecret?: string }>(`/api/chat/botfather/reveal/${encodeURIComponent(messageId)}`);
      setState({ kind: "shown", ...(got.token ? { token: got.token } : {}), ...(got.webhookSecret ? { webhookSecret: got.webhookSecret } : {}) });
    } catch {
      setState({ kind: "gone" });
    }
  };
  const press = async (data: string) => {
    if (pressing !== null) return;
    setPressing(data);
    setFailed("");
    try {
      await apiPost("/api/chat/botfather/press", { messageId, data });
    } catch (error) {
      setFailed(error instanceof ApiError && error.status === 404 ? ct("botfather.press_stale", BOTFATHER_WORDS) : ct("botfather.err_failed"));
    } finally {
      setPressing(null);
    }
  };
  return (
    <div role="note" dir="rtl" data-botfather-line className="my-1.5 flex justify-start px-3">
      <div className="flex w-full max-w-[min(85%,30rem)] flex-col gap-1">
        <div className="rounded-2xl rounded-ss-md border border-border/60 bg-surface-1 px-3 py-2 text-fg shadow-card">
          <p className="mb-0.5 flex items-center gap-1 text-xs font-semibold text-accent">
            <span>{ct("botfather.label")}</span>
            <span role="img" aria-label={ct("botfather.verified")} title={ct("botfather.verified")} className="inline-flex">
              <BadgeCheck className="size-4" aria-hidden="true" />
            </span>
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
          <time dateTime={createdAt} dir="ltr" className="mt-1 block text-end text-xs tabular-nums text-fg-muted">
            {time}
          </time>
        </div>
        {keyboard.length ? (
          <div data-botfather-keyboard className="flex flex-col gap-1">
            {keyboard.map((row, i) => (
              <div key={i} className="flex gap-1">
                {row.map((b) => (
                  <button
                    key={b.d}
                    type="button"
                    data-botfather-button={b.d}
                    onClick={() => void press(b.d)}
                    disabled={pressing !== null}
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-border/60 bg-surface-2 px-2 py-1.5 text-sm font-semibold text-fg shadow-card hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
                  >
                    <bdi>{b.t}</bdi>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        {failed ? (
          <p role="alert" className="text-xs text-danger">
            {failed}
          </p>
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
