"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, Copy, ExternalLink, Pencil } from "lucide-react";
import { apiPost, apiPut, ApiError } from "@/lib/api-client";
import { copyText } from "@/lib/cards/clipboard";
import { COPY_PARTS, answerText, buildCopyAll, buildOfferMessage, offerLine, searchFaq, sectionText, fmtMoney, type CopyPart } from "@/lib/cards/copy-text";
import { staleNote, type ProductSnapshot } from "@/lib/oms/snapshot";
import { useI18n } from "@/lib/i18n";
import { fmtNumber } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SheetDTO } from "@/server/services/knowledge";
import { SheetEditor } from "./sheet-editor";

/** The word of the stock state, from what the orders system said. */
export function stockWord(state: string | null | undefined): "in" | "out" | null {
  if (!state) return null;
  if (/out|sold|none|نفد/i.test(state)) return "out";
  if (/in_stock|available|متوفر/i.test(state)) return "in";
  return null;
}

const STATUS_KEY: Record<string, string> = { DRAFT: "cards.status.DRAFT", REVIEW: "cards.status.REVIEW", APPROVED: "cards.status.APPROVED", ARCHIVED: "cards.status.ARCHIVED" };

function snapshotOf(sheet: SheetDTO): ProductSnapshot | null {
  const e = sheet.external;
  if (!e) return null;
  return { code: "", name: sheet.name, price: e.price, currency: e.currency, offers: e.offers, stockStatus: e.stockStatus, ...(e.deliveryIncluded !== undefined ? { deliveryIncluded: e.deliveryIncluded } : {}), ...(e.link ? { link: e.link } : {}), fetchedAt: e.fetchedAt };
}

/**
 * «كرت المنتج» (Q1.1): ONE screen per product. The top is read from the orders system (price chips, stock word — never typed), the rest is the
 * team's knowledge in the sections of the category's template; every part has a copy button, nothing is a wall of text. A stale or missing price is
 * never copied: the offer button is replaced by its warning. The caution is shown only to an editor (the server never sends it to anybody else).
 */
export function SheetView({ initial, userId, isOwner }: { initial: SheetDTO; userId: string; isOwner: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const sheet = initial;
  const [editing, setEditing] = useState(false);
  const [faqQuery, setFaqQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ faq: true });
  const [parts, setParts] = useState<CopyPart[]>(["description", "sections", "price"]);
  const [allOpen, setAllOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [now, setNow] = useState(() => new Date());
  const storeKey = `knowledge.copyAll.${userId}`;

  useEffect(() => {
    // the choice of «انسخي الكل» is remembered per person
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) ?? "null") as unknown;
      if (Array.isArray(saved)) setParts(saved.filter((p): p is CopyPart => (COPY_PARTS as readonly string[]).includes(p as string)));
    } catch {
      /* a broken saved choice is ignored */
    }
  }, [storeKey]);
  useEffect(() => {
    // the age of the price is re-read every minute: a sheet left open turns stale on its own
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const snap = snapshotOf(sheet);
  const data = sheet.data;
  const unit = sheet.unit;
  const offer = useMemo(
    () => buildOfferMessage({ name: sheet.name, tagline: data?.tagline ?? "", unit, snapshot: snap, deliveryLine: sheet.deliveryLine, template: data?.offerMessageTemplate ?? null, now }),
    [sheet, data, unit, snap, now],
  );
  const faq = data ? searchFaq(data.faq, faqQuery) : [];

  const copy = async (text: string, what: string) => {
    if (!text) return;
    const ok = await copyText(text);
    toast(t(ok ? "knowledge.copied" : "knowledge.copy_failed"), ok ? "success" : "error");
    if (ok) void apiPost(`/api/knowledge/${sheet.id}/copy`, { what }).catch(() => undefined);
  };

  const syncNow = async () => {
    try {
      const r = await apiPost<{ ok: boolean }>("/api/integrations/oms/sync");
      toast(t(r.ok ? "oms.card.synced" : "knowledge.sync_failed"), r.ok ? "success" : "error");
      router.refresh();
    } catch {
      toast(t("knowledge.sync_failed"), "error");
    }
  };

  const setStatus = async (status: string) => {
    try {
      await apiPut(`/api/knowledge/${sheet.id}/status`, { status });
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError && err.messageKey ? t(err.messageKey) : t("common.error"), "error");
    }
  };

  const askSupervisor = async () => {
    try {
      await apiPost(`/api/knowledge/${sheet.id}/ask`, { question: ask });
      setAsk("");
      toast(t("knowledge.asked"), "success");
    } catch {
      toast(t("common.error"), "error");
    }
  };

  const toggleAll = (p: CopyPart) => {
    const next = parts.includes(p) ? parts.filter((x) => x !== p) : [...parts, p];
    setParts(next);
    try {
      localStorage.setItem(storeKey, JSON.stringify(next));
    } catch {
      /* the choice just is not remembered */
    }
  };

  if (editing && sheet.canEdit) return <SheetEditor sheet={sheet} onDone={() => { setEditing(false); router.refresh(); }} />;

  const stock = stockWord(sheet.external?.stockStatus);
  const stale = sheet.external ? sheet.external.stale : true;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <Link href="/knowledge" className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
        <ChevronLeft className="size-3 rotate-180" />
        {t("knowledge.back")}
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">{sheet.name}</h1>
          {sheet.category ? <span className="rounded-full border border-border px-2 py-0.5 text-xs">{sheet.category}</span> : null}
          {stock ? <span className={`rounded-full px-2 py-0.5 text-xs ${stock === "out" ? "bg-danger/15 text-danger" : "bg-ok/15 text-ok"}`}>{t(stock === "out" ? "knowledge.stock.out" : "knowledge.stock.in")}</span> : null}
          {data?.badges.includes("test") ? <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs text-warn">{t("knowledge.badge.test")}</span> : null}
          {data?.badges.includes("new") ? <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">{t("knowledge.badge.new")}</span> : null}
          {sheet.canEdit ? <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{t(STATUS_KEY[sheet.status] ?? "cards.status.DRAFT")}</span> : null}
          {sheet.external?.missingSince ? <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs text-danger">{t("oms.missing")}</span> : null}
        </div>
        {data?.tagline ? <p className="text-sm text-muted">{data.tagline}</p> : null}
        {data?.testNote ? <p className="text-xs text-warn">{data.testNote}</p> : null}
      </header>

      <section aria-label={t("knowledge.price")} className="space-y-2">
        {snap ? (
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-lg border border-border bg-surface-1 px-3 py-1.5">{`${t(unit === "عبوة" ? "knowledge.unit.pack" : "knowledge.unit.piece")} ${fmtMoney(snap.price)} ${snap.currency}`}</span>
            {snap.offers.map((o, i) => (
              <span key={i} className="rounded-lg border border-border bg-surface-1 px-3 py-1.5">{offerLine(o, snap.currency, unit)}</span>
            ))}
            {sheet.external?.deliveryIncluded && sheet.deliveryLine ? <span className="rounded-lg border border-border bg-surface-1 px-3 py-1.5">{sheet.deliveryLine}</span> : null}
            <span className={`rounded-lg px-3 py-1.5 text-xs ${stale ? "bg-warn/15 text-warn" : "text-muted"}`}>{staleNote(snap, now)}</span>
          </div>
        ) : (
          <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6">
            <p className="text-warn">{`⚠️ ${t("knowledge.no_price")}`}</p>
            <p>{`🔧 ${t("knowledge.no_price_fix")}`}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {offer.ok ? (
            <Button type="button" size="sm" onClick={() => void copy(offer.text, "offer")}>
              <Copy className="me-1 size-4" />
              {t("knowledge.copy_offer")}
            </Button>
          ) : (
            <div className="space-y-1 rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">
              <p className="text-warn">{`⚠️ ${t(offer.reason === "stale" ? "oms.stale.refuse" : "knowledge.no_price")}`}</p>
              {offer.reason === "stale" ? (
                isOwner ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => void syncNow()}>
                    {t("oms.stale.refresh")}
                  </Button>
                ) : (
                  <p>{`🔧 ${t("knowledge.ask_owner_refresh")}`}</p>
                )
              ) : (
                <p>{`🔧 ${t("knowledge.no_price_fix")}`}</p>
              )}
            </div>
          )}
          <div className="relative">
            <Button type="button" size="sm" variant="secondary" onClick={() => setAllOpen((v) => !v)} aria-expanded={allOpen}>
              {t("knowledge.copy_all")}
              <ChevronDown className="ms-1 size-4" />
            </Button>
            {allOpen && data ? (
              <div className="absolute start-0 z-10 mt-1 w-56 space-y-2 rounded-lg border border-border bg-surface-1 p-3 text-xs shadow-lg">
                {COPY_PARTS.map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <input type="checkbox" checked={parts.includes(p)} onChange={() => toggleAll(p)} />
                    {t(`knowledge.part.${p}`)}
                  </label>
                ))}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    const r = buildCopyAll({ name: sheet.name, tagline: data.tagline, unit, snapshot: snap, deliveryLine: sheet.deliveryLine, template: null, now, data, parts });
                    if (r.priceSkipped) toast(t(r.priceSkipped === "stale" ? "oms.stale.refuse" : "knowledge.no_price"), "error");
                    void copy(r.text, "all");
                    setAllOpen(false);
                  }}
                >
                  {t("knowledge.copy")}
                </Button>
              </div>
            ) : null}
          </div>
          {snap?.link ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => void copy(snap.link ?? "", "link")}>
              <ExternalLink className="me-1 size-4" />
              {t("knowledge.copy_link")}
            </Button>
          ) : null}
          {sheet.canEdit ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="me-1 size-4" />
              {t("knowledge.edit")}
            </Button>
          ) : null}
        </div>
      </section>

      {sheet.canEdit && data?.caution ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6" role="note">
          <p className="font-semibold text-warn">{t("knowledge.caution_title")}</p>
          <p>{data.caution.text}</p>
          <p className="text-muted">{t("knowledge.caution_note")}</p>
        </div>
      ) : null}

      {sheet.canEdit && sheet.gaps && sheet.gaps.length > 0 ? <p className="text-xs text-warn">{`${t("knowledge.lacks")}: ${sheet.gaps.map((g) => t(`knowledge.gap.${g}`)).join(" · ")}`}</p> : null}
      {sheet.canEdit && typeof sheet.copies === "number" ? <p className="text-xs text-muted">{t("knowledge.copies", { n: fmtNumber(sheet.copies) })}</p> : null}

      <section className="rounded-xl border border-border bg-surface-1">
        <button type="button" className="flex w-full items-center justify-between p-3 text-sm font-semibold" onClick={() => setOpen((o) => ({ ...o, faq: !o["faq"] }))} aria-expanded={!!open["faq"]}>
          {t("knowledge.faq")}
          <ChevronDown className={`size-4 transition-transform ${open["faq"] ? "rotate-180" : ""}`} />
        </button>
        {open["faq"] ? (
          <div className="space-y-2 border-t border-border p-3">
            <Input value={faqQuery} onChange={(e) => setFaqQuery(e.target.value)} placeholder={t("knowledge.faq_search")} aria-label={t("knowledge.faq_search")} />
            {faq.map((f, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-sm">
                <p className="font-medium">{f.q}</p>
                <div className="mt-1 flex items-start justify-between gap-2">
                  <p className="text-muted">{f.a}</p>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void copy(answerText(f), "answer")}>
                    <Copy className="size-4" aria-label={t("knowledge.copy")} />
                  </Button>
                </div>
              </div>
            ))}
            {faq.length === 0 ? (
              <div className="space-y-2 text-sm">
                <p className="text-muted">{faqQuery.trim() ? t("knowledge.faq_none") : t("knowledge.faq_empty")}</p>
                {faqQuery.trim() || data ? (
                  <div className="flex gap-2">
                    <Input value={ask || faqQuery} onChange={(e) => setAsk(e.target.value)} placeholder={t("knowledge.ask_placeholder")} />
                    <Button type="button" size="sm" disabled={(ask || faqQuery).trim().length < 3} onClick={() => { if (!ask) setAsk(faqQuery); void askSupervisor(); }}>
                      {t("knowledge.ask")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {data?.sections.map((s) => {
        const text = sectionText(s);
        if (!text && !sheet.canEdit) return null;
        const isOpen = !!open[s.key];
        return (
          <section key={s.key} className="rounded-xl border border-border bg-surface-1">
            <div className="flex items-center justify-between p-3">
              <button type="button" className="flex flex-1 items-center gap-2 text-sm font-semibold" onClick={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))} aria-expanded={isOpen}>
                <ChevronDown className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                {s.title}
              </button>
              {text ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void copy(text, `section:${s.key}`)}>
                  <Copy className="size-4" aria-label={t("knowledge.copy")} />
                </Button>
              ) : null}
            </div>
            {isOpen ? (
              <div className="border-t border-border p-3 text-sm">
                {s.kind === "text" ? <p>{s.text ?? t("knowledge.empty_section")}</p> : null}
                {s.kind === "chips" ? (
                  <div className="flex flex-wrap gap-2">
                    {(s.items ?? []).map((it, i) => (
                      <span key={i} className="rounded-full border border-border px-2 py-0.5 text-xs">{it}</span>
                    ))}
                    {(s.items ?? []).length === 0 ? <p className="text-muted">{t("knowledge.empty_section")}</p> : null}
                  </div>
                ) : null}
                {s.kind === "steps" ? (
                  <ol className="list-decimal space-y-1 ps-5">
                    {(s.items ?? []).map((it, i) => (
                      <li key={i}>{it}</li>
                    ))}
                    {(s.items ?? []).length === 0 ? <p className="list-none text-muted">{t("knowledge.empty_section")}</p> : null}
                  </ol>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}

      {sheet.canEdit ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3 text-xs">
          {sheet.status === "DRAFT" || sheet.status === "APPROVED" ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => void setStatus("REVIEW")}>
              {t("knowledge.to_review")}
            </Button>
          ) : null}
          {sheet.canApprove && sheet.status !== "APPROVED" ? (
            <Button type="button" size="sm" onClick={() => void setStatus("APPROVED")}>
              {t("knowledge.approve")}
            </Button>
          ) : null}
          {sheet.status === "REVIEW" ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => void setStatus("DRAFT")}>
              {t("knowledge.to_draft")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
