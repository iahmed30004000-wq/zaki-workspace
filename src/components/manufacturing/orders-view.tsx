"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import Link from "next/link";
import { apiPatch, apiPost } from "@/lib/api-client";
import { fmtAgo } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { LIMITS, formatMinor, formatQty, parseQtyMicro } from "@/lib/manufacturing/shared";
import type { OrderCost, OrderItem, OrdersView } from "@/lib/manufacturing/production-view";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Field, MfgTabs, Money, NotAccountingNote, Qty, SectionTitle, mfgErrorText, useCurrencyName } from "./ui";

/**
 * «أوامر التصنيع» — a planned quantity of a recipe. DRAFT → ISSUED (⚠️ the materials leave the stock at once, the oldest lot first) → COMPLETED (the
 * real output is written) or RETURNED (the issued materials go back by reversing movements); a draft can be cancelled. The cost of an order is
 * what it consumed, lot by lot at the lot's price, shown with its formula and ONLY to a holder of the cost; a lot without a price makes it incomplete.
 */
export function OrdersPage({ initial }: { initial: OrdersView }) {
  const { t } = useI18n();
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  React.useEffect(() => setData(initial), [initial]);
  const [adding, setAdding] = React.useState(false);
  const refresh = () => router.refresh();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <MfgTabs current="stock" sub="orders" />
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{t("mfg.orders_title")}</h1>
          <p className="text-xs text-fg-muted">{t("mfg.orders_subtitle", { space: data.spaceName })}</p>
        </div>
        {data.canEdit ? (
          <Button size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            <Plus className="size-4" aria-hidden />
            {t("mfg.order_new")}
          </Button>
        ) : null}
      </header>

      <NotAccountingNote />
      {!data.canEdit ? <p className="text-xs text-fg-muted">{t("mfg.read_only")}</p> : null}
      {!data.canCost ? <p className="text-xs text-fg-muted">{t("mfg.no_cost_note")}</p> : null}

      {adding && data.canEdit ? (
        <NewOrderForm
          view={data}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      ) : null}

      <section className="space-y-2">
        <SectionTitle>{t("mfg.sub.orders")}</SectionTitle>
        {data.orders.length === 0 ? (
          <EmptyState title={t("mfg.order_none")} hint={data.canEdit ? t("mfg.order_none_hint") : t("mfg.empty_hint_view")} />
        ) : (
          <ul className="grid gap-2">
            {data.orders.map((o, i) => (
              <li key={o.id}>
                <OrderCard order={o} view={data} onDone={refresh} newest={i === 0} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewOrderForm({ view, onDone }: { view: OrdersView; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [recipeId, setRecipeId] = React.useState(view.recipes[0]?.id ?? "");
  const [qty, setQty] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const recipe = view.recipes.find((r) => r.id === recipeId);
  const planned = parseQtyMicro(qty);
  const ready = recipe !== undefined && planned !== null && planned > 0n;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    try {
      await apiPost("/api/manufacturing/orders", { spaceId: view.spaceId, recipeId, qty, note: note || null });
      toast(t("mfg.order_created"), "success");
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  if (view.recipes.length === 0) return <p className="rounded-xl border border-border bg-surface-1 p-3 text-sm text-fg-muted">{t("mfg.order_no_recipes")}</p>;
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-surface-1 p-3 sm:grid-cols-2" aria-label={t("mfg.order_new")}>
      <Field label={t("mfg.f.order_recipe")}>
        <Select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
          {view.recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {t("mfg.recipe_version", { n: r.version })}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("mfg.f.order_qty", { unit: recipe?.outputUnit ?? "" })}>
        <Input value={qty} inputMode="decimal" dir="ltr" onChange={(e) => setQty(e.target.value)} aria-invalid={qty.trim() !== "" && !ready} />
      </Field>
      <Field label={t("mfg.f.order_note")} className="sm:col-span-2">
        <Input value={note} maxLength={LIMITS.note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="text-xs text-fg-muted sm:col-span-2">{t("mfg.order_draft_hint")}</p>
      {recipe?.stocked ? <p className="text-xs text-fg-muted sm:col-span-2">{t("mfg.order_finished_will")}</p> : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || !ready}>
          {t("mfg.order_create")}
        </Button>
      </div>
    </form>
  );
}

type Panel = "complete" | "cancel" | "return" | "edit" | null;

function OrderCard({ order, view, onDone, newest }: { order: OrderItem; view: OrdersView; onDone: () => void; newest: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  // the open ones and the newest are shown in full; the finished older ones fold up (a tap opens them)
  const [open, setOpen] = React.useState(newest || order.status === "DRAFT" || order.status === "ISSUED");
  const [panel, setPanel] = React.useState<Panel>(null);
  const [busy, setBusy] = React.useState(false);
  const short = order.lines.some((l) => !l.enough);
  const unpricedUsed = order.lines.some((l) => l.unpricedMicro > 0);

  async function step(path: string, body: Record<string, unknown> | undefined, doneKey: string) {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/api/manufacturing/orders/${order.id}/${path}`, body ?? {});
      toast(t(doneKey), "success");
      setPanel(null);
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-3 text-sm">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 text-start" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="text-base font-medium text-fg">{t("mfg.order_n", { n: order.seq })}</span>
        <span className="text-fg">{order.recipeName}</span>
        <Badge>{t(`mfg.order_status.${order.status}`)}</Badge>
        {order.costIncomplete ? <Badge className="border-warn/40 bg-warn/10 text-fg">⚠️ {t("mfg.order_cost_incomplete_badge")}</Badge> : null}
        <span className="flex-1" />
        <span className="text-xs text-fg-muted">
          <Qty micro={order.plannedMicro} unit={order.outputUnit} />
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-fg-muted">
            {t("mfg.recipe_version", { n: order.version })} · {t("mfg.by", { who: order.createdBy })} · {fmtAgo(order.createdAt)}
          </p>
          {order.note ? <p className="text-xs text-fg-muted">{order.note}</p> : null}

          <div className="space-y-1">
            <p className="text-xs font-medium text-fg">{t("mfg.order_lines")}</p>
            <ul className="grid gap-1">
              {order.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2">
                  <span className="font-medium text-fg">{l.materialName}</span>
                  <span className="text-xs text-fg-muted">
                    {t("mfg.order_required")}: <Qty micro={l.requiredMicro} unit={l.baseUnit} />
                  </span>
                  {order.status === "DRAFT" ? (
                    <span className={l.enough ? "text-xs text-fg-muted" : "text-xs text-danger"}>
                      {t("mfg.order_have")}: <Qty micro={l.balanceMicro} unit={l.baseUnit} />
                      {l.enough ? "" : ` ⚠️ ${t("mfg.order_short_line")}`}
                    </span>
                  ) : (
                    <span className="text-xs text-fg-muted">
                      {t("mfg.order_issued_qty")}: <Qty micro={l.issuedMicro} unit={l.baseUnit} />
                    </span>
                  )}
                  {order.status === "DRAFT" && l.unpricedMicro > 0 ? <span className="text-xs text-warn">⚠️ {t("mfg.order_unpriced_line", { qty: formatQty(l.unpricedMicro), unit: l.baseUnit })}</span> : null}
                </li>
              ))}
            </ul>
          </div>

          {order.status === "COMPLETED" ? (
            <p className="text-xs text-fg-muted">
              {t("mfg.order_actual")}: <Qty micro={order.actualMicro ?? 0} unit={order.outputUnit} />
              {order.wasteMicro ? (
                <>
                  {" · "}
                  {t("mfg.order_waste")}: <Qty micro={order.wasteMicro} unit={order.outputUnit} />
                  {order.wasteNote ? ` (${order.wasteNote})` : ""}
                </>
              ) : null}
            </p>
          ) : null}
          {order.closeNote ? (
            <p className="text-xs text-fg-muted">
              {t("mfg.order_close_note")}: {order.closeNote}
            </p>
          ) : null}

          {order.status === "DRAFT" && order.canIssue ? (
            <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-3">
              <p className="font-medium text-fg">⚠️ {t("mfg.order_issue_warn")}</p>
              <p className="text-fg-muted">🔧 {t("mfg.order_issue_fix")}</p>
              {unpricedUsed ? <p className="text-xs text-fg-muted">⚠️ {t("mfg.order_issue_unpriced")}</p> : null}
              {short ? <p className="text-xs text-danger">{t("mfg.order_issue_blocked")}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || short} onClick={() => void step("issue", undefined, "mfg.order_issued_done")}>
                  {t("mfg.order_issue")}
                </Button>
                {order.canEditDraft ? (
                  <Button size="sm" variant="secondary" onClick={() => setPanel(panel === "edit" ? null : "edit")} aria-expanded={panel === "edit"}>
                    {t("mfg.order_edit")}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setPanel(panel === "cancel" ? null : "cancel")} aria-expanded={panel === "cancel"}>
                  {t("mfg.order_cancel")}
                </Button>
              </div>
            </div>
          ) : null}
          {order.recipeStocked && (order.status === "DRAFT" || order.status === "ISSUED") ? <p className="text-xs text-fg-muted">{t("mfg.order_finished_will")}</p> : null}

          {order.status === "ISSUED" && order.canComplete ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setPanel(panel === "complete" ? null : "complete")} aria-expanded={panel === "complete"}>
                {t("mfg.order_complete")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPanel(panel === "return" ? null : "return")} aria-expanded={panel === "return"}>
                {t("mfg.order_return")}
              </Button>
            </div>
          ) : null}

          {panel === "edit" && order.canEditDraft ? (
            <EditDraftForm
              order={order}
              view={view}
              busy={busy}
              onSend={(body) => {
                if (busy) return;
                setBusy(true);
                apiPatch(`/api/manufacturing/orders/${order.id}`, body)
                  .then(() => {
                    toast(t("mfg.order_edited"), "success");
                    setPanel(null);
                    onDone();
                  })
                  .catch((err: unknown) => toast(mfgErrorText(t, err), "error"))
                  .finally(() => setBusy(false));
              }}
            />
          ) : null}
          {panel === "complete" ? <CompleteForm order={order} busy={busy} onSend={(body) => step("complete", body, "mfg.order_completed_done")} /> : null}
          {panel === "cancel" ? <ReasonForm label={t("mfg.order_cancel_reason")} button={t("mfg.order_cancel")} busy={busy} onSend={(reason) => step("cancel", { reason }, "mfg.order_cancelled_done")} /> : null}
          {panel === "return" ? (
            <div className="space-y-2">
              <div role="note" className="rounded-lg border border-warn/40 bg-warn/10 p-2">
                <p className="font-medium text-fg">⚠️ {t("mfg.order_return_warn")}</p>
                <p className="mt-1 text-fg-muted">🔧 {t("mfg.order_return_fix")}</p>
              </div>
              <ReasonForm label={t("mfg.order_return_reason")} button={t("mfg.order_return")} busy={busy} onSend={(reason) => step("return", { reason }, "mfg.order_returned_done")} />
            </div>
          ) : null}

          {order.finished ? (
            <div role="note" className="rounded-lg border border-border bg-surface p-2 text-xs">
              <p className="font-medium text-fg">
                {t("mfg.order_finished_in", { qty: formatQty(order.finished.qtyMicro), name: order.finished.materialName })}{" "}
                <Link href={`/manufacturing/materials/${order.finished.materialId}`} className="text-accent hover:underline">
                  {t("mfg.finished_open")}
                </Link>
              </p>
              {order.finished.costPending ? (
                <p className="mt-1 text-warn">
                  ⚠️ {t("mfg.order_finished_pending")} · 🔧 {t("mfg.order_finished_pending_fix")}
                </p>
              ) : null}
              <p className="mt-1 text-fg-muted">
                ⚠️ {t("mfg.order_finished_warn")} · 🔧 {t("mfg.order_finished_fix")}
              </p>
            </div>
          ) : null}

          {order.costIncomplete ? (
            <div role="note" className="rounded-lg border border-warn/40 bg-warn/10 p-2">
              <p className="font-medium text-fg">⚠️ {t("mfg.order_cost_incomplete")}</p>
              <p className="mt-1 text-fg-muted">🔧 {t("mfg.order_cost_incomplete_fix")}</p>
            </div>
          ) : null}
          {order.cost ? <CostBox cost={order.cost} order={order} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** «عدّل المسودة»: the quantity, the recipe (it is then made from its newest version) and the note of an order that is still a draft. */
function EditDraftForm({ order, view, busy, onSend }: { order: OrderItem; view: OrdersView; busy: boolean; onSend: (body: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const [recipeId, setRecipeId] = React.useState("");
  const [qty, setQty] = React.useState(formatQty(order.plannedMicro).replace(/,/g, ""));
  const [note, setNote] = React.useState(order.note ?? "");
  const planned = parseQtyMicro(qty);
  const qtyChanged = planned !== null && BigInt(order.plannedMicro) !== planned;
  const noteChanged = note.trim() !== (order.note ?? "");
  const changed = recipeId !== "" || qtyChanged || noteChanged;
  const ready = changed && planned !== null && planned > 0n;
  return (
    <form
      className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2"
      aria-label={t("mfg.order_edit")}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || !ready) return;
        const body: Record<string, unknown> = {};
        if (recipeId !== "") body["recipeId"] = recipeId;
        if (qtyChanged) body["qty"] = qty;
        if (noteChanged) body["note"] = note.trim() === "" ? null : note;
        onSend(body);
      }}
    >
      <Field label={t("mfg.f.order_recipe")}>
        <Select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
          <option value="">{t("mfg.order_edit_recipe_keep")}</option>
          {view.recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {t("mfg.order_edit_recipe_newest", { name: r.name })}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("mfg.f.order_qty", { unit: order.outputUnit })}>
        <Input value={qty} inputMode="decimal" dir="ltr" onChange={(e) => setQty(e.target.value)} aria-invalid={qty.trim() !== "" && !(planned !== null && planned > 0n)} />
      </Field>
      <Field label={t("mfg.f.order_note")} className="sm:col-span-2">
        <Input value={note} maxLength={LIMITS.note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="text-xs text-fg-muted sm:col-span-2">{t("mfg.order_edit_hint")}</p>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy || !ready}>
          {t("mfg.order_edit_save")}
        </Button>
      </div>
    </form>
  );
}

function ReasonForm({ label, button, busy, onSend }: { label: string; button: string; busy: boolean; onSend: (reason: string) => void }) {
  const [reason, setReason] = React.useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && reason.trim().length >= 2) onSend(reason);
      }}
    >
      <Field label={label} className="min-w-0 flex-1">
        <Input value={reason} maxLength={LIMITS.reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button type="submit" size="sm" disabled={busy || reason.trim().length < 2}>
        {button}
      </Button>
    </form>
  );
}

function CompleteForm({ order, busy, onSend }: { order: OrderItem; busy: boolean; onSend: (body: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const [actual, setActual] = React.useState("");
  const [waste, setWaste] = React.useState("");
  const [wasteNote, setWasteNote] = React.useState("");
  const a = parseQtyMicro(actual);
  const w = waste.trim() === "" ? 0n : parseQtyMicro(waste);
  const ready = a !== null && a > 0n && w !== null;
  return (
    <form
      className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && ready) onSend({ actualQty: actual, wasteQty: waste.trim() === "" ? null : waste, wasteNote: wasteNote || null });
      }}
    >
      <Field label={t("mfg.f.actual_qty", { unit: order.outputUnit })}>
        <Input value={actual} inputMode="decimal" dir="ltr" onChange={(e) => setActual(e.target.value)} aria-invalid={actual.trim() !== "" && !(a !== null && a > 0n)} />
      </Field>
      <Field label={t("mfg.f.waste_qty", { unit: order.outputUnit })}>
        <Input value={waste} inputMode="decimal" dir="ltr" onChange={(e) => setWaste(e.target.value)} aria-invalid={waste.trim() !== "" && w === null} />
      </Field>
      <Field label={t("mfg.f.waste_note")}>
        <Input value={wasteNote} maxLength={LIMITS.reason} onChange={(e) => setWasteNote(e.target.value)} />
      </Field>
      <p className="text-xs text-fg-muted sm:col-span-3">{t("mfg.order_waste_hint")}</p>
      <div className="sm:col-span-3">
        <Button type="submit" size="sm" disabled={busy || !ready}>
          {t("mfg.order_complete_save")}
        </Button>
      </div>
    </form>
  );
}

/** The cost with its formula: every piece (so much from a lot at the lot's price), the total (rounded once, from the exact sum) and the cost of one output unit. Cost holders only. */
function CostBox({ cost, order }: { cost: OrderCost; order: OrderItem }) {
  const { t } = useI18n();
  const currencyName = useCurrencyName();
  return (
    <section aria-label={t("mfg.order_cost_title")} className="space-y-2 rounded-xl border border-border bg-surface p-3">
      <p className="text-xs font-medium text-fg-muted">{t("mfg.order_cost_title")}</p>
      <p className="text-xs text-fg-muted">{t("mfg.order_cost_formula")}</p>
      {cost.frozen ? (
        <div role="note" className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">
          <p className="font-medium text-fg">⚠️ {t("mfg.order_cost_frozen_warn")}</p>
          <p className="mt-1 text-fg-muted">🔧 {t("mfg.order_cost_frozen_fix")}</p>
          <p className="mt-1 text-fg-muted">{t("mfg.order_cost_frozen")}</p>
        </div>
      ) : null}
      <ul className="grid gap-2">
        {cost.lines.map((line) => (
          <li key={line.materialName} className="text-xs">
            <p className="font-medium text-fg">
              {line.materialName} · <Qty micro={line.qtyMicro} unit={line.baseUnit} />
            </p>
            <ul className="mt-1 grid gap-0.5 text-fg-muted">
              {line.pieces.map((p, i) => (
                <li key={i} className="flex flex-wrap gap-x-2">
                  <span>{p.lotReceivedOn ? t("mfg.order_cost_lot", { date: p.lotReceivedOn }) : t("mfg.order_cost_nolot")}</span>
                  <span dir="ltr">{formatQty(p.qtyMicro)}</span>
                  {p.unitText !== null && line.currency ? (
                    <>
                      <span>×</span>
                      <span dir="ltr">{p.unitText}</span>
                      <span>=</span>
                      <span dir="ltr">{p.amountMinor !== null ? formatMinor(p.amountMinor, line.currency) : ""}</span>
                    </>
                  ) : (
                    <span className="text-warn">⚠️ {t("mfg.order_cost_no_price")}</span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {cost.totals.length === 0 ? (
        <p className="text-xs text-warn">{t("mfg.order_cost_nothing")}</p>
      ) : (
        <ul className="grid gap-1">
          {cost.totals.map((total) => (
            <li key={total.currency} className="text-sm">
              <p className="font-semibold text-fg">
                {t("mfg.order_cost_total")}: <Money minor={total.totalMinor} currency={total.currency} />
              </p>
              {total.perUnitText !== null && order.actualMicro ? (
                <p className="text-xs text-fg-muted">
                  {t("mfg.order_cost_per_unit", { unit: order.outputUnit })}: <span dir="ltr">{formatMinor(total.totalMinor, total.currency)}</span> ÷ <span dir="ltr">{formatQty(order.actualMicro)}</span> ={" "}
                  <span dir="ltr">{total.perUnitText}</span> {currencyName(total.currency)}
                </p>
              ) : (
                <p className="text-xs text-fg-muted">{t("mfg.order_cost_per_unit_later")}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-muted">{t("mfg.order_cost_round_note")}</p>
    </section>
  );
}
