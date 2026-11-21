"use client";

import React from "react";
import { ct } from "@/lib/chat/text";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { useOptionalToast } from "@/components/ui/toast";
import { callApi } from "./call-api";

/** What GET /api/calls/[id]/minutes answers about the record (src/server/calls/transcripts.ts `RecordingState`). */
interface Recording {
  on: boolean;
  canSet: boolean;
  days: number;
}

/** How often the mark asks again (the live line tells it at once for a call of a conversation; a meeting by link has no such line). */
const ASK_EVERY_MS = 20_000;

/**
 * «عم يتسجّل النص» (S6.2): the mark everybody in the call room sees while the OWNER has the TEXT record on for this call. Only text is written (never any sound),
 * and the mark says so and for how many days. The owner also gets the two controls here: «سجّل النص» / «وقّف تسجيل النص», and the days the lines are kept.
 * Nothing is drawn when the record is off and the viewer cannot turn it on (a company with the switch off, anybody but the owner).
 */
export function RecordingMark({ callId }: { callId: string }) {
  const toast = useOptionalToast();
  const [rec, setRec] = React.useState<Recording | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [days, setDays] = React.useState("");
  const api = `/api/calls/${encodeURIComponent(callId)}/minutes`;

  const load = React.useCallback(async () => {
    try {
      const data = await callApi<{ recording: Recording }>(api);
      setRec(data.recording);
    } catch {
      // the mark is a side note of the call: never an error on the screen
    }
  }, [api]);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), ASK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useRealtime((event) => {
    if (event.kind === "call.changed" && event.callId === callId) void load();
  });

  const say = (text: string, kind: "success" | "error" = "success") => toast?.toast(text, kind);

  async function change(body: { on?: boolean; retentionDays?: number }, done: string) {
    setBusy(true);
    try {
      setRec(await callApi<Recording>(api, body));
      say(done);
    } catch (e) {
      say(e instanceof Error ? e.message : ct("calls.action_failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!rec || (!rec.on && !rec.canSet)) return null;
  const shownDays = days || String(rec.days);
  const hint = ct("calls.minutes.mark_hint", { days: rec.days });

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2" data-recording-mark={rec.on ? "on" : "off"}>
      {rec.on && (
        <p role="status" title={hint} className="inline-flex min-h-8 items-center gap-2 rounded-full bg-danger/15 px-3 py-1 text-xs font-semibold text-danger">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-danger motion-safe:animate-pulse" />
          {ct("calls.minutes.mark")}
        </p>
      )}
      {rec.canSet && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void change({ on: !rec.on }, ct(rec.on ? "calls.minutes.stopped" : "calls.minutes.started"))}
          className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs hover:bg-surface-2 disabled:opacity-50"
        >
          {busy ? ct("calls.minutes.busy") : ct(rec.on ? "calls.minutes.stop" : "calls.minutes.start")}
        </button>
      )}
      {rec.canSet && (
        <details className="relative">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg px-2 text-xs text-fg-muted hover:bg-surface-2" aria-label={ct("calls.minutes.days_label")}>
            <span aria-hidden="true">⚙️</span>
          </summary>
          <div className="absolute end-0 top-full z-10 mt-1 w-64 rounded-xl border border-border bg-surface-1 p-3 text-xs shadow-lg">
            <p className="mb-2 text-fg-muted">{ct("calls.minutes.promise", { days: rec.days })}</p>
            <p className="mb-2 text-fg-muted">{ct("calls.minutes.after_note")}</p>
            <label className="flex flex-col gap-1">
              <span>{ct("calls.minutes.days_label")}</span>
              <input
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                dir="ltr"
                value={shownDays}
                onChange={(e) => setDays(e.target.value)}
                className="min-h-11 rounded-lg border border-border bg-surface px-3"
              />
            </label>
            <button
              type="button"
              disabled={busy || !/^\d{1,3}$/.test(shownDays) || Number(shownDays) < 1 || Number(shownDays) > 365}
              onClick={() => void change({ retentionDays: Number(shownDays) }, ct("calls.minutes.days_saved"))}
              className="mt-2 min-h-11 w-full rounded-lg bg-accent px-3 text-accent-fg disabled:opacity-50"
            >
              {ct("calls.minutes.days_save")}
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
