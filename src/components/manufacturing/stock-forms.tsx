"use client";

import * as React from "react";
import { apiDelete, apiPatch, apiPost, apiUpload } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import {
  DEFAULT_CURRENCY,
  LIMITS,
  formatMinor,
  formatQty,
  lineTotalMinor,
  parseMinor,
  parseQtyMicro,
  toBaseMicro,
} from "@/lib/manufacturing/shared";
import type { MaterialDetail, MfgUnit } from "@/lib/manufacturing/view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { CURRENCY_CODES, Field, mfgErrorText, useCurrencyName } from "./ui";

/** Today as the date box wants it, in the person's own day (set after the first paint so the server and the browser never disagree). */
function todayText(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The unit choices of a material: its base unit first (the empty id), then its active conversions. */
function UnitSelect({ detail, value, onChange }: { detail: Pick<MaterialDetail, "baseUnit" | "units">; value: string; onChange: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <Field label={t("mfg.f.unit")}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{detail.baseUnit}</option>
        {detail.units
          .filter((u) => !u.archived)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
      </Select>
    </Field>
  );
}

function conversionOf(detail: Pick<MaterialDetail, "units">, unitId: string): { num: number; den: number } {
  const unit = detail.units.find((u) => u.id === unitId);
  return unit ? { num: unit.num, den: unit.den } : { num: 1, den: 1 };
}

function labelOf(detail: Pick<MaterialDetail, "baseUnit" | "units">, unitId: string): string {
  return detail.units.find((u) => u.id === unitId)?.label ?? detail.baseUnit;
}

// ───────────────────────────────────────── receive ─────────────────────────────────────────

/**
 * «استلام دفعة»: a receipt with its proof. The quantity can be typed in the base unit or in one of the conversions; the page shows, before
 * anything is sent, what it comes to in base units and the exact total, so a wrong unit is seen at once. The photo goes through the chat upload
 * route (sniffed and size-limited there); without one, the reason is required.
 */
export function ReceiveForm({ detail, onDone }: { detail: MaterialDetail; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const currencyName = useCurrencyName();
  const fixedCurrency = detail.cost?.currency ?? null;
  const [unitId, setUnitId] = React.useState("");
  const [qty, setQty] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [currency, setCurrency] = React.useState(fixedCurrency ?? DEFAULT_CURRENCY);
  const [supplierId, setSupplierId] = React.useState("");
  const [receivedOn, setReceivedOn] = React.useState("");
  const [expiresOn, setExpiresOn] = React.useState("");
  const [note, setNote] = React.useState("");
  const [proof, setProof] = React.useState<{ id: string; name: string } | null>(null);
  const [noProof, setNoProof] = React.useState(false);
  const [proofNote, setProofNote] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setReceivedOn((v) => v || todayText()), []);
  React.useEffect(() => {
    if (fixedCurrency) setCurrency(fixedCurrency);
  }, [fixedCurrency]);

  const conversion = conversionOf(detail, unitId);
  const unitLabel = labelOf(detail, unitId);
  const entered = parseQtyMicro(qty);
  const base = entered !== null && entered > 0n ? toBaseMicro(entered, conversion) : null;
  const unitCost = parseMinor(price, currency);
  const total = entered !== null && entered > 0n && unitCost !== null ? lineTotalMinor(entered, unitCost) : null;
  const qtyProblem = qty.trim() !== "" && (entered === null || entered <= 0n || base === null);
  const proofOk = proof !== null || (noProof && proofNote.trim().length >= 2);
  const ready = base !== null && unitCost !== null && receivedOn !== "" && proofOk;

  async function pick(file: File | null | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("kind", file.type.startsWith("image/") ? "IMAGE" : "FILE");
      form.set("file", file);
      const made = await apiUpload<{ id: string }>("/api/chat/uploads", form);
      setProof({ id: made.id, name: file.name });
      setNoProof(false);
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    try {
      await apiPost(`/api/manufacturing/materials/${detail.id}/receive`, {
        unitId: unitId || null,
        qty,
        unitCost: price,
        currency,
        supplierId: supplierId || null,
        receivedOn,
        expiresOn: expiresOn || null,
        note: note || null,
        proofFileId: proof?.id ?? null,
        proofNote: proof ? null : proofNote,
      });
      toast(t("mfg.received"), "success");
      setQty("");
      setPrice("");
      setNote("");
      setExpiresOn("");
      setProof(null);
      setNoProof(false);
      setProofNote("");
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-surface-1 p-3 sm:grid-cols-2" aria-label={t("mfg.receive")}>
      <UnitSelect detail={detail} value={unitId} onChange={setUnitId} />
      <Field label={t("mfg.f.qty")}>
        <Input value={qty} inputMode="decimal" dir="ltr" onChange={(e) => setQty(e.target.value)} aria-invalid={qtyProblem} />
      </Field>
      <Field label={t("mfg.f.price_per", { unit: unitLabel })}>
        <Input value={price} inputMode="decimal" dir="ltr" onChange={(e) => setPrice(e.target.value)} aria-invalid={price.trim() !== "" && unitCost === null} />
      </Field>
      <Field label={t("mfg.f.currency")}>
        <Select value={currency} disabled={fixedCurrency !== null} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCY_CODES.map((code) => (
            <option key={code} value={code}>
              {currencyName(code)}
            </option>
          ))}
        </Select>
      </Field>
      {fixedCurrency ? <p className="text-xs text-fg-muted sm:col-span-2">{t("mfg.currency_fixed", { currency: currencyName(fixedCurrency) })}</p> : null}

      <div aria-live="polite" className="rounded-lg border border-border bg-surface p-2 text-xs text-fg sm:col-span-2">
        {qtyProblem ? (
          <span className="text-danger">{entered !== null && entered > 0n && base === null ? t("mfg.e.qty_exact") : t("mfg.e.qty")}</span>
        ) : base !== null && entered !== null ? (
          <>
            <p>
              {t("mfg.preview_base")}: <span dir="ltr">{formatQty(entered)}</span> {unitLabel} = <span dir="ltr">{formatQty(base)}</span> {detail.baseUnit}
            </p>
            {total !== null && unitCost !== null ? (
              <p>
                {t("mfg.preview_total")}: <span dir="ltr">{formatQty(entered)}</span> × <span dir="ltr">{formatMinor(unitCost, currency)}</span> = <span dir="ltr">{formatMinor(total, currency)}</span> {currencyName(currency)}
              </p>
            ) : null}
          </>
        ) : (
          <span className="text-fg-muted">{t("mfg.preview_empty")}</span>
        )}
      </div>

      <Field label={t("mfg.f.supplier")}>
        <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">{t("mfg.f.no_supplier")}</option>
          {detail.suppliers
            .filter((s) => !s.archived)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label={t("mfg.f.received_on")}>
        <Input type="date" dir="ltr" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} required />
      </Field>
      <Field label={t("mfg.f.expires_on")}>
        <Input type="date" dir="ltr" value={expiresOn} min={receivedOn || undefined} onChange={(e) => setExpiresOn(e.target.value)} />
      </Field>
      <Field label={t("mfg.f.note")}>
        <Input value={note} maxLength={LIMITS.note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <div className="space-y-2 rounded-lg border border-border p-2 sm:col-span-2">
        <p className="text-xs font-medium text-fg">{t("mfg.proof_title")}</p>
        <p className="text-xs text-fg-muted">{t("mfg.proof_hint")}</p>
        <input ref={fileInput} type="file" accept="image/*,application/pdf" className="sr-only" aria-label={t("mfg.proof_pick")} onChange={(e) => void pick(e.target.files?.[0])} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? t("mfg.proof_uploading") : proof ? t("mfg.proof_change") : t("mfg.proof_pick")}
          </Button>
          {proof ? <span className="min-w-0 truncate text-xs text-ok">✓ {proof.name}</span> : null}
          {!proof ? (
            <label className="flex items-center gap-1.5 text-xs text-fg-muted">
              <input type="checkbox" checked={noProof} onChange={(e) => setNoProof(e.target.checked)} />
              {t("mfg.proof_none")}
            </label>
          ) : null}
        </div>
        {noProof && !proof ? (
          <div className="space-y-1">
            <p className="text-xs text-warn">⚠️ {t("mfg.proof_warn")}</p>
            <Input value={proofNote} maxLength={LIMITS.reason} onChange={(e) => setProofNote(e.target.value)} placeholder={t("mfg.proof_reason_ph")} aria-label={t("mfg.proof_reason")} />
          </div>
        ) : null}
      </div>

      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || uploading || !ready}>
          {t("mfg.receive_save")}
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────────────────────── issue / adjust / count ─────────────────────────────────────────

type MoveKind = "issue" | "adjust" | "count";

/** The three small forms that move or count stock: «صرف», «تعديل يدوي» and «جرد». One component, three sentences. */
export function MoveForm({ kind, detail, onDone }: { kind: MoveKind; detail: MaterialDetail; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [unitId, setUnitId] = React.useState("");
  const [qty, setQty] = React.useState("");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const conversion = conversionOf(detail, unitId);
  const parsed = parseQtyMicro(qty, { signed: kind === "adjust" });
  const base = parsed !== null ? toBaseMicro(parsed < 0n ? -parsed : parsed, conversion) : null;
  const zeroOk = kind === "count";
  const numberOk = parsed !== null && base !== null && (zeroOk || parsed !== 0n);
  const textOk = kind === "count" || text.trim().length >= 2;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !numberOk || !textOk) return;
    setBusy(true);
    try {
      const path = `/api/manufacturing/materials/${detail.id}/${kind}`;
      await apiPost(path, kind === "count" ? { unitId: unitId || null, qty, note: text || null } : { unitId: unitId || null, qty, reason: text });
      toast(t(kind === "issue" ? "mfg.issued" : kind === "adjust" ? "mfg.adjusted" : "mfg.count_sent"), "success");
      setQty("");
      setText("");
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-surface-1 p-3 sm:grid-cols-2" aria-label={t(`mfg.${kind}`)}>
      <UnitSelect detail={detail} value={unitId} onChange={setUnitId} />
      <Field label={t(kind === "count" ? "mfg.f.counted_qty" : kind === "adjust" ? "mfg.f.adjust_qty" : "mfg.f.issue_qty")}>
        <Input value={qty} inputMode="decimal" dir="ltr" onChange={(e) => setQty(e.target.value)} aria-invalid={qty.trim() !== "" && !numberOk} />
      </Field>
      {kind === "adjust" ? <p className="text-xs text-fg-muted sm:col-span-2">{t("mfg.adjust_hint")}</p> : null}
      {kind === "count" ? <p className="text-xs text-fg-muted sm:col-span-2">{t("mfg.count_hint")}</p> : null}
      <Field label={t(kind === "count" ? "mfg.f.count_note" : "mfg.f.reason")} className="sm:col-span-2">
        <Input value={text} maxLength={kind === "count" ? LIMITS.note : LIMITS.reason} onChange={(e) => setText(e.target.value)} placeholder={t(kind === "issue" ? "mfg.f.issue_reason_ph" : kind === "adjust" ? "mfg.f.adjust_reason_ph" : "mfg.f.count_note_ph")} />
      </Field>
      {kind === "adjust" ? <p className="text-xs text-warn sm:col-span-2">⚠️ {t("mfg.adjust_warn")}</p> : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || !numberOk || !textOk}>
          {t(kind === "issue" ? "mfg.issue_save" : kind === "adjust" ? "mfg.adjust_save" : "mfg.count_save")}
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────────────────────── conversions ─────────────────────────────────────────

/** «1 كرتونة = 24 علبة»: the material's conversions, and the line that adds one. */
export function UnitsEditor({ detail, onDone }: { detail: MaterialDetail; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [label, setLabel] = React.useState("");
  const [numerator, setNumerator] = React.useState("");
  const [denominator, setDenominator] = React.useState("1");
  const [busy, setBusy] = React.useState(false);

  const n = Number(numerator);
  const d = Number(denominator);
  const ok = label.trim() !== "" && Number.isInteger(n) && n >= 1 && Number.isInteger(d) && d >= 1;

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !ok) return;
    setBusy(true);
    try {
      await apiPost(`/api/manufacturing/materials/${detail.id}/units`, { label, num: n, den: d });
      setLabel("");
      setNumerator("");
      setDenominator("1");
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function archive(unit: MfgUnit) {
    try {
      await apiDelete(`/api/manufacturing/materials/${detail.id}/units/${unit.id}`);
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    }
  }

  const active = detail.units.filter((u) => !u.archived);
  return (
    <div className="space-y-2">
      {active.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("mfg.units_none", { unit: detail.baseUnit })}</p>
      ) : (
        <ul className="grid gap-1">
          {active.map((u) => (
            <li key={u.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                1 {u.label} = <span dir="ltr">{u.den === 1 ? u.num : `${u.num}/${u.den}`}</span> {detail.baseUnit}
              </span>
              {detail.canEdit ? (
                <Button size="sm" variant="ghost" onClick={() => void archive(u)}>
                  {t("mfg.archive")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {detail.canEdit ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-1 p-3">
          <Field label={t("mfg.f.unit_label")} className="min-w-0 flex-1">
            <Input value={label} maxLength={LIMITS.unit} onChange={(e) => setLabel(e.target.value)} placeholder={t("mfg.f.unit_label_ph")} />
          </Field>
          <Field label={t("mfg.f.unit_num", { unit: detail.baseUnit })} className="w-28">
            <Input value={numerator} inputMode="numeric" dir="ltr" onChange={(e) => setNumerator(e.target.value)} />
          </Field>
          <Field label={t("mfg.f.unit_den")} className="w-24">
            <Input value={denominator} inputMode="numeric" dir="ltr" onChange={(e) => setDenominator(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy || !ok}>
            {t("mfg.unit_add")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

// ───────────────────────────────────────── editing the material ─────────────────────────────────────────

export function EditMaterial({ detail, onDone }: { detail: MaterialDetail; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [name, setName] = React.useState(detail.name);
  const [code, setCode] = React.useState(detail.code ?? "");
  const [low, setLow] = React.useState(detail.lowStockMicro === null ? "" : formatQty(detail.lowStockMicro).replace(/,/g, ""));
  const [busy, setBusy] = React.useState(false);

  async function save(patch: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await apiPatch(`/api/manufacturing/materials/${detail.id}`, patch);
      toast(t("mfg.saved"), "success");
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-surface-1 p-3 sm:grid-cols-2">
      <Field label={t("mfg.f.name")}>
        <Input value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("mfg.f.code")}>
        <Input value={code} maxLength={LIMITS.code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Field label={t("mfg.f.low_stock")}>
        <Input value={low} inputMode="decimal" dir="ltr" onChange={(e) => setLow(e.target.value)} placeholder={t("mfg.f.low_stock_ph")} />
      </Field>
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
        <Button disabled={busy || name.trim() === ""} onClick={() => void save({ name, code: code || null, lowStock: low || null })}>
          {t("common.save")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void save({ archived: !detail.archived })}>
          {detail.archived ? t("mfg.restore") : t("mfg.archive_material")}
        </Button>
      </div>
      <p className="text-xs text-fg-muted sm:col-span-2">{t("mfg.archive_hint")}</p>
    </div>
  );
}
