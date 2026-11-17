"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { apiPatch, ApiError } from "@/lib/api-client";
import { KNOWLEDGE_LIMITS, cleanProductData, type FaqItem, type ProductData, type ProductSection } from "@/lib/cards/knowledge";
import { CATEGORY_TEMPLATE, SUGGESTED_CAUTION } from "@/lib/cards/product-templates";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SheetDTO } from "@/server/services/knowledge";

const blank = (s: SheetDTO): ProductData => {
  const have = new Map((s.data?.sections ?? []).map((x) => [x.key, x]));
  // every section of the template is there, with what the sheet already has in it; a section the sheet has and the template lacks is kept
  const fromTemplate: ProductSection[] = s.templateSections.map((spec) => have.get(spec.key) ?? { key: spec.key, title: spec.title, kind: spec.kind as ProductSection["kind"] });
  const extra = (s.data?.sections ?? []).filter((x) => !s.templateSections.some((spec) => spec.key === x.key));
  return { tagline: s.data?.tagline ?? "", badges: s.data?.badges ?? [], sections: [...fromTemplate, ...extra], faq: s.data?.faq ?? [], ...(s.data?.caution ? { caution: s.data.caution } : {}), ...(s.data?.testNote ? { testNote: s.data.testNote } : {}), ...(s.data?.offerMessageTemplate ? { offerMessageTemplate: s.data.offerMessageTemplate } : {}) };
};

/** One line per item in the box, empty lines dropped. */
const lines = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter(Boolean);

/**
 * The editor of a sheet (Q1.1): only the sections of the category's template, a counter beside every limit («بدون عجقة»: the server refuses what is
 * longer), and a caution that is added by hand — the suggestion is a button, never filled in by itself. The price is not here: it is read from the
 * orders system.
 */
export function SheetEditor({ sheet, onDone }: { sheet: SheetDTO; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [name, setName] = useState(sheet.name);
  const [category, setCategory] = useState(sheet.category ?? "");
  const [data, setData] = useState<ProductData>(() => blank(sheet));

  const patchSection = (key: string, change: Partial<ProductSection>) => setData((d) => ({ ...d, sections: d.sections.map((s) => (s.key === key ? { ...s, ...change } : s)) }));
  const patchFaq = (i: number, change: Partial<FaqItem>) => setData((d) => ({ ...d, faq: d.faq.map((f, j) => (j === i ? { ...f, ...change } : f)) }));

  const verdict = cleanProductData(data);
  const save = useMutation({
    mutationFn: () => apiPatch(`/api/knowledge/${sheet.id}`, { version: sheet.version, title: name.trim(), category: category.trim() || null, data: verdict.ok ? verdict.value : data }),
    onSuccess: () => {
      toast(t("knowledge.saved"), "success");
      onDone();
    },
    onError: (err) => {
      const first = err instanceof ApiError && Array.isArray(err.details) ? (err.details[0] as { message?: unknown } | undefined) : undefined;
      toast(first && typeof first.message === "string" ? t(first.message) : t("common.error"), "error");
    },
  });

  const counter = (value: string, max: number) => (
    <span className={`text-xs ${value.length > max ? "text-danger" : "text-muted"}`}>{`${value.length}/${max}`}</span>
  );

  return (
    <form
      className="mx-auto max-w-3xl space-y-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (verdict.ok && name.trim() && !save.isPending) save.mutate();
      }}
    >
      <h1 className="text-lg font-bold">{t("knowledge.editing")}</h1>
      <label className="block space-y-1 text-xs">
        <span className="text-muted">{t("knowledge.f.name")}</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={140} />
      </label>
      <label className="block space-y-1 text-xs">
        <span className="text-muted">{t("knowledge.f.category")}</span>
        <Input value={category} onChange={(e) => setCategory(e.target.value)} list="knowledge-categories" maxLength={40} />
        <datalist id="knowledge-categories">
          {Object.keys(CATEGORY_TEMPLATE).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <span className="block text-muted">{t("knowledge.f.category_hint")}</span>
      </label>
      <label className="block space-y-1 text-xs">
        <span className="flex justify-between text-muted">
          {t("knowledge.f.tagline")}
          {counter(data.tagline, KNOWLEDGE_LIMITS.tagline)}
        </span>
        <Input value={data.tagline} onChange={(e) => setData({ ...data, tagline: e.target.value })} />
      </label>
      <div className="flex gap-4 text-xs">
        {(["test", "new"] as const).map((b) => (
          <label key={b} className="flex items-center gap-1">
            <input type="checkbox" checked={data.badges.includes(b)} onChange={() => setData({ ...data, badges: data.badges.includes(b) ? data.badges.filter((x) => x !== b) : [...data.badges, b] })} />
            {t(`knowledge.badge.${b}`)}
          </label>
        ))}
      </div>

      {data.sections.map((s) => (
        <label key={s.key} className="block space-y-1 text-xs">
          <span className="flex justify-between text-muted">
            {s.title}
            <span>{t(`knowledge.kind.${s.kind}`)}</span>
          </span>
          {s.kind === "text" ? (
            <>
              <Textarea rows={3} value={s.text ?? ""} onChange={(e) => patchSection(s.key, { text: e.target.value })} />
              {counter(s.text ?? "", KNOWLEDGE_LIMITS.text)}
            </>
          ) : (
            <Textarea rows={4} value={(s.items ?? []).join("\n")} onChange={(e) => patchSection(s.key, { items: lines(e.target.value) })} placeholder={t("knowledge.f.one_per_line")} />
          )}
        </label>
      ))}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("knowledge.faq")}</h2>
        {data.faq.map((f, i) => (
          <div key={i} className="space-y-1 rounded-lg border border-border p-2 text-xs">
            <Input value={f.q} onChange={(e) => patchFaq(i, { q: e.target.value })} placeholder={t("knowledge.f.question")} maxLength={140} />
            <Textarea rows={2} value={f.a} onChange={(e) => patchFaq(i, { a: e.target.value })} placeholder={t("knowledge.f.answer")} />
            <div className="flex items-center justify-between">
              {counter(f.a, KNOWLEDGE_LIMITS.answer)}
              <Button type="button" size="sm" variant="secondary" onClick={() => setData({ ...data, faq: data.faq.filter((_, j) => j !== i) })} aria-label={t("knowledge.remove")}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        {data.faq.length < KNOWLEDGE_LIMITS.faq ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setData({ ...data, faq: [...data.faq, { q: "", a: "" }] })}>
            <Plus className="me-1 size-4" />
            {t("knowledge.f.add_question")}
          </Button>
        ) : null}
      </section>

      <section className="space-y-2 text-xs">
        {data.caution ? (
          <label className="block space-y-1">
            <span className="flex justify-between text-muted">
              {t("knowledge.caution_title")}
              {counter(data.caution.text, KNOWLEDGE_LIMITS.caution)}
            </span>
            <Textarea rows={2} value={data.caution.text} onChange={(e) => setData({ ...data, caution: { text: e.target.value } })} />
            <span className="block text-muted">{t("knowledge.caution_note")}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => { const { caution: _c, ...rest } = data; setData(rest); }}>
              {t("knowledge.caution_remove")}
            </Button>
          </label>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setData({ ...data, caution: { text: "" } })}>
              {t("knowledge.caution_add")}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setData({ ...data, caution: { text: SUGGESTED_CAUTION } })}>
              {t("knowledge.caution_suggest")}
            </Button>
          </div>
        )}
      </section>

      <label className="block space-y-1 text-xs">
        <span className="flex justify-between text-muted">
          {t("knowledge.f.test_note")}
          {counter(data.testNote ?? "", KNOWLEDGE_LIMITS.testNote)}
        </span>
        <Input value={data.testNote ?? ""} onChange={(e) => setData({ ...data, testNote: e.target.value })} />
      </label>
      <label className="block space-y-1 text-xs">
        <span className="flex justify-between text-muted">
          {t("knowledge.f.offer_template")}
          {counter(data.offerMessageTemplate ?? "", KNOWLEDGE_LIMITS.offerTemplate)}
        </span>
        <Textarea rows={4} value={data.offerMessageTemplate ?? ""} onChange={(e) => setData({ ...data, offerMessageTemplate: e.target.value })} placeholder="{الاسم}  {الوصف}  {سعر_الواحدة}  {العروض}  {التوصيل}" />
      </label>

      {!verdict.ok ? <p className="text-xs text-danger" role="alert">{t(verdict.error)}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!verdict.ok || !name.trim() || save.isPending}>
          {t("knowledge.save")}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t("knowledge.cancel")}
        </Button>
      </div>
    </form>
  );
}
