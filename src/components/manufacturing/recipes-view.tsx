"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { apiPatch, apiPost } from "@/lib/api-client";
import { fmtAgo } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { LIMITS, formatQty, parseQtyMicro, toBaseMicro } from "@/lib/manufacturing/shared";
import type { RecipeItem, RecipeMaterial, RecipeVersionItem, RecipesView } from "@/lib/manufacturing/production-view";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Field, MfgTabs, NotAccountingNote, Qty, SectionTitle, mfgErrorText } from "./ui";

/**
 * «وصفات» — the recipes of a manufacturing space. A recipe is a finished item (a name and an output unit written as free text) with lines: how much
 * of each material ONE output unit takes, typed in any unit of the material and kept exactly in its base unit. A recipe holds NO price.
 * A change is a NEW version (the old ones stay readable and are never edited); a recipe is archived, never deleted.
 */
export function RecipesPage({ initial }: { initial: RecipesView }) {
  const { t } = useI18n();
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  React.useEffect(() => setData(initial), [initial]);
  const [form, setForm] = React.useState<{ recipe: RecipeItem | null } | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);

  const live = data.recipes.filter((r) => !r.archived);
  const shown = showArchived ? data.recipes : live;
  const done = () => {
    setForm(null);
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <MfgTabs current="stock" sub="recipes" />
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{t("mfg.recipes_title")}</h1>
          <p className="text-xs text-fg-muted">{t("mfg.recipes_subtitle", { space: data.spaceName })}</p>
        </div>
        {data.canEdit ? (
          <Button size="sm" onClick={() => setForm(form && form.recipe === null ? null : { recipe: null })} aria-expanded={form !== null && form.recipe === null}>
            <Plus className="size-4" aria-hidden />
            {t("mfg.recipe_new")}
          </Button>
        ) : null}
      </header>

      <NotAccountingNote />
      {!data.canEdit ? <p className="text-xs text-fg-muted">{t("mfg.read_only")}</p> : null}

      {form && form.recipe === null && data.canEdit ? <RecipeForm view={data} recipe={null} onDone={done} onCancel={() => setForm(null)} /> : null}

      <section className="space-y-2">
        <SectionTitle
          aside={
            data.recipes.some((r) => r.archived) ? (
              <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                {t("mfg.show_archived")}
              </label>
            ) : null
          }
        >
          {t("mfg.sub.recipes")}
        </SectionTitle>
        {shown.length === 0 ? (
          <EmptyState title={t("mfg.recipe_none")} hint={data.canEdit ? t("mfg.recipe_none_hint") : t("mfg.empty_hint_view")} />
        ) : (
          <ul className="grid gap-2">
            {shown.map((r) => (
              <li key={r.id}>
                <RecipeCard
                  recipe={r}
                  canEdit={data.canEdit}
                  editing={form !== null && form.recipe?.id === r.id}
                  view={data}
                  onEdit={() => setForm(form?.recipe?.id === r.id ? null : { recipe: r })}
                  onDone={done}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RecipeCard({ recipe, canEdit, editing, view, onEdit, onDone }: { recipe: RecipeItem; canEdit: boolean; editing: boolean; view: RecipesView; onEdit: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const cur = recipe.current;

  async function stock() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/api/manufacturing/recipes/${recipe.id}/finished-stock`, {});
      toast(t("mfg.finished_done"), "success");
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPatch(`/api/manufacturing/recipes/${recipe.id}`, { archived: !recipe.archived });
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
        <span className="text-base font-medium text-fg">{cur.name}</span>
        <Badge>{t("mfg.recipe_version", { n: cur.version })}</Badge>
        {recipe.archived ? <Badge>{t("mfg.archived")}</Badge> : null}
        <span className="flex-1" />
        {canEdit ? (
          <>
            {!recipe.archived ? (
              <Button size="sm" variant="secondary" onClick={onEdit} aria-expanded={editing}>
                {t("mfg.recipe_new_version")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void archive()}>
              {recipe.archived ? t("mfg.restore") : t("mfg.archive")}
            </Button>
          </>
        ) : null}
      </div>
      <VersionLines version={cur} />
      {recipe.finished ? (
        <p className="mt-2 text-xs text-fg-muted">
          {t("mfg.finished_linked", { name: recipe.finished.name })}{" "}
          <Link href={`/manufacturing/materials/${recipe.finished.materialId}`} className="text-accent hover:underline">
            {t("mfg.finished_open")}
          </Link>
        </p>
      ) : recipe.canStock ? (
        <div className="mt-2 space-y-1">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void stock()}>
            {t("mfg.finished_on")}
          </Button>
          <p className="text-xs text-fg-muted">{t("mfg.finished_on_hint")}</p>
        </div>
      ) : null}
      {cur.note ? <p className="mt-1 text-xs text-fg-muted">{cur.note}</p> : null}
      <p className="mt-1 text-xs text-fg-muted">
        {t("mfg.by", { who: cur.createdBy })} · {fmtAgo(cur.createdAt)}
      </p>
      {recipe.versions.length > 1 ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-accent">{t("mfg.recipe_versions_old", { n: recipe.versions.length - 1 })}</summary>
          <ul className="mt-2 grid gap-2">
            {recipe.versions.slice(1).map((v) => (
              <li key={v.id} className="rounded-lg border border-border bg-surface p-2">
                <p className="font-medium text-fg">
                  {t("mfg.recipe_version", { n: v.version })} · {v.name}
                </p>
                <VersionLines version={v} />
                <p className="mt-1 text-fg-muted">
                  {t("mfg.by", { who: v.createdBy })} · {fmtAgo(v.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {editing && canEdit ? <RecipeForm view={view} recipe={recipe} onDone={onDone} onCancel={onEdit} /> : null}
    </div>
  );
}

function VersionLines({ version }: { version: RecipeVersionItem }) {
  const { t } = useI18n();
  return (
    <div className="mt-2">
      <p className="text-xs text-fg-muted">{t("mfg.recipe_per_unit", { unit: version.outputUnit })}</p>
      <ul className="mt-1 grid gap-1">
        {version.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 text-sm">
            <span className="font-medium text-fg">{l.materialName}</span>
            <Qty micro={l.enteredQtyMicro} unit={l.enteredUnitLabel} />
            {l.enteredUnitLabel !== l.baseUnit ? (
              <span className="text-xs text-fg-muted">
                (= <Qty micro={l.qtyMicro} unit={l.baseUnit} />)
              </span>
            ) : null}
            {l.materialArchived ? <Badge>{t("mfg.archived")}</Badge> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface LineDraft {
  key: number;
  materialId: string;
  unitId: string;
  qty: string;
}

/** The unit a saved line was typed in, found again among the material's units by its label (base unit when it was the base). */
function unitIdOf(material: RecipeMaterial | undefined, label: string): string {
  return material?.units.find((u) => !u.archived && u.label === label)?.id ?? "";
}

/**
 * One form for both «وصفة جديدة» and «نسخة جديدة»: the second starts from the lines of the current version. Saving a version never changes an
 * older one (⚠️ said before it is sent, with its 🔧).
 */
function RecipeForm({ view, recipe, onDone, onCancel }: { view: RecipesView; recipe: RecipeItem | null; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const base = recipe?.current ?? null;
  const counter = React.useRef(0);
  const nextKey = () => (counter.current += 1);
  const matById = React.useMemo(() => new Map(view.materials.map((m) => [m.id, m] as const)), [view.materials]);
  const [name, setName] = React.useState(base?.name ?? "");
  const [outputUnit, setOutputUnit] = React.useState(base?.outputUnit ?? "");
  const [note, setNote] = React.useState("");
  const [lines, setLines] = React.useState<LineDraft[]>(() =>
    base
      ? base.lines.map((l) => ({ key: nextKey(), materialId: l.materialId, unitId: unitIdOf(matById.get(l.materialId), l.enteredUnitLabel), qty: formatQty(l.enteredQtyMicro).replace(/,/g, "") }))
      : [{ key: nextKey(), materialId: "", unitId: "", qty: "" }],
  );
  const [busy, setBusy] = React.useState(false);

  const patch = (key: number, over: Partial<LineDraft>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...over } : l)));
  const lineOk = (l: LineDraft): boolean => {
    const material = matById.get(l.materialId);
    if (!material) return false;
    const unit = material.units.find((u) => u.id === l.unitId);
    const entered = parseQtyMicro(l.qty);
    return entered !== null && entered > 0n && toBaseMicro(entered, unit ? { num: unit.num, den: unit.den } : { num: 1, den: 1 }) !== null;
  };
  const ids = lines.map((l) => l.materialId).filter((id) => id !== "");
  const duplicate = new Set(ids).size !== ids.length;
  const ready = name.trim() !== "" && outputUnit.trim() !== "" && lines.length > 0 && lines.every(lineOk) && !duplicate;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    try {
      const body = { name, outputUnit, note: note || null, lines: lines.map((l) => ({ materialId: l.materialId, unitId: l.unitId || null, qty: l.qty })) };
      if (recipe) await apiPost(`/api/manufacturing/recipes/${recipe.id}/versions`, body);
      else await apiPost("/api/manufacturing/recipes", { spaceId: view.spaceId, ...body });
      toast(t(recipe ? "mfg.recipe_versioned" : "mfg.recipe_saved"), "success");
      onDone();
    } catch (err) {
      toast(mfgErrorText(t, err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2" aria-label={t(recipe ? "mfg.recipe_new_version" : "mfg.recipe_new")}>
      <Field label={t("mfg.f.recipe_name")}>
        <Input value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} placeholder={t("mfg.f.recipe_name_ph")} required />
      </Field>
      <Field label={t("mfg.f.output_unit")}>
        <Input value={outputUnit} maxLength={LIMITS.unit} onChange={(e) => setOutputUnit(e.target.value)} placeholder={t("mfg.f.output_unit_ph")} required />
      </Field>
      <div className="space-y-2 sm:col-span-2">
        <p className="text-xs font-medium text-fg">{t("mfg.recipe_per_unit", { unit: outputUnit.trim() || t("mfg.f.output_unit") })}</p>
        {view.materials.length === 0 ? <p className="text-xs text-warn">⚠️ {t("mfg.recipe_no_materials")}</p> : null}
        {lines.map((l) => {
          const material = matById.get(l.materialId);
          const unit = material?.units.find((u) => u.id === l.unitId);
          const entered = parseQtyMicro(l.qty);
          const baseQty = entered !== null && entered > 0n ? toBaseMicro(entered, unit ? { num: unit.num, den: unit.den } : { num: 1, den: 1 }) : null;
          return (
            <div key={l.key} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_9rem_8rem_auto] sm:items-end">
              <Field label={t("mfg.f.recipe_material")}>
                <Select value={l.materialId} onChange={(e) => patch(l.key, { materialId: e.target.value, unitId: "" })}>
                  <option value="" />
                  {view.materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("mfg.f.unit")}>
                <Select value={l.unitId} onChange={(e) => patch(l.key, { unitId: e.target.value })} disabled={!material}>
                  <option value="">{material?.baseUnit ?? ""}</option>
                  {(material?.units ?? [])
                    .filter((u) => !u.archived)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label={t("mfg.f.recipe_qty")}>
                <Input value={l.qty} inputMode="decimal" dir="ltr" onChange={(e) => patch(l.key, { qty: e.target.value })} aria-invalid={l.qty.trim() !== "" && !lineOk(l)} />
              </Field>
              <Button type="button" size="sm" variant="ghost" aria-label={t("mfg.recipe_remove_line")} disabled={lines.length === 1} onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
              {material && entered !== null && entered > 0n && unit ? (
                <p className="text-xs text-fg-muted sm:col-span-4">
                  {baseQty !== null ? (
                    <>
                      <span dir="ltr">{formatQty(entered)}</span> {unit.label} = <span dir="ltr">{formatQty(baseQty)}</span> {material.baseUnit}
                    </>
                  ) : (
                    <span className="text-danger">{t("mfg.e.qty_exact")}</span>
                  )}
                </p>
              ) : null}
            </div>
          );
        })}
        {duplicate ? <p className="text-xs text-danger">{t("mfg.e.recipe_dup")}</p> : null}
        <Button type="button" size="sm" variant="secondary" onClick={() => setLines((cur) => [...cur, { key: nextKey(), materialId: "", unitId: "", qty: "" }])}>
          <Plus className="size-4" aria-hidden />
          {t("mfg.recipe_add_line")}
        </Button>
      </div>
      <Field label={t("mfg.f.recipe_note")} className="sm:col-span-2">
        <Input value={note} maxLength={LIMITS.note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div role="note" className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-sm text-fg sm:col-span-2">
        <p className="font-medium">⚠️ {t("mfg.recipe_versions_warn")}</p>
        <p className="mt-1 text-fg-muted">🔧 {t("mfg.recipe_versions_fix")}</p>
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy || !ready}>
          {t("mfg.recipe_save")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
