"use client";
import React from "react";
import type { MessageDto, MemberDto } from "@/server/chat/dto";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import { findOrderNumbers } from "@/lib/oms/order-ref";

export interface ProblemKindDto {
  key: string;
  label: string;
  needsFollowUp?: boolean;
  needsRecording?: boolean;
}

const field = "h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm";

/**
 * «🎫 مشكلة» (Q1.5): a ticket made where the message is. The form asks for the KIND, then the order number first (taken from the message when it has one) and
 * only then offers «ما في رقم طلب؟ رقم الزبون» (the number is kept protected: encrypted, masked everywhere else, wiped 30 days after the ticket is resolved).
 * Who gets it is the server's rule (the person named here, one @-mentioned person, the kind's department, the supervisor); the server decides again, and
 * a private conversation needs the confirmation.
 */
export function ProblemDialog({ message, kinds, people, privateSource, defaultKind, onClose, onDone }: { message: MessageDto | null; kinds: ProblemKindDto[]; people: MemberDto[]; privateSource: boolean; defaultKind?: string | null; onClose: () => void; onDone: (merged: boolean) => void }) {
  const [kindKey, setKindKey] = React.useState("");
  const [order, setOrder] = React.useState("");
  const [useCustomer, setUseCustomer] = React.useState(false);
  const [customer, setCustomer] = React.useState("");
  const [followUp, setFollowUp] = React.useState("");
  const [assignee, setAssignee] = React.useState("");
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const id = message?.id ?? null;
  React.useEffect(() => {
    if (!message) return;
    setKindKey(defaultKind && kinds.some((k) => k.key === defaultKind) ? defaultKind : (kinds[0]?.key ?? ""));
    setOrder(findOrderNumbers(message.body ?? "")[0]?.number ?? "");
    setUseCustomer(false);
    setCustomer("");
    setFollowUp("");
    setAssignee("");
    setConfirm(false);
    setBusy(false);
    setError("");
    // reset only when another message is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const kind = kinds.find((k) => k.key === kindKey);

  async function submit() {
    if (!message || busy || !kind) return;
    if (privateSource && !confirm) {
      setError(ct("tickets.dialog.confirm_needed"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/chat/messages/${encodeURIComponent(message.id)}/problem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kindKey: kind.key,
          ...(order.trim() ? { orderNumber: order.trim() } : {}),
          ...(useCustomer && customer.trim() ? { customerNumber: customer.trim() } : {}),
          ...(kind.needsFollowUp && followUp ? { followUpDate: followUp } : {}),
          ...(assignee ? { assigneeId: assignee } : {}),
          ...(privateSource ? { confirmPublic: true } : {}),
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { details?: Array<{ message?: string }>; message?: string };
        const key = j.details?.[0]?.message ?? j.message ?? "";
        const text = key ? ct(key) : "";
        setError(text && text !== key ? text : ct("tickets.dialog.failed"));
        setBusy(false);
        return;
      }
      const j = (await r.json()) as { merged?: boolean };
      onDone(Boolean(j.merged));
    } catch {
      setError(ct("tickets.dialog.failed"));
      setBusy(false);
    }
  }

  return (
    <Dialog open={message !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{ct("tickets.dialog.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{ct("tickets.dialog.kind")}</span>
              <select value={kindKey} onChange={(e) => setKindKey(e.target.value)} className={field}>
                {kinds.map((k) => (
                  <option key={k.key} value={k.key}>{k.label}</option>
                ))}
              </select>
            </label>
            {kind?.needsRecording ? <p className="rounded-lg bg-warn/10 p-2 text-xs text-warn">{ct("tickets.dialog.recording")}</p> : null}
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{ct("tickets.dialog.order")}</span>
              <input dir="ltr" value={order} onChange={(e) => setOrder(e.target.value.toUpperCase())} placeholder="ZK-2026-000123" className={field} />
            </label>
            {!order.trim() ? (
              <div className="space-y-1">
                <button type="button" onClick={() => setUseCustomer((v) => !v)} aria-expanded={useCustomer} className="text-sm text-accent underline-offset-2 hover:underline">{ct("tickets.dialog.no_order")}</button>
                {useCustomer ? (
                  <>
                    <input dir="ltr" inputMode="tel" value={customer} onChange={(e) => setCustomer(e.target.value)} className={field} aria-label={ct("tickets.dialog.customer")} />
                    <p className="text-xs text-fg-muted">{ct("tickets.dialog.customer_note")}</p>
                  </>
                ) : null}
              </div>
            ) : null}
            {kind?.needsFollowUp ? (
              <label className="block space-y-1 text-sm">
                <span className="font-medium">{ct("tickets.dialog.follow_up")}</span>
                <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={field} />
              </label>
            ) : null}
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{ct("tickets.dialog.person")}</span>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
                <option value="">{ct("tickets.dialog.person_auto")}</option>
                {people.filter((p) => !message || p.id !== message.authorId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            {privateSource ? (
              <label className="flex items-start gap-2 rounded-lg bg-warn/10 p-2 text-xs text-warn">
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
                <span>{ct("tickets.dialog.private_warn")}</span>
              </label>
            ) : null}
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !kind} className="rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg disabled:opacity-60">{busy ? "…" : ct("tickets.dialog.send")}</button>
              <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">{ct("tickets.dialog.cancel")}</button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
