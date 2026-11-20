"use client";

import React from "react";
import type { MessageDto } from "@/server/chat/dto";
import type { MediaItemDTO, MediaListDTO } from "@/server/services/knowledge-media";
import type { RecallResults } from "@/server/chat/recall";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import { MAX_FEEDBACK_SEND, offerableFeedback, sendInOrder } from "@/lib/chat/v2/feedback/feedback-model";
import { cn } from "@/lib/utils";

type Product = Extract<RecallResults, { kind: "product" }>["results"][number];

/** One picture of a sheet goes into the conversation as a COPY (Q1.2): the sheet's own door, one message each. */
async function sendPicture(cardId: string, attachmentId: string, conversationId: string): Promise<MessageDto> {
  const response = await fetch(`/api/knowledge/${encodeURIComponent(cardId)}/media/${encodeURIComponent(attachmentId)}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId }),
  });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as MessageDto;
}

/**
 * C3w.2 (Q1.3) — «/آراء حراك»: the customers' feedback of a product, picked here and sent as pictures (copies, one message each) into THIS conversation. First the product (the
 * same search the «/» menu uses), then the sheet's approved feedback pictures; only items with the customer's consent and an approver's approval are offered
 * (`offerableFeedback`; the server refuses the rest again). ⚠️ A feedback picture is a customer's own chat, so the dialog says that only approved ones are here.
 */
export function FeedbackDialog({ open, conversationId, initialQuery, onClose, onSent, portal = true }: { open: boolean; conversationId: string; initialQuery: string; onClose: () => void; onSent: (messages: MessageDto[]) => void; portal?: boolean }) {
  const [q, setQ] = React.useState(initialQuery);
  const [products, setProducts] = React.useState<Product[] | null>(null);
  const [product, setProduct] = React.useState<Product | null>(null);
  const [items, setItems] = React.useState<MediaItemDTO[] | null>(null);
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  // one ticket per opened product: the answer for a product the person has left (or gone back from) is nobody's
  const ticket = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    ticket.current += 1;
    setQ(initialQuery);
    setProducts(null);
    setProduct(null);
    setItems(null);
    setChosen([]);
    setBusy(false);
    setError("");
  }, [open, initialQuery]);

  // the product search: what is typed is searched after a short pause, and an older answer never replaces a newer one
  React.useEffect(() => {
    if (!open || product) return;
    let alive = true;
    const timer = setTimeout(() => {
      fetch(`/api/chat/recall?kind=product&q=${encodeURIComponent(q)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          return (await response.json()) as RecallResults;
        })
        .then((data) => alive && (setProducts(data.kind === "product" ? data.results : []), setError("")))
        .catch(() => alive && (setProducts(null), setError(ct("recall.failed"))));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, product, q]);

  function openProduct(next: Product) {
    const mine = ++ticket.current;
    setProduct(next);
    setItems(null);
    setChosen([]);
    setError("");
    fetch(`/api/knowledge/${encodeURIComponent(next.id)}/media`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as MediaListDTO;
      })
      .then((list) => mine === ticket.current && setItems(offerableFeedback(list.feedback)))
      .catch(() => mine === ticket.current && setError(ct("chatui.feedback.failed_load")));
  }
  const toggle = (id: string) => setChosen((now) => (now.includes(id) ? now.filter((x) => x !== id) : now.length >= MAX_FEEDBACK_SEND ? now : [...now, id]));

  async function send() {
    if (!product || busy || chosen.length === 0) return;
    setBusy(true);
    setError("");
    const { sent, failed } = await sendInOrder(chosen, (id) => sendPicture(product.id, id, conversationId));
    setBusy(false);
    if (sent.length > 0) onSent(sent);
    if (failed) {
      // what went is not offered again; the rest stays chosen so a retry sends only it
      const sentIds = new Set(chosen.slice(0, sent.length));
      setChosen((now) => now.filter((id) => !sentIds.has(id)));
      setItems((now) => (now ? now.filter((item) => !sentIds.has(item.id)) : now));
      setError(ct("chatui.feedback.failed_send"));
      return;
    }
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent portal={portal} size="md" aria-label={ct("chatui.feedback.title")}>
        <DialogHeader>
          <DialogTitle>{ct("chatui.feedback.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-3" onKeyDown={(e) => e.stopPropagation()}>
            <p data-feedback-note="" className="text-xs text-fg-muted">
              {ct("chatui.feedback.note")}
            </p>
            {product ? (
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold">{product.name}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => {
                    ticket.current += 1;
                    setProduct(null);
                  }}
                >
                  {ct("chatui.feedback.back")}
                </Button>
              </div>
            ) : (
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.currentTarget.value)}
                placeholder={ct("chatui.feedback.search")}
                aria-label={ct("chatui.feedback.search")}
                className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-base md:h-9 md:text-sm"
              />
            )}
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            {!product && products ? (
              products.length === 0 ? (
                <p role="status" className="py-2 text-center text-sm text-fg-muted">
                  {ct("chatui.feedback.no_products")}
                </p>
              ) : (
                <ul data-feedback-products="" className="max-h-72 space-y-1 overflow-y-auto">
                  {products.map((p) => (
                    <li key={p.id}>
                      <button type="button" data-feedback-product={p.id} onClick={() => openProduct(p)} className="flex min-h-11 w-full flex-col items-start justify-center rounded-lg px-3 text-start text-sm hover:bg-surface-2">
                        <span className="font-semibold">{p.name}</span>
                        <span className="max-w-full truncate text-xs text-fg-muted">{p.tagline || p.category}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
            {product && items ? (
              items.length === 0 ? (
                <p role="status" className="py-2 text-center text-sm text-fg-muted">
                  {ct("chatui.feedback.none")}
                </p>
              ) : (
                <ul data-feedback-items="" className="grid grid-cols-3 gap-2">
                  {items.map((item) => {
                    const on = chosen.includes(item.id);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          data-feedback-item={item.id}
                          aria-pressed={on}
                          onClick={() => toggle(item.id)}
                          className={cn("block w-full overflow-hidden rounded-lg border", on ? "border-accent ring-2 ring-accent" : "border-border")}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.url} alt={ct("chatui.feedback.item")} loading="lazy" className="h-28 w-full object-cover" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </div>
        </DialogBody>
        {product ? (
          <DialogFooter>
            <span className="me-auto text-xs text-fg-muted">{ct("chatui.feedback.selected", { n: chosen.length, max: MAX_FEEDBACK_SEND })}</span>
            <Button type="button" disabled={busy || chosen.length === 0} onClick={() => void send()}>
              {busy ? ct("chatui.feedback.sending") : ct("chatui.feedback.send")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
