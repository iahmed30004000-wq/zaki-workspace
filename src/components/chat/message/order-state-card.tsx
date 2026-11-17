"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { ct } from "@/lib/chat/text";
import { fmtDateTime } from "@/lib/format";
import { orderStateLabelKey, splitOrderNumbers } from "@/lib/oms/order-ref";
import type { OrderStateDto } from "@/server/services/order-state";

/**
 * An order's state, as the person asking may see it (Q1.4). It is asked for only when it is shown (a chip is a button; a «/طلب» card asks when it is
 * on screen), inside the conversation it was written in: the server tells a person who cannot read that conversation, a guest, or a company with
 * the switch off, that there is nothing here. The words of every state go through the Arabic map: an unknown word is «حالة غير معروفة», never itself.
 */
export function OrderStateView({ number, conversationId }: { number: string; conversationId: string }) {
  const q = useQuery({
    queryKey: ["order-state", conversationId, number],
    queryFn: () => apiGet<OrderStateDto>(`/api/orders/state?number=${encodeURIComponent(number)}&conversationId=${encodeURIComponent(conversationId)}`),
    staleTime: 30_000,
    retry: false,
  });
  if (q.isPending) return <span className="block text-xs text-fg-muted">{ct("order.loading")}</span>;
  if (q.isError || !q.data) return <span className="block text-xs text-fg-muted">{ct("order.closed")}</span>;
  const s = q.data;
  if (s.state === "waits_update") return <span className="block text-xs text-fg-muted">{ct("order.waits")}</span>;
  if (s.state === "not_found") return <span className="block text-xs text-fg-muted">{ct("order.not_found")}</span>;
  if (s.state === "unreachable") return <span className="block text-xs text-warn">{ct("order.unreachable")}</span>;
  const rows: Array<[string, string]> = [];
  if (s.confirmation) rows.push([ct("order.confirmation"), ct(orderStateLabelKey(s.confirmation))]);
  if (s.shipping) rows.push([ct("order.shipping"), ct(orderStateLabelKey(s.shipping))]);
  if (!s.confirmation && !s.shipping) rows.push([ct("order.status"), ct(orderStateLabelKey(s.status))]);
  if (s.productName) rows.push([ct("order.product"), s.quantity ? `${s.productName} × ${s.quantity}` : s.productName]);
  if (s.movedAt) rows.push([ct("order.moved"), fmtDateTime(s.movedAt)]);
  return (
    <span className="block space-y-0.5 text-sm" data-order-state>
      {rows.map(([k, v]) => (
        <span key={k} className="flex gap-2">
          <span className="text-xs text-fg-muted">{k}</span>
          <span className="font-medium">{v}</span>
        </span>
      ))}
      {s.stale ? <span className="block text-xs text-warn">{ct("order.old")}</span> : null}
    </span>
  );
}

/** The small card under a «/طلب» message (a CARD message of type order). */
export function OrderCardBubble({ number, conversationId }: { number: string; conversationId: string }) {
  return (
    <span className="mt-1 block space-y-1 rounded-lg border border-border bg-surface p-2" data-order-card>
      <span className="flex items-center gap-2 text-sm font-semibold">
        <span>{ct("order.title")}</span>
        <bdi dir="ltr" className="tabular-nums">{number}</bdi>
      </span>
      <OrderStateView number={number} conversationId={conversationId} />
    </span>
  );
}

/** An order number inside a message: a button that shows the state under it when pressed (nothing is asked before). */
export function OrderChip({ number, conversationId }: { number: string; conversationId: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${ct("order.chip.open")} ${number}`} data-order-chip className="inline rounded bg-accent/10 px-1 font-semibold text-accent underline-offset-2 hover:underline">
        <bdi dir="ltr" className="tabular-nums">{number}</bdi>
      </button>
      {open ? (
        <span className="my-1 block rounded-lg border border-border bg-surface p-2">
          <OrderStateView number={number} conversationId={conversationId} />
        </span>
      ) : null}
    </>
  );
}

/** A plain piece of a message with its order numbers turned into chips (a text with none is returned as it is). */
export function OrderText({ text, conversationId }: { text: string; conversationId: string }) {
  const pieces = splitOrderNumbers(text);
  if (!pieces.some((p) => p.order)) return <>{text}</>;
  return (
    <>
      {pieces.map((p, i) => (p.order ? <OrderChip key={i} number={p.text} conversationId={conversationId} /> : <React.Fragment key={i}>{p.text}</React.Fragment>))}
    </>
  );
}
