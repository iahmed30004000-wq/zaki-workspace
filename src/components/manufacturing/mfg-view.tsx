"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Plus, Truck } from "lucide-react";
import { apiPatch, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { LIMITS } from "@/lib/manufacturing/shared";
import type { CountItem, MaterialListItem, MfgOverview, SupplierItem } from "@/lib/manufacturing/view";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Field, MfgTabs, Money, NotAccountingNote, Qty, SectionTitle, mfgErrorText } from "./ui";

/**
 * «مخزون التصنيع» — the front page of a manufacturing space's ledger: the materials with their balance (and a ⚠️ with its 🔧 where one is low),
 * the stocktakes waiting for a second person, and the suppliers. The server decided what this person may read (no cost field unless they hold
 * `manufacturing.cost`) and what they may do; this draws it, and every button asks the server again.
 */
export function MfgView({ initial }: { initial: MfgOverview }) {
  const { t } = useI18n();
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  React.useEffect(() => setData(initial), [initial]);
  const [showArchived, setShowArchived] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  const live = data.materials.filter((m) => !m.archived);
  const shown = showArchived ? data.materials : live;
  const lowCount = live.filter((m) => m.low).length;
  const csv = `/api/manufacturing/csv?spaceId=${encodeURIComponent(data.spaceId)}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <MfgTabs current="stock" />
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{t("mfg.title")}</h1>
          <p className="text-xs text-fg-muted">{t("mfg.subtitle", { space: data.spaceName })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={csv} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm text-fg hover:bg-surface-2 md:h-8">
            <Download className="size-4" aria-hidden />
            {t("mfg.csv")}
          </a>
          {data.canEdit ? (
            <Button size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              <Plus className="size-4" aria-hidden />
              {t("mfg.material_new")}
            </Button>
          ) : null}
        </div>
      </header>

      <NotAccountingNote />
      {!data.canEdit ? <p className="text-xs text-fg-muted">{t("mfg.read_only")}</p> : null}
      {!data.canCost ? <p className="text-xs text-fg-muted">{t("mfg.no_cost_note")}</p> : null}

      {lowCount > 0 ? (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-fg">
          <p className="font-medium">⚠️ {t("mfg.low_banner", { n: lowCount })}</p>
          <p className="mt-1 text-fg-muted">🔧 {t("mfg.low_fix")}</p>
        </div>
      ) : null}

      {adding && data.canEdit ? <NewMaterialForm spaceId={data.spaceId} onDone={() => { setAdding(false); router.refresh(); }} /> : null}

      <section className="space-y-2">
        <SectionTitle
          aside={
            data.materials.some((m) => m.archived) ? (
              <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                {t("mfg.show_archived")}
              </label>
            ) : null
          }
        >
          {t("mfg.materials")}
        </SectionTitle>
        {shown.length === 0 ? (
          <EmptyState title={t("mfg.empty")} hint={data.canEdit ? t("mfg.empty_hint") : t("mfg.empty_hint_view")} />
        ) : (
          <ul className="grid gap-2">
            {shown.map((m) => (
              <MaterialRow key={m.id} m={m} />
            ))}
          </ul>
        )}
      </section>

      <PendingCounts items={data.pending} onDone={() => router.refresh()} />

      <Suppliers spaceId={data.spaceId} items={data.suppliers} canEdit={data.canEdit} onChange={() => router.refresh()} />
    </div>
  );
}

function MaterialRow({ m }: { m: MaterialListItem }) {
  const { t } = useI18n();
  return (
    <li>
      <Link href={`/manufacturing/materials/${m.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-surface-1 p-3 transition-colors hover:bg-surface-2">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-fg">{m.name}</span>
            {m.code ? <span className="text-xs text-fg-muted">{m.code}</span> : null}
            {m.archived ? <Badge>{t("mfg.archived")}</Badge> : null}
            {m.pendingCount ? <Badge className="border-warn/40 bg-warn/10 text-fg">{t("mfg.count_waiting")}</Badge> : null}
          </span>
          {m.low ? (
            <span className="mt-1 block text-xs text-danger">
              ⚠️ {t("mfg.low")} · 🔧 {t("mfg.low_fix_short")}
            </span>
          ) : null}
        </span>
        <span className="text-sm font-semibold text-fg">
          <Qty micro={m.balanceMicro} unit={m.baseUnit} />
        </span>
        {m.cost && m.cost.currency ? (
          <span className="text-xs text-fg-muted">
            {t("mfg.value")}: <Money minor={m.cost.valueMinor} currency={m.cost.currency} />
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function NewMaterialForm({ spaceId, onDone }: { spaceId: string; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [baseUnit, setBaseUnit] = React.useState("");
  const [lowStock, setLowStock] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await apiPost("/api/manufacturing/materials", { spaceId, name, code: code || null, baseUnit, lowStock: lowStock || null });
      toast(t("mfg.material_created"), "success");
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-surface-1 p-3 sm:grid-cols-2">
      <Field label={t("mfg.f.name")}>
        <Input value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} placeholder={t("mfg.f.name_ph")} required />
      </Field>
      <Field label={t("mfg.f.code")}>
        <Input value={code} maxLength={LIMITS.code} onChange={(e) => setCode(e.target.value)} placeholder={t("mfg.f.code_ph")} />
      </Field>
      <Field label={t("mfg.f.base_unit")}>
        <Input value={baseUnit} maxLength={LIMITS.unit} onChange={(e) => setBaseUnit(e.target.value)} placeholder={t("mfg.f.base_unit_ph")} required />
      </Field>
      <Field label={t("mfg.f.low_stock")}>
        <Input value={lowStock} inputMode="decimal" dir="ltr" onChange={(e) => setLowStock(e.target.value)} placeholder={t("mfg.f.low_stock_ph")} />
      </Field>
      <p className="text-xs text-fg-muted sm:col-span-2">{t("mfg.f.base_unit_hint")}</p>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || name.trim() === "" || baseUnit.trim() === ""}>
          {t("mfg.material_create")}
        </Button>
      </div>
    </form>
  );
}

function PendingCounts({ items, onDone }: { items: CountItem[]; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <section className="space-y-2">
      <SectionTitle>{t("mfg.pending_title")}</SectionTitle>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("mfg.pending_none")}</p>
      ) : (
        <>
          <p className="text-xs text-fg-muted">{t("mfg.pending_hint")}</p>
          <ul className="grid gap-2">
            {items.map((c) => (
              <li key={c.id}>
                <CountCard c={c} onDone={onDone} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** A stocktake and, while it waits, the second person's two buttons. Used on the front page and on the material's own page. */
export function CountCard({ c, onDone }: { c: CountItem; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function decide(decision: "approve" | "reject") {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/api/manufacturing/counts/${c.id}/decide`, { decision, note: note || null });
      toast(t(decision === "approve" ? "mfg.count_approved" : "mfg.count_rejected"), "success");
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/manufacturing/materials/${c.materialId}`} className="font-medium text-accent hover:underline">
          {c.materialName}
        </Link>
        <Badge>{t(`mfg.count_status.${c.status}`)}</Badge>
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        {t("mfg.count_line", { by: c.countedBy })}: {t("mfg.counted")} <Qty micro={c.countedMicro} unit={c.baseUnit} /> · {t("mfg.expected")} <Qty micro={c.expectedMicro} unit={c.baseUnit} /> · {t("mfg.diff")}{" "}
        <Qty micro={c.diffMicro} unit={c.baseUnit} className={c.diffMicro < 0 ? "text-danger" : "text-ok"} />
      </p>
      {c.note ? <p className="mt-1 text-xs text-fg-muted">{c.note}</p> : null}
      {c.status !== "PENDING" && c.decidedBy ? (
        <p className="mt-1 text-xs text-fg-muted">{t("mfg.decided_by", { who: c.decidedBy })}{c.decisionNote ? ` · ${c.decisionNote}` : ""}</p>
      ) : null}
      {c.status === "PENDING" ? (
        c.canDecide ? (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Field label={t("mfg.decision_note")} className="min-w-0 flex-1">
              <Input value={note} maxLength={LIMITS.reason} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button size="sm" disabled={busy} onClick={() => void decide("approve")}>
              {t("mfg.approve")}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide("reject")}>
              {t("mfg.reject")}
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-warn">⚠️ {t("mfg.needs_second")}</p>
        )
      ) : null}
    </div>
  );
}

function Suppliers({ spaceId, items, canEdit, onChange }: { spaceId: string; items: SupplierItem[]; canEdit: boolean; onChange: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy || name.trim() === "") return;
    setBusy(true);
    try {
      await apiPost("/api/manufacturing/suppliers", { spaceId, name, note: note || null });
      setName("");
      setNote("");
      onChange();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function archive(s: SupplierItem) {
    try {
      await apiPatch(`/api/manufacturing/suppliers/${s.id}`, { archived: !s.archived });
      onChange();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    }
  }

  return (
    <section className="space-y-2">
      <SectionTitle>{t("mfg.suppliers")}</SectionTitle>
      <p className="text-xs text-fg-muted">{t("mfg.suppliers_hint")}</p>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("mfg.suppliers_none")}</p>
      ) : (
        <ul className="grid gap-1">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm">
              <Truck className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <span className="font-medium text-fg">{s.name}</span>
              {s.note ? <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{s.note}</span> : <span className="flex-1" />}
              {s.archived ? <Badge>{t("mfg.archived")}</Badge> : null}
              {canEdit ? (
                <Button size="sm" variant="ghost" onClick={() => void archive(s)}>
                  {s.archived ? t("mfg.restore") : t("mfg.archive")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-1 p-3">
          <Field label={t("mfg.f.supplier_name")} className="min-w-0 flex-1">
            <Input value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("mfg.f.supplier_note")} className="min-w-0 flex-1">
            <Input value={note} maxLength={LIMITS.supplierNote} onChange={(e) => setNote(e.target.value)} placeholder={t("mfg.f.supplier_note_ph")} />
          </Field>
          <Button type="submit" disabled={busy || name.trim() === ""}>
            <Plus className="size-4" aria-hidden />
            {t("mfg.supplier_add")}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
