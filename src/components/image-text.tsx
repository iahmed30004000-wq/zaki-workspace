"use client";
import React from "react";
import { AR } from "@/lib/i18n/dict";

type Phase = { kind: "idle" } | { kind: "busy" } | { kind: "done"; text: string; open: boolean } | { kind: "error"; key: string };

/**
 * «اقرا النص» under a picture (the `imageOcr` switch): one tap sends the picture to the company's own vision service and shows the words under
 * it as «النص المقروء» (it can be wrong; it never replaces the picture), with «انسخ النص» and «اقرا من جديد». The text is kept, so the next tap,
 * and everybody else's, is instant. `endpoint` is the route of the picture: `/api/chat/attachments/<attachment id>/text` or
 * `/api/files/<file id>/text`. A failure is one plain line from the dictionary, never the service's own words.
 */
export function ImageText({ endpoint }: { endpoint: string }) {
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [copied, setCopied] = React.useState(false);
  const ask = async (again: boolean) => {
    setPhase({ kind: "busy" });
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ again }) });
      const body = (await res.json().catch(() => null)) as { text?: unknown; message?: unknown } | null;
      if (res.ok && body && typeof body.text === "string") {
        setPhase({ kind: "done", text: body.text, open: true });
        return;
      }
      const key = typeof body?.message === "string" && AR[body.message] ? body.message : "imageOcr.err_failed";
      setPhase({ kind: "error", key });
    } catch {
      setPhase({ kind: "error", key: "imageOcr.err_failed" });
    }
  };
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  };
  const busy = phase.kind === "busy";
  if (phase.kind === "done") {
    return (
      <div data-image-text className="mt-1 text-sm">
        {phase.open ? (
          <div className="rounded-lg bg-surface-muted/60 px-2 py-1">
            <p className="text-xs text-fg-muted">
              {AR["imageOcr.label"]} · {AR["imageOcr.hint_wrong"]}
            </p>
            <p dir="auto" className="whitespace-pre-wrap break-words">
              {phase.text}
            </p>
          </div>
        ) : null}
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-muted">
          <button type="button" onClick={() => setPhase({ ...phase, open: !phase.open })} className="min-h-8 underline">
            {AR[phase.open ? "imageOcr.hide" : "imageOcr.show"]}
          </button>
          <button type="button" onClick={() => copy(phase.text)} className="min-h-8 underline">
            {AR[copied ? "imageOcr.copied" : "imageOcr.copy"]}
          </button>
          <button type="button" onClick={() => void ask(true)} className="min-h-8 underline">
            {AR["imageOcr.again"]}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div data-image-text className="mt-0.5 text-xs">
      <button type="button" onClick={() => void ask(false)} disabled={busy} className="min-h-8 text-fg-muted underline disabled:opacity-60">
        {AR[busy ? "imageOcr.busy_button" : "imageOcr.button"]}
      </button>
      {phase.kind === "error" ? (
        <p role="alert" className="text-danger">
          {AR[phase.key]}
        </p>
      ) : null}
    </div>
  );
}
