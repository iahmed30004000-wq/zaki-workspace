"use client";
import React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { fmtMoney } from "@/lib/cards/copy-text";
import { stockWord } from "@/components/knowledge/sheet-view";
import { ct } from "@/lib/chat/text";
import type { CardRefDto } from "@/server/chat/dto";
import type { SheetDTO } from "@/server/services/knowledge";

/**
 * The small card under a CARD message (Q1.3). The message itself holds only the card's address and a line without a price: this asks for the
 * sheet AS THE READER MAY SEE IT (the approved version, the live price, never to an external partner), so each reader's screen shows what is
 * theirs and a forward is resolved again for its new readers. Somebody who may not open the sheet is told so and keeps the line of the message.
 */
export function CardBubble({ card }: { card: Extract<CardRefDto, { type: "product" }> }) {
  const sheet = useQuery({
    queryKey: ["knowledge-sheet", card.cardId],
    queryFn: () => apiGet<{ sheet: SheetDTO }>(`/api/knowledge/${encodeURIComponent(card.cardId)}`).then((r) => r.sheet),
    staleTime: 60_000,
    retry: false,
  });
  if (sheet.isPending) return <div className="mt-1 h-14 animate-pulse rounded-lg bg-surface-2" aria-hidden="true" />;
  if (sheet.isError || !sheet.data) return <p className="mt-1 text-xs text-fg-muted">{ct("recall.card.closed")}</p>;
  const s = sheet.data;
  const stock = stockWord(s.external?.stockStatus);
  return (
    <Link href={`/knowledge/${encodeURIComponent(s.id)}`} className="mt-1 block space-y-1 rounded-lg border border-border bg-surface p-2 text-sm hover:border-accent" data-card-bubble>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{s.name}</span>
        {s.category ? <span className="text-xs text-fg-muted">{s.category}</span> : null}
        {stock ? <span className={`rounded-full px-2 text-xs ${stock === "out" ? "bg-danger/15 text-danger" : "bg-ok/15 text-ok"}`}>{ct(stock === "out" ? "knowledge.stock.out" : "knowledge.stock.in")}</span> : null}
      </span>
      {s.data?.tagline ? <span className="block text-xs text-fg-muted">{s.data.tagline}</span> : null}
      {s.external ? <span className={`block text-xs ${s.external.stale ? "text-warn" : ""}`}>{`${fmtMoney(s.external.price)} ${s.external.currency}${s.external.stale ? " ⚠️" : ""}`}</span> : null}
      <span className="block text-xs text-accent">{ct("recall.card.open")}</span>
    </Link>
  );
}
