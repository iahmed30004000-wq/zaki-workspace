"use client";
import React from "react";
import type { MessageDto } from "@/server/chat/dto";
import type { RecallResults } from "@/server/chat/recall";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import { fmtMoney } from "@/lib/cards/copy-text";
import { messageClientId } from "@/lib/chat/conversation/client";
import type { RecallKind } from "@/lib/chat/recall-client";
import { isOrderNumber } from "@/lib/oms/order-ref";
import { OrderStateView } from "@/components/chat/message/order-state-card";

const field = "h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm";

/**
 * «/» (Q1.3), opened from the composer's «+» or by typing a slash: «منتج» finds an approved product sheet and sends it as a card (the message holds no
 * price: each reader's screen asks for the card), «رد» finds an approved answer and INSERTS its words in the box, to be changed and sent by the person
 * (it never sends by itself). The server checks every rule again: who may read the sheet, that it is approved, who may post here.
 */
export function RecallDialog({ open, conversationId, kinds, initialKind, initialQuery, onClose, onSent, onInsert }: { open: boolean; conversationId: string; /** the tabs this person is offered (the server's `me.recallKinds`) */ kinds: RecallKind[]; initialKind: RecallKind | null; initialQuery: string; onClose: () => void; onSent: (message: MessageDto) => void; onInsert: (text: string) => void }) {
  const [kind, setKind] = React.useState<RecallKind>(kinds[0] ?? "product");
  const [q, setQ] = React.useState("");
  const [data, setData] = React.useState<RecallResults | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  // read when the dialog opens, never a reason to reset what is being typed (the list is a new array each time the conversation refreshes)
  const kindsNow = React.useRef(kinds);
  kindsNow.current = kinds;
  React.useEffect(() => {
    if (open) {
      setKind(initialKind && kindsNow.current.includes(initialKind) ? initialKind : (kindsNow.current[0] ?? "product"));
      setQ(initialQuery);
      setError("");
      setBusy(null);
    }
  }, [open, initialKind, initialQuery]);

  // «live results»: what is typed is searched after a short pause, and an older answer never replaces a newer one
  React.useEffect(() => {
    if (!open || kind === "order") return;
    let alive = true;
    const timer = setTimeout(() => {
      fetch(`/api/chat/recall?kind=${kind}&q=${encodeURIComponent(q)}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return (await r.json()) as RecallResults;
        })
        .then((d) => alive && (setData(d), setError("")))
        .catch(() => alive && (setData(null), setError(ct("recall.failed"))));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, kind, q]);

  // one id per card until it has gone through: a tap repeated after a lost answer is the same send to the server, so the card is posted once
  const sends = React.useRef(new Map<string, string>());
  function attempt(cardId: string): string {
    let id = sends.current.get(cardId);
    if (!id) sends.current.set(cardId, (id = messageClientId()));
    return id;
  }

  // «/طلب»: the number typed (the state is shown under it before it is sent)
  const orderNumber = q.trim().toUpperCase();
  // the state is asked for only once the number has stopped changing (a typed prefix of a number is a number too)
  const [settled, setSettled] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(orderNumber), 500);
    return () => clearTimeout(timer);
  }, [orderNumber]);
  async function sendOrder() {
    if (busy || !isOrderNumber(orderNumber)) return;
    setBusy(orderNumber);
    setError("");
    try {
      const r = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/recall`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order: orderNumber, clientId: attempt(orderNumber) }) });
      if (!r.ok) throw new Error(String(r.status));
      sends.current.delete(orderNumber);
      onSent((await r.json()) as MessageDto);
    } catch {
      setError(ct("recall.send_failed"));
      setBusy(null);
    }
  }

  async function send(cardId: string) {
    if (busy) return;
    setBusy(cardId);
    setError("");
    try {
      const r = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/recall`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cardId, clientId: attempt(cardId) }) });
      if (!r.ok) throw new Error(String(r.status));
      sends.current.delete(cardId);
      onSent((await r.json()) as MessageDto);
    } catch {
      setError(ct("recall.send_failed"));
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{ct("recall.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-3" onKeyDown={(e) => e.stopPropagation()}>
            <div className="flex gap-2" role="tablist">
              {kinds.map((k) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setData(null); }} className={`rounded-full border px-3 py-1 text-sm ${kind === k ? "border-accent bg-accent/10" : "border-border text-fg-muted"}`}>
                  {ct(`recall.tab.${k}`)}
                </button>
              ))}
            </div>
            <label className="sr-only" htmlFor="recall-q">{ct("recall.search")}</label>
            <input id="recall-q" autoFocus value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder={kind === "order" ? ct("recall.order.search") : ct("recall.search")} className={field} dir={kind === "order" ? "ltr" : undefined} />
            {kind === "order" ? (
              <div className="space-y-2">
                <p className="text-xs text-fg-muted">{ct("recall.order.hint")}</p>
                {q.trim() && !isOrderNumber(orderNumber) ? <p className="text-sm text-fg-muted">{ct("recall.order.bad")}</p> : null}
                {isOrderNumber(orderNumber) ? (
                  <div className="space-y-2 rounded-lg border border-border p-2">
                    <bdi dir="ltr" className="block text-sm font-semibold tabular-nums">{orderNumber}</bdi>
                    {settled === orderNumber ? <OrderStateView number={orderNumber} conversationId={conversationId} /> : null}
                    <button type="button" disabled={busy !== null} onClick={() => void sendOrder()} className="rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-fg disabled:opacity-60">
                      {busy === orderNumber ? "…" : ct("recall.send")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <ul className="max-h-72 space-y-2 overflow-y-auto" aria-live="polite">
              {data?.kind === "product" &&
                data.results.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-fg-muted">{p.tagline || p.category}</span>
                      {p.price !== null ? <span className={`block text-xs ${p.stale ? "text-warn" : ""}`}>{`${fmtMoney(p.price)} ${p.currency ?? ""}${p.stale ? " ⚠️" : ""}`}</span> : null}
                    </span>
                    <button type="button" disabled={busy !== null} onClick={() => void send(p.id)} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-fg disabled:opacity-60">
                      {busy === p.id ? "…" : ct("recall.send")}
                    </button>
                  </li>
                ))}
              {data?.kind === "reply" &&
                data.results.map((a, i) => (
                  <li key={`${a.sheetId}-${i}`} className="space-y-1 rounded-lg border border-border p-2 text-sm">
                    <span className="block text-xs text-fg-muted">{`${a.sheetName} · ${a.question}`}</span>
                    <span className="block">{a.answer}</span>
                    <button type="button" onClick={() => { onInsert(a.answer); onClose(); }} className="rounded-lg border border-border px-3 py-1 text-xs">
                      {ct("recall.insert")}
                    </button>
                  </li>
                ))}
              {kind !== "order" && data && data.results.length === 0 ? <li className="p-3 text-center text-sm text-fg-muted">{ct("recall.none")}</li> : null}
            </ul>
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
