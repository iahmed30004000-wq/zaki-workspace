"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/chat/text";
import { fmtTime } from "@/lib/format";
import { digestErrorText, fetchDigest, type DigestAnswer } from "./digest-client";

type State = { kind: "loading" } | { kind: "ok"; answer: DigestAnswer } | { kind: "error"; text: string };

const clock = (iso: string | null): string => (iso ? fmtTime(iso) : "");

/**
 * «شو فاتني؟» — the catch-up card of «اليوم», written by the owner's assistant. The page draws only this shell: the text is fetched AFTER the
 * page is on screen (`/api/digest`), so the page never waits for the model, and a failure is one calm line here, never an error page.
 *
 * ⚠️ + 🔧 stay in the card: it is an AI summary to be checked, and the real thing is in the tasks and the chat. «حدّث» asks again
 * (the server limits it to 5 a minute and keeps the last answer 3 hours).
 */
export function DigestCard() {
  const [state, setState] = React.useState<State>({ kind: "loading" });
  const [busy, setBusy] = React.useState(false);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = React.useCallback(async (refresh: boolean) => {
    setBusy(true);
    try {
      const answer = await fetchDigest(refresh);
      if (alive.current) setState({ kind: "ok", answer });
    } catch (err) {
      if (alive.current) setState({ kind: "error", text: digestErrorText(err) });
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);
  React.useEffect(() => {
    void load(false);
  }, [load]);

  const lines = state.kind === "ok" ? state.answer.text.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  return (
    <section aria-labelledby="today-digest-title" aria-busy={busy} data-digest-card className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 id="today-digest-title" className="flex items-center gap-2 text-base font-semibold text-fg">
          <span aria-hidden="true" className="text-info">
            ✦
          </span>
          {ct("digest.title")}
        </h2>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void load(true)}>
          {busy && state.kind !== "loading" ? ct("digest.refreshing") : ct("digest.refresh")}
        </Button>
      </div>
      <div className="mt-2" role="status" aria-live="polite">
        {state.kind === "loading" ? (
          <p className="text-sm text-fg-muted">{ct("digest.loading")}</p>
        ) : state.kind === "error" ? (
          <p className="text-sm text-warn">{state.text}</p>
        ) : state.answer.empty ? (
          <p className="text-sm text-fg-muted">{ct("digest.empty")}</p>
        ) : (
          <ul role="list" className="flex flex-col gap-1.5 text-sm leading-6 text-fg">
            {lines.map((line, i) => (
              <li key={i} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
      {state.kind === "ok" && !state.answer.empty ? (
        <div className="mt-3 border-t border-border pt-2 text-xs leading-5 text-fg-muted">
          <p>{ct("digest.note")}</p>
          <p>{ct("digest.fix")}</p>
          {state.answer.generatedAt ? (
            <p>
              <span suppressHydrationWarning>{ct("digest.at", { time: clock(state.answer.generatedAt) })}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
