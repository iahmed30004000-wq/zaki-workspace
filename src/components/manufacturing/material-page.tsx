"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, FileText } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { fmtAgo, fmtDMY } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { LIMITS, displayIn, formatMinor, formatQty } from "@/lib/manufacturing/shared";
import type { LotItem, MaterialDetail, MovementItem } from "@/lib/manufacturing/view";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CountCard } from "./mfg-view";
import { CorrectPriceForm, CostLotForm, EditMaterial, MoveForm, ReceiveForm, UnitsEditor } from "./stock-forms";
import { MfgTabs, Money, NotAccountingNote, Qty, SectionTitle, mfgErrorText, useCurrencyName } from "./ui";

type Panel = "receive" | "issue" | "count" | "adjust" | "edit" | null;

/**
 * One material: the balance (the SUM of its movements) with its low-stock mark, the conversions, the forms that move stock, the lots with
 * their proof, the movements with the button that reverses a mistake, the stocktakes, and, for a holder of the cost, the weighted average with the
 * formula that made it. Nothing is edited in place: a mistake is a new movement that undoes the old one.
 */
export function MaterialPage({ initial }: { initial: MaterialDetail }) {
  const { t } = useI18n();
  const router = useRouter();
  const [detail, setDetail] = React.useState(initial);
  React.useEffect(() => setDetail(initial), [initial]);
  const [panel, setPanel] = React.useState<Panel>(null);

  const done = () => {
    setPanel(null);
    router.refresh();
  };
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const csv = (what: "movements" | "lots") => `/api/manufacturing/csv?materialId=${encodeURIComponent(detail.id)}&what=${what}`;
  const activeUnits = detail.units.filter((u) => !u.archived);
  const pending = detail.counts.some((c) => c.status === "PENDING");

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4">
      <MfgTabs current="stock" sub="materials" />
      <Link href="/manufacturing" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowRight className="size-3.5" aria-hidden />
        {t("mfg.back")}
      </Link>

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{detail.name}</h1>
          {detail.code ? <span className="text-xs text-fg-muted">{detail.code}</span> : null}
          {detail.archived ? <Badge>{t("mfg.archived")}</Badge> : null}
        </div>
        <p className="text-xs text-fg-muted">{t("mfg.base_unit_is", { unit: detail.baseUnit })}</p>
      </header>

      <section aria-label={t("mfg.balance")} className="space-y-2 rounded-xl border border-border bg-surface-1 p-3">
        <p className="text-xs text-fg-muted">{t("mfg.balance_formula")}</p>
        <p className="text-2xl font-semibold text-fg">
          <Qty micro={detail.balanceMicro} unit={detail.baseUnit} />
        </p>
        {activeUnits.length > 0 ? (
          <p className="text-xs text-fg-muted">
            {activeUnits.map((u, i) => (
              <span key={u.id}>
                {i > 0 ? " · " : ""}
                <span dir="ltr">{displayIn(detail.balanceMicro, u)}</span> {u.label}
              </span>
            ))}
          </p>
        ) : null}
        {detail.low ? (
          <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-2 text-sm">
            <p className="font-medium text-fg">
              ⚠️ {t("mfg.low_material", { qty: detail.lowStockMicro === null ? "" : formatQty(detail.lowStockMicro), unit: detail.baseUnit })}
            </p>
            <p className="mt-1 text-fg-muted">🔧 {t("mfg.low_fix")}</p>
          </div>
        ) : null}
        {pending ? <p className="text-xs text-warn">⚠️ {t("mfg.pending_material")}</p> : null}
        {detail.unpricedMicro > 0 ? (
          <div role="note" className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-sm">
            <p className="font-medium text-fg">
              ⚠️ {t("mfg.unpriced_stock", { qty: formatQty(detail.unpricedMicro), unit: detail.baseUnit })}
            </p>
            <p className="mt-1 text-fg-muted">🔧 {detail.canCost ? t("mfg.unpriced_stock_fix_cost") : t("mfg.unpriced_stock_fix")}</p>
          </div>
        ) : null}
      </section>

      {detail.canCost ? <AverageBox detail={detail} /> : <p className="text-xs text-fg-muted">{t("mfg.no_cost_note")}</p>}

      <NotAccountingNote />

      {!detail.canEdit ? <p className="text-xs text-fg-muted">{t("mfg.read_only")}</p> : null}
      {detail.canEdit && !detail.archived ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("mfg.actions")}>
          <Button size="sm" variant={panel === "receive" ? "primary" : "secondary"} onClick={() => toggle("receive")} aria-expanded={panel === "receive"}>
            {detail.canCost ? t("mfg.receive") : t("mfg.receive_unpriced")}
          </Button>
          <Button size="sm" variant={panel === "issue" ? "primary" : "secondary"} onClick={() => toggle("issue")} aria-expanded={panel === "issue"}>
            {t("mfg.issue")}
          </Button>
          <Button size="sm" variant={panel === "count" ? "primary" : "secondary"} onClick={() => toggle("count")} aria-expanded={panel === "count"}>
            {t("mfg.count")}
          </Button>
          <Button size="sm" variant={panel === "adjust" ? "primary" : "secondary"} onClick={() => toggle("adjust")} aria-expanded={panel === "adjust"}>
            {t("mfg.adjust")}
          </Button>
          <Button size="sm" variant={panel === "edit" ? "primary" : "ghost"} onClick={() => toggle("edit")} aria-expanded={panel === "edit"}>
            {t("common.edit")}
          </Button>
        </div>
      ) : null}
      {detail.canEdit && !detail.canCost ? <p className="text-xs text-fg-muted">{t("mfg.receive_needs_cost")}</p> : null}
      {detail.canEdit && detail.archived ? (
        <Button size="sm" variant="secondary" onClick={() => toggle("edit")}>
          {t("common.edit")}
        </Button>
      ) : null}

      {panel === "receive" ? <ReceiveForm detail={detail} onDone={done} /> : null}
      {panel === "issue" ? <MoveForm kind="issue" detail={detail} onDone={done} /> : null}
      {panel === "count" ? <MoveForm kind="count" detail={detail} onDone={done} /> : null}
      {panel === "adjust" ? <MoveForm kind="adjust" detail={detail} onDone={done} /> : null}
      {panel === "edit" ? <EditMaterial detail={detail} onDone={done} /> : null}

      <section className="space-y-2">
        <SectionTitle>{t("mfg.units")}</SectionTitle>
        <UnitsEditor detail={detail} onDone={() => router.refresh()} />
      </section>

      {detail.counts.length > 0 ? (
        <section className="space-y-2">
          <SectionTitle>{t("mfg.counts")}</SectionTitle>
          <ul className="grid gap-2">
            {detail.counts.map((c) => (
              <li key={c.id}>
                <CountCard c={c} onDone={() => router.refresh()} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2">
        <SectionTitle
          aside={
            <a href={csv("lots")} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <Download className="size-3.5" aria-hidden />
              {t("mfg.csv")}
            </a>
          }
        >
          {t("mfg.lots")}
        </SectionTitle>
        {detail.lots.length === 0 ? <p className="text-sm text-fg-muted">{t("mfg.lots_none")}</p> : <ul className="grid gap-2">{detail.lots.map((l) => <LotRow key={l.id} lot={l} baseUnit={detail.baseUnit} currency={detail.cost?.currency ?? null} onDone={() => router.refresh()} />)}</ul>}
      </section>

      <section className="space-y-2">
        <SectionTitle
          aside={
            <a href={csv("movements")} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <Download className="size-3.5" aria-hidden />
              {t("mfg.csv")}
            </a>
          }
        >
          {t("mfg.movements")}
        </SectionTitle>
        <p className="text-xs text-fg-muted">{t("mfg.movements_hint")}</p>
        {detail.movements.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("mfg.movements_none")}</p>
        ) : (
          <ul className="grid gap-1">
            {detail.movements.map((m) => (
              <MovementRow key={m.id} m={m} baseUnit={detail.baseUnit} currency={detail.cost?.currency ?? null} onDone={() => router.refresh()} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The weighted average with the formula that made it: the owner reads the number and how it was reached, in one small box. */
function AverageBox({ detail }: { detail: MaterialDetail }) {
  const { t } = useI18n();
  const currencyName = useCurrencyName();
  const cost = detail.cost;
  if (!cost) return null;
  return (
    <section aria-label={t("mfg.average")} className="space-y-1 rounded-xl border border-border bg-surface-1 p-3 text-sm">
      <p className="text-xs font-medium text-fg-muted">{t("mfg.average_title", { unit: detail.baseUnit })}</p>
      {cost.formula && cost.currency ? (
        <>
          <p className="font-semibold text-fg">
            <span dir="ltr">{cost.formula.average}</span> {currencyName(cost.currency)}
          </p>
          <p className="text-xs text-fg-muted">
            {t("mfg.formula")}: <span dir="ltr">{cost.formula.value}</span> ÷ <span dir="ltr">{cost.formula.qty}</span> = <span dir="ltr">{cost.formula.average}</span>
          </p>
          <p className="text-xs text-fg-muted">{t("mfg.formula_explain")}</p>
          <p className="text-xs text-fg-muted">
            {t("mfg.value")}: <Money minor={cost.valueMinor} currency={cost.currency} />
          </p>
          {detail.unpricedMicro > 0 ? (
            <p className="text-xs text-warn">
              ⚠️ {t("mfg.average_excludes", { qty: formatQty(detail.unpricedMicro), unit: detail.baseUnit })} · 🔧 {t("mfg.unpriced_stock_fix_cost")}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-fg-muted">{t("mfg.average_none")}</p>
      )}
    </section>
  );
}

function LotRow({ lot, baseUnit, currency, onDone }: { lot: LotItem; baseUnit: string; currency: string | null; onDone: () => void }) {
  const { t } = useI18n();
  const [filling, setFilling] = React.useState(false);
  const [correcting, setCorrecting] = React.useState(false);
  return (
    <li className="rounded-xl border border-border bg-surface-1 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-fg">{fmtDMY(lot.receivedOn)}</span>
        <span>
          <Qty micro={lot.enteredQtyMicro} unit={lot.enteredUnitLabel} />
          {lot.enteredUnitLabel !== baseUnit ? (
            <span className="text-xs text-fg-muted">
              {" "}
              (= <Qty micro={lot.qtyMicro} unit={baseUnit} />)
            </span>
          ) : null}
        </span>
        {lot.supplier ? <span className="text-xs text-fg-muted">{lot.supplier.name}</span> : null}
        {lot.expiresOn ? <span className="text-xs text-fg-muted">{t("mfg.expires", { date: fmtDMY(lot.expiresOn) })}</span> : null}
        {lot.reversed ? <Badge className="border-danger/40 bg-danger/10 text-fg">{t("mfg.reversed")}</Badge> : null}
      </div>
      {lot.costPending ? (
        <div role="note" className="mt-1 rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">
          <p className="font-medium text-fg">⚠️ {t("mfg.lot_unpriced")}</p>
          <p className="mt-1 text-fg-muted">🔧 {lot.canFillCost ? t("mfg.lot_unpriced_fix_cost") : t("mfg.lot_unpriced_fix")}</p>
          {lot.canFillCost ? (
            filling ? (
              <CostLotForm lotId={lot.id} unitLabel={lot.enteredUnitLabel} enteredQtyMicro={lot.enteredQtyMicro} fixedCurrency={currency} onDone={onDone} />
            ) : (
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => setFilling(true)}>
                {t("mfg.cost_fill")}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      {lot.costedLater ? <p className="mt-1 text-xs text-fg-muted">{t("mfg.costed_by", { who: lot.costedLater.by, when: fmtAgo(lot.costedLater.at) })}</p> : null}
      {lot.correctionCount > 0 ? <p className="mt-1 text-xs text-warn">⚠️ {t("mfg.price_corrections_count", { n: lot.correctionCount })}</p> : null}
      {lot.cost ? (
        <p className="mt-1 text-xs text-fg-muted">
          {t("mfg.lot_price", { unit: lot.enteredUnitLabel })}: <Money minor={lot.cost.unitCostMinor} currency={lot.cost.currency} /> · {t("mfg.lot_total")}: <Money minor={lot.cost.totalCostMinor} currency={lot.cost.currency} />
        </p>
      ) : null}
      {lot.canCorrectPrice && lot.cost ? (
        <div className="mt-1">
          {correcting ? (
            <CorrectPriceForm lotId={lot.id} unitLabel={lot.enteredUnitLabel} enteredQtyMicro={lot.enteredQtyMicro} currency={lot.cost.currency} onDone={onDone} />
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setCorrecting(true)}>
              {t("mfg.price_correct")}
            </Button>
          )}
        </div>
      ) : null}
      {lot.priceHistory.length > 1 ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-accent">{t("mfg.price_history")}</summary>
          <ul className="mt-2 grid gap-1">
            {lot.priceHistory.map((step) => (
              <li key={step.seq} className="rounded-lg border border-border bg-surface p-2">
                <p className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium text-fg">{step.seq === 0 ? t("mfg.price_first") : t("mfg.price_correction_n", { n: step.seq })}</span>
                  {step.current ? <Badge>{t("mfg.price_current")}</Badge> : null}
                  <span dir="ltr">{formatMinor(step.unitCostMinor, step.currency)}</span>
                  <span className="text-fg-muted">
                    {t("mfg.lot_total")}: <span dir="ltr">{formatMinor(step.totalCostMinor, step.currency)}</span>
                  </span>
                </p>
                {step.reason ? (
                  <p className="mt-1 text-fg-muted">
                    {t("mfg.price_reason")}: {step.reason}
                  </p>
                ) : null}
                <p className="mt-1 text-fg-muted">
                  {t("mfg.by", { who: step.by })} · {fmtAgo(step.at)}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {lot.note ? <p className="mt-1 text-xs text-fg-muted">{lot.note}</p> : null}
      <div className="mt-2 text-xs">
        {lot.proof ? (
          <a href={lot.proof.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-accent hover:underline">
            {lot.proof.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lot.proof.url} alt={t("mfg.proof_alt")} className="h-14 w-14 rounded-md border border-border object-cover" />
            ) : (
              <FileText className="size-5" aria-hidden />
            )}
            {t("mfg.proof_open")}
          </a>
        ) : (
          <div className="rounded-lg border border-warn/40 bg-warn/10 p-2">
            <p className="font-medium text-fg">⚠️ {t("mfg.no_proof")}{lot.proofNote ? `: ${lot.proofNote}` : ""}</p>
            <p className="mt-1 text-fg-muted">🔧 {t("mfg.no_proof_fix")}</p>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-fg-muted">{t("mfg.by", { who: lot.createdBy })} · {fmtAgo(lot.createdAt)}</p>
    </li>
  );
}

function MovementRow({ m, baseUnit, currency, onDone }: { m: MovementItem; baseUnit: string; currency: string | null; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [asking, setAsking] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function reverse(event: React.FormEvent) {
    event.preventDefault();
    if (busy || reason.trim().length < 2) return;
    setBusy(true);
    try {
      await apiPost(`/api/manufacturing/movements/${m.id}/reverse`, { reason });
      toast(t("mfg.reversed_done"), "success");
      setAsking(false);
      setReason("");
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  const out = m.qtyMicro < 0;
  return (
    <li className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge>{t(`mfg.kind.${m.kind}`)}</Badge>
        <span className={out ? "font-medium text-danger" : "font-medium text-ok"}>
          <span dir="ltr">{out ? "−" : "+"}</span> <Qty micro={Math.abs(m.qtyMicro)} unit={baseUnit} />
        </span>
        {m.valueMinor !== null && currency ? (
          <span className="text-xs text-fg-muted">
            <Money minor={Math.abs(m.valueMinor)} currency={currency} />
          </span>
        ) : null}
        {m.reversedById ? <Badge className="border-danger/40 bg-danger/10 text-fg">{t("mfg.reversed")}</Badge> : null}
        {m.reversesId ? <Badge>{t("mfg.is_reversal")}</Badge> : null}
        <span className="flex-1" />
        <span className="text-xs text-fg-muted">
          {m.createdBy} · {fmtAgo(m.createdAt)}
        </span>
        {m.canReverse && !asking ? (
          <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
            {t("mfg.reverse")}
          </Button>
        ) : null}
      </div>
      {m.reason ? <p className="mt-1 text-xs text-fg-muted">{m.reason}</p> : null}
      {asking ? (
        <form onSubmit={reverse} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs text-fg-muted">
            <span className="mb-1 block font-medium">{t("mfg.reverse_reason")}</span>
            <Input value={reason} maxLength={LIMITS.reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </label>
          <Button type="submit" size="sm" disabled={busy || reason.trim().length < 2}>
            {t("mfg.reverse_confirm")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>
            {t("common.cancel")}
          </Button>
        </form>
      ) : null}
    </li>
  );
}
