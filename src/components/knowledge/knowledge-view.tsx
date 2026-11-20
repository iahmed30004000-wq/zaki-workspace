"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Plus, Settings } from "lucide-react";
import { apiPost, ApiError } from "@/lib/api-client";
import { foldForSearch } from "@/lib/search/arabic";
import { CATEGORY_TEMPLATE } from "@/lib/cards/product-templates";
import { fmtMoney } from "@/lib/cards/copy-text";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SheetList, SheetListItem } from "@/server/services/knowledge";
import { KnowledgeSettingsCard } from "./knowledge-settings-card";
import { stockWord } from "./sheet-view";

type Filter = "all" | "out" | "test" | "lacking";

/**
 * «المنتجات» (Q1.1): the grid of the sheets by category with search, the chips «نفد» and «تيست», and for the editors «ناقص معلومات» and the two
 * ways to start a sheet — a blank one, or «الصقي كرت قديم» (an old Telegram card split into the fields). A reader who is not an editor only ever
 * gets the approved sheets: the server decides, this only draws what it was sent.
 */
export function KnowledgeView({ initial }: { initial: SheetList }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState<"blank" | "paste" | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [name, setName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => [...new Set(initial.sheets.map((s) => s.category).filter((c): c is string => !!c))], [initial.sheets]);
  const needle = foldForSearch(q).trim();
  const shown = initial.sheets.filter((s: SheetListItem) => {
    if (category && s.category !== category) return false;
    if (needle && ![s.name, s.category ?? "", s.tagline].some((x) => foldForSearch(x).includes(needle))) return false;
    if (filter === "out") return stockWord(s.stockStatus) === "out";
    if (filter === "test") return s.badges.includes("test");
    if (filter === "lacking") return (s.gaps?.length ?? 0) > 0;
    return true;
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      const first = err instanceof ApiError && Array.isArray(err.details) ? (err.details[0] as { message?: unknown } | undefined) : undefined;
      toast(first && typeof first.message === "string" ? t(first.message) : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  };

  const createBlank = () =>
    run(async () => {
      const r = await apiPost<{ sheet: { id: string } }>("/api/knowledge", { title: name.trim(), category: newCategory.trim() || null });
      router.push(`/knowledge/${r.sheet.id}`);
    });

  const createFromPaste = () =>
    run(async () => {
      const parsed = await apiPost<{ name: string | null; data: unknown; overLimit: string[]; priceSeen: number }>("/api/knowledge/parse", { text: paste, category: newCategory.trim() || null });
      if (parsed.overLimit.length > 0) toast(`${t("knowledge.over_limit")}: ${parsed.overLimit.join("، ")}`, "error");
      if (parsed.priceSeen > 0) toast(t("knowledge.price_ignored"), "success");
      const title = (name.trim() || parsed.name || "").trim();
      if (!title) throw new Error("no name");
      // a part over its limit is not saved as it is: the sheet is made with what fits and the editor is opened to shorten the rest
      const made = await apiPost<{ sheet: { id: string } }>("/api/knowledge", { title, category: newCategory.trim() || null }).then(async (r) => {
        const cleaned = parsed.overLimit.length === 0 ? parsed.data : undefined;
        if (cleaned) {
          const { apiPatch } = await import("@/lib/api-client");
          await apiPatch(`/api/knowledge/${r.sheet.id}`, { version: 1, data: cleaned });
        }
        return r;
      });
      router.push(`/knowledge/${made.sheet.id}`);
    });

  if (!initial.configured) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <h1 className="text-xl font-bold">{t("knowledge.title")}</h1>
        <p className="text-sm text-muted">{t("knowledge.no_space")}</p>
        {initial.isOwner ? <KnowledgeSettingsCard /> : <p className="text-xs text-muted">{t("knowledge.ask_owner_space")}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="me-auto text-xl font-bold">{t("knowledge.title")}</h1>
        {initial.canEdit ? (
          <>
            <Button type="button" size="sm" onClick={() => setCreating(creating === "blank" ? null : "blank")}>
              <Plus className="me-1 size-4" />
              {t("knowledge.new")}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(creating === "paste" ? null : "paste")}>
              <ClipboardPaste className="me-1 size-4" />
              {t("knowledge.paste_old")}
            </Button>
          </>
        ) : null}
        {initial.isOwner ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
            <Settings className="me-1 size-4" />
            {t("knowledge.settings")}
          </Button>
        ) : null}
      </div>

      {showSettings && initial.isOwner ? <KnowledgeSettingsCard /> : null}

      {creating ? (
        <form
          className="space-y-3 rounded-[14px] bg-surface-1 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (creating === "blank" && name.trim()) void createBlank();
            if (creating === "paste" && paste.trim()) void createFromPaste();
          }}
        >
          <label className="block space-y-1 text-xs">
            <span className="text-muted">{t("knowledge.f.name")}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={140} />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted">{t("knowledge.f.category")}</span>
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} list="knowledge-new-categories" maxLength={40} />
            <datalist id="knowledge-new-categories">
              {Object.keys(CATEGORY_TEMPLATE).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          {creating === "paste" ? (
            <label className="block space-y-1 text-xs">
              <span className="text-muted">{t("knowledge.paste_label")}</span>
              <Textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} />
            </label>
          ) : null}
          <Button type="submit" size="sm" disabled={busy || (creating === "blank" ? !name.trim() : !paste.trim())}>
            {t("knowledge.create")}
          </Button>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs rounded-full border-transparent bg-surface-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("knowledge.search")} aria-label={t("knowledge.search")} />
        {(initial.canEdit ? (["all", "out", "test", "lacking"] as const) : (["all", "out", "test"] as const)).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} className={`rounded-full px-3 py-1 text-[13px] font-semibold transition-colors ${filter === f ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted hover:text-fg"}`}>
            {t(`knowledge.filter.${f}`)}
          </button>
        ))}
      </div>
      {categories.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setCategory(null)} aria-pressed={category === null} className={`rounded-full px-3 py-1 text-[13px] font-semibold transition-colors ${category === null ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted hover:text-fg"}`}>
            {t("knowledge.filter.all")}
          </button>
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c} className={`rounded-full px-3 py-1 text-[13px] font-semibold transition-colors ${category === c ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted hover:text-fg"}`}>
              {c}
            </button>
          ))}
        </div>
      ) : null}

      {shown.length === 0 ? <p className="rounded-[14px] bg-surface-1 px-4 py-7 text-center text-sm text-fg-muted">{t(initial.sheets.length === 0 ? "knowledge.empty" : "knowledge.no_match")}</p> : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(186px,1fr))]">
        {shown.map((s) => {
          const stock = stockWord(s.stockStatus);
          return (
            <li key={s.id}>
              <Link href={`/knowledge/${s.id}`} className="block h-full space-y-1.5 rounded-[14px] bg-surface-1 p-3 transition-shadow hover:shadow-card-hover">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[15.5px] font-bold">{s.name}</span>
                  {stock ? <span className={`rounded-full px-2 py-0.5 text-xs ${stock === "out" ? "bg-danger/15 text-danger" : "bg-ok/15 text-ok"}`}>{t(stock === "out" ? "knowledge.stock.out" : "knowledge.stock.in")}</span> : null}
                </div>
                {s.category ? <p className="text-xs text-muted">{s.category}</p> : null}
                {s.tagline ? <p className="text-sm">{s.tagline}</p> : null}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {s.price !== null ? <span className={s.stale ? "text-warn" : ""}>{`${fmtMoney(s.price)} ${s.currency ?? ""}${s.stale ? " ⚠️" : ""}`}</span> : <span className="text-warn">{t("knowledge.no_price_short")}</span>}
                  {s.badges.includes("test") ? <span className="rounded-full bg-warn/15 px-2 text-warn">{t("knowledge.badge.test")}</span> : null}
                  {s.missing ? <span className="rounded-full bg-danger/15 px-2 text-danger">{t("oms.missing")}</span> : null}
                  {initial.canEdit && s.status !== "APPROVED" ? <span className="rounded-full border border-border px-2 text-muted">{t(`cards.status.${s.status}`)}</span> : null}
                </div>
                {s.gaps && s.gaps.length > 0 ? <p className="text-xs text-warn">{`${t("knowledge.lacks")}: ${s.gaps.map((g) => t(`knowledge.gap.${g}`)).join(" · ")}`}</p> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
