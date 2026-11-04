"use client";

import React from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import { digestErrorText, fetchTopicSummary, type DigestAnswer } from "./digest-client";

/**
 * «لخّصلي» — in a topic's head, for the part the person missed. One press asks for the last 40 messages of THIS topic; the answer opens in
 * a panel for the person alone (nothing is posted to the conversation). ⚠️ + 🔧 sit under the answer, like the card of «اليوم».
 */
export function TopicSummaryButton({ conversationId, className, labelClassName }: { conversationId: string; className: string; labelClassName?: string }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [answer, setAnswer] = React.useState<DigestAnswer | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (): Promise<void> => {
    if (busy) return;
    setOpen(true);
    setBusy(true);
    setAnswer(null);
    setError(null);
    try {
      setAnswer(await fetchTopicSummary(conversationId));
    } catch (err) {
      setError(digestErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  const lines = answer && !answer.empty ? answer.text.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  return (
    <>
      <button type="button" data-topic-summary disabled={busy} aria-label={ct("digest.summarize")} title={ct("digest.summarize")} onClick={() => void run()} className={className}>
        <span aria-hidden="true">✦</span>
        <span className={labelClassName}>{busy ? ct("digest.summarizing") : ct("digest.summarize")}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{ct("digest.summary_title")}</DialogTitle>
            <DialogDescription>{ct("digest.summary_hint")}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div role="status" aria-live="polite" className="text-sm leading-6">
              {busy ? (
                <p className="text-fg-muted">{ct("digest.summarizing")}</p>
              ) : error ? (
                <p className="text-warn">{error}</p>
              ) : answer?.empty ? (
                <p className="text-fg-muted">{ct("digest.summary_empty")}</p>
              ) : (
                <ul role="list" className="flex flex-col gap-1.5">
                  {lines.map((line, i) => (
                    <li key={i} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {answer && !answer.empty ? (
              <div className="mt-3 border-t border-border pt-2 text-xs leading-5 text-fg-muted">
                <p>{ct("digest.note")}</p>
                <p>{ct("digest.fix")}</p>
              </div>
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
