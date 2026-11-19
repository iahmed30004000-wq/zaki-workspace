"use client";

import React from "react";
import type { MessageDto } from "@/server/chat/dto";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";
import type { CustomerDataHint } from "@/lib/chat/customer-data-hint";

/**
 * C2.4 — what Q1 put under a message, carried over from `message-item.tsx` with the same words, the same switches and the same `data-` marks (the
 * old tests and the owner's list know them): the «صارت مهمة / تذكرة» chips (the live ticket chip with its number, state and holder), «لازم ينقرأ»
 * with «قرأت ✓» and «قرأ 7 من 10», the customer-data hint (Q1.7) and the «بدك تعمليها تذكرة؟» suggestion.
 */

export function WorkChips({ work, onOpenWork }: { work: NonNullable<MessageDto["work"]>; onOpenWork?: (kind: "task" | "ticket", id: string) => void }) {
  if (!work.length) return null;
  return (
    <div data-work-chips className="mt-1 flex flex-wrap gap-1">
      {work.map((w) =>
        w.kind === "task" ? (
          <a key={w.id} href={`/tasks/${w.id}`} className="inline-flex min-h-8 items-center rounded-full bg-accent/10 px-2 text-xs font-semibold text-accent">
            {ct("chatc.work.open_task")}
          </a>
        ) : (
          <button key={w.id} type="button" onClick={() => onOpenWork?.("ticket", w.id)} className="inline-flex min-h-8 items-center rounded-full bg-info/10 px-2 text-xs font-semibold text-info">
            {w.number !== undefined ? (
              <span data-ticket-chip>{`🎫 T-${w.number} · ${ct(`tickets.chip.${(w.status ?? "OPEN").toLowerCase()}`)}${w.assigneeName ? ` · ${ct("tickets.chip.with")} ${w.assigneeName}` : ""}`}</span>
            ) : (
              ct("chatc.work.open_ticket")
            )}
          </button>
        ),
      )}
    </div>
  );
}

export function MustReadBlock({ message, onAck }: { message: MessageDto; onAck?: (message: MessageDto, on: boolean) => void }) {
  const must = message.mustRead;
  if (!must || message.deleted) return null;
  return (
    <div data-must-read className="mt-1 space-y-1 rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-warn">{ct("mustread.badge")}</span>
        {must.mine && onAck ? (
          <Button
            type="button"
            size="sm"
            variant={must.acked ? "secondary" : "primary"}
            data-ack
            aria-pressed={must.acked}
            onClick={() => onAck(message, !must.acked)}
            className={cn("min-h-8 rounded-full px-3 text-xs font-semibold", must.acked && "border-ok/40 bg-ok/15 text-ok hover:bg-ok/15")}
          >
            {ct(must.acked ? "mustread.acked" : "mustread.ack")}
          </Button>
        ) : null}
        {must.total !== undefined ? <span data-must-count>{ct("mustread.count", { read: must.read ?? 0, total: must.total })}</span> : null}
      </div>
      {must.missing?.length ? (
        <p className="text-fg-muted">
          {ct("mustread.missing")} {must.missing.map((m) => m.name).join(ct("chatc.list_sep"))}
        </p>
      ) : must.total !== undefined && must.total > 0 ? (
        <p className="text-ok">{ct("mustread.done")}</p>
      ) : null}
    </div>
  );
}

/** «⚠️ هاي بيانات زبون…»: a line for the author and the moderators; nothing is blocked or changed. */
export function CustomerHint({ hint, canProblem, onTicket }: { hint: CustomerDataHint; canProblem: boolean; onTicket?: () => void }) {
  if (!hint) return null;
  return (
    <div data-customer-hint className="mt-1 space-y-0.5 rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">
      <p className="font-semibold text-warn">{ct(hint === "template" ? "hints.template" : "hints.phone")}</p>
      {hint === "template" ? (
        <p>{ct("hints.template_fix")}</p>
      ) : (
        <>
          {canProblem && onTicket ? (
            <Button type="button" size="sm" data-hint-ticket onClick={onTicket} className="min-h-8 rounded-full px-3 text-xs font-semibold">
              {ct("tickets.menu.problem")}
            </Button>
          ) : null}
          <p className="text-fg-muted">{ct("hints.phone_note")}</p>
        </>
      )}
    </div>
  );
}

export function ProblemSuggestion({ onSuggest }: { onSuggest: () => void }) {
  return (
    <button type="button" data-problem-suggest onClick={onSuggest} className="mt-1 inline-flex min-h-8 items-center rounded-full border border-dashed border-info/50 px-2 text-xs font-semibold text-info">
      {ct("tickets.chip.suggest")}
    </button>
  );
}
