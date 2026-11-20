"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { apiPost, apiPut } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { FIELD_TYPES, FORM_LIMITS, expenseSchema, nextFieldId, transferSchema, type FieldType, type FormField, type FormPurpose, type FormSchema } from "@/lib/approvals/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApproverPicker, type Candidate } from "./approver-picker";
import { errorPath, errorText } from "./errors";
import { ExpenseNote } from "./expense-note";

/** A field as the editor holds it: every box is text (options one per line, bounds as typed). */
export interface EditorField {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  optionsText: string;
  min: string;
  max: string;
}

export function editorOf(field: FormField): EditorField {
  return {
    id: field.id,
    type: field.type,
    label: field.label,
    required: field.required,
    optionsText: (field.options ?? []).join("\n"),
    min: field.min === undefined ? "" : String(field.min),
    max: field.max === undefined ? "" : String(field.max),
  };
}

/** The `schema` the routes take: only the properties the field's type has (the server refuses any other). */
export function schemaOf(fields: EditorField[], approvers: string[], purpose?: FormPurpose | null): unknown {
  return {
    ...(purpose ? { purpose } : {}),
    fields: fields.map((f) => {
      const out: Record<string, unknown> = { id: f.id, type: f.type, label: f.label, required: f.required };
      if (f.type === "choice") out["options"] = f.optionsText.split("\n").map((o) => o.trim()).filter(Boolean);
      if (f.type === "number") {
        // an unreadable bound is sent as typed so the server refuses it with its reason
        if (f.min.trim() !== "") out["min"] = Number.isFinite(Number(f.min)) ? Number(f.min) : f.min;
        if (f.max.trim() !== "") out["max"] = Number.isFinite(Number(f.max)) ? Number(f.max) : f.max;
      }
      return out;
    }),
    approvers,
  };
}

/** I1.3: «طلب مصروف» / «تحويل بين الصناديق» as the editor holds them: a name, a description, the fixed fields (the boxes one per line) and the purpose. */
export function presetEditor(kind: FormPurpose): { name: string; description: string; fields: EditorField[]; purpose: FormPurpose } {
  const boxes = [AR["expense.preset.box1"] ?? "", AR["expense.preset.box2"] ?? ""];
  const schema = kind === "expense" ? expenseSchema({ boxes, approvers: [] }) : transferSchema({ boxes, approvers: [] });
  return {
    name: AR[`expense.preset.${kind}.name`] ?? "",
    description: AR[`expense.preset.${kind}.description`] ?? "",
    fields: schema.fields.map(editorOf),
    purpose: kind,
  };
}

export const blankField = (fields: readonly { id: string }[]): EditorField => ({ id: nextFieldId(fields), type: "text", label: "", required: false, optionsText: "", min: "", max: "" });

/**
 * «نموذج»: its name, up to twenty fields (short text, long text, number, date, single choice, yes/no) and the preset chain of
 * approvers. Saving an EXISTING form writes its next version: requests already made keep the questions they were filled with.
 * A form is data only: no script, no formula, no file box.
 */
export function FormBuilder({
  workspaceId,
  people,
  initial,
}: {
  workspaceId: string;
  people: Candidate[];
  initial?: { familyId: string; version: number; name: string; description: string | null; schema: FormSchema };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [fields, setFields] = useState<EditorField[]>(initial ? initial.schema.fields.map(editorOf) : [blankField([])]);
  const [approvers, setApprovers] = useState<string[]>(initial?.schema.approvers ?? []);
  // a money form keeps its purpose across edits (the server refuses an edit that drops it)
  const [purpose, setPurpose] = useState<FormPurpose | null>(initial?.schema.purpose ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; index: number | null } | null>(null);

  const patch = (i: number, change: Partial<EditorField>) => setFields((list) => list.map((f, k) => (k === i ? { ...f, ...change } : f)));
  const move = (i: number, by: -1 | 1) =>
    setFields((list) => {
      const next = [...list];
      const j = i + by;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name, description: description.trim() || null, schema: schemaOf(fields, approvers, purpose) };
      if (initial) await apiPut(`/api/approval-forms/${initial.familyId}`, { ...body, baseVersion: initial.version });
      else await apiPost("/api/approval-forms", { ...body, workspaceId });
      router.push("/approvals/forms");
      router.refresh();
    } catch (err) {
      const path = errorPath(err) ?? "";
      const at = /^fields\.(\d+)/.exec(path);
      setError({ text: errorText(err, t), index: at ? Number(at[1]) : null });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4" data-form-builder>
      {!initial ? (
        <section className="space-y-1 text-xs" data-expense-presets>
          <h2 className="text-sm font-semibold text-fg">{t("expense.preset.title")}</h2>
          <p className="text-fg-muted">{t("expense.preset.hint")}</p>
          <ExpenseNote />
          <div className="flex flex-wrap gap-2">
            {(["expense", "transfer"] as const).map((kind) => (
              <Button
                key={kind}
                type="button"
                variant="secondary"
                size="sm"
                data-expense-preset={kind}
                onClick={() => {
                  const preset = presetEditor(kind);
                  setName(preset.name);
                  setDescription(preset.description);
                  setFields(preset.fields);
                  setPurpose(preset.purpose);
                  setError(null);
                }}
              >
                {t(`expense.preset.${kind}.name`)}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
      {purpose && initial ? <ExpenseNote /> : null}
      <label className="block space-y-1 text-xs" htmlFor="fb-name">
        <span className="font-medium text-fg">{t("approvals.builder.name")}</span>
        <Input id="fb-name" value={name} maxLength={FORM_LIMITS.name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="block space-y-1 text-xs" htmlFor="fb-desc">
        <span className="font-medium text-fg">{t("approvals.builder.description")}</span>
        <Input id="fb-desc" value={description} maxLength={FORM_LIMITS.description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-fg">{t("approvals.builder.fields")}</h2>
        <ol className="space-y-2">
          {fields.map((f, i) => (
            <li key={f.id} data-builder-field={f.id} className="space-y-2 rounded-xl border border-border bg-surface-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-semibold text-fg">{i + 1}</span>
                <Input aria-label={t("approvals.builder.label")} className="min-w-0 flex-1" value={f.label} maxLength={FORM_LIMITS.label} placeholder={t("approvals.builder.label")} onChange={(e) => patch(i, { label: e.target.value })} />
                <Select aria-label={t("approvals.builder.type")} className="w-auto" value={f.type} onChange={(e) => patch(i, { type: e.target.value as FieldType })}>
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`approvals.type.${type}`)}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="ghost" size="icon" aria-label={t("approvals.picker.up")} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label={t("approvals.picker.down")} disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label={t("approvals.builder.remove")} disabled={fields.length === 1} onClick={() => setFields((list) => list.filter((_, k) => k !== i))}>
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
              <label className="flex items-center gap-2 text-xs text-fg">
                <input type="checkbox" className="size-4 accent-accent" checked={f.required} onChange={(e) => patch(i, { required: e.target.checked })} />
                {t("approvals.builder.required")}
              </label>
              {f.type === "choice" ? (
                <label className="block space-y-1 text-xs">
                  <span className="font-medium text-fg">{t("approvals.builder.options")}</span>
                  <Textarea rows={4} value={f.optionsText} onChange={(e) => patch(i, { optionsText: e.target.value })} />
                  <span className="block text-fg-muted">{t("approvals.builder.options_hint")}</span>
                </label>
              ) : null}
              {f.type === "number" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block space-y-1 text-xs">
                    <span className="font-medium text-fg">{t("approvals.builder.min")}</span>
                    <Input inputMode="decimal" dir="ltr" value={f.min} onChange={(e) => patch(i, { min: e.target.value })} />
                  </label>
                  <label className="block space-y-1 text-xs">
                    <span className="font-medium text-fg">{t("approvals.builder.max")}</span>
                    <Input inputMode="decimal" dir="ltr" value={f.max} onChange={(e) => patch(i, { max: e.target.value })} />
                  </label>
                </div>
              ) : null}
              {error && error.index === i ? (
                <p className="text-xs text-danger" role="alert">
                  {error.text}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
        <Button type="button" variant="secondary" size="sm" disabled={fields.length >= FORM_LIMITS.fields} onClick={() => setFields((list) => [...list, blankField(list)])}>
          <Plus className="size-4" aria-hidden />
          {t("approvals.builder.add")}
        </Button>
      </section>

      <section className="space-y-1 text-xs">
        <h2 className="text-sm font-semibold text-fg">{t("approvals.builder.approvers")}</h2>
        <p className="text-fg-muted">{t("approvals.builder.approvers_hint")}</p>
        <ApproverPicker people={people} value={approvers} onChange={setApprovers} idPrefix="fb" />
      </section>

      {initial ? <p className="text-xs text-fg-muted">{t("approvals.builder.versions_hint", { n: initial.version + 1 })}</p> : null}
      {error && error.index === null ? (
        <p className="text-xs text-danger" role="alert">
          {error.text}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || name.trim() === "" || approvers.length === 0}>
        {busy ? t("common.saving") : initial ? t("approvals.builder.save_version") : t("approvals.builder.create")}
      </Button>
    </form>
  );
}
