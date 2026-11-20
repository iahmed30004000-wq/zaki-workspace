"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPatch, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useOptionalToast } from "@/components/ui/toast";
import { COMPANY_CHAT_GROUP, ECONOMY_FORCED_OFF, ECONOMY_POLL_FACTOR, type FeatureKey } from "@/lib/features";
import { FEATURE_GROUP_ORDER, groupKeys, matchesSearch, missingParents, type FeaturePreset } from "@/lib/feature-groups";
import { showModelWarning } from "@/lib/chat/customer-data-hint";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PresetsBar } from "@/components/feature-switches/presets-bar";

/** C4.3's chat switches: the ⚠️/🔧 flag and the note of each, by key (the group is data in src/lib/features.ts). */
const CHAT_EXTRAS = new Map<FeatureKey, { risk?: boolean; note?: boolean }>(COMPANY_CHAT_GROUP.map((g) => [g.key, { risk: g.risk, note: g.note }]));

/**
 * «الميزات»: the owner switches each feature on or off. Off, the feature is gone from every screen and its doors
 * answer «not found»; what it stored is kept, and switching it on brings it all back.
 *
 * A1.4: two presets at the top (each asks first, listing what changes), a search box, and the switches in six groups. A switch that needs another
 * (`FEATURE_META[key].dependsOn`) says «بيحتاج: …» while that one is off and cannot be switched ON; one that is already ON stays free to be switched off.
 * `initialQuery` is for the markup tests.
 */
export function FeatureSwitches({ initial, notReady = [], initialQuery = "" }: { initial: { key: FeatureKey; on: boolean }[]; notReady?: FeatureKey[]; initialQuery?: string }) {
  const { t } = useI18n();
  const toast = useOptionalToast();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<FeatureKey | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  const [query, setQuery] = useState(initialQuery);

  async function flip(key: FeatureKey, on: boolean) {
    setBusy(key);
    setItems((all) => all.map((f) => (f.key === key ? { ...f, on } : f)));
    try {
      await apiPatch("/api/settings/features", { key, on });
      toast?.toast(t(on ? "features.turned_on" : "features.turned_off", { name: t(`features.${key}.name`) }), "success");
      // the menu and «جديد» are drawn on the server: draw them again
      router.refresh();
    } catch {
      setItems((all) => all.map((f) => (f.key === key ? { ...f, on: !on } : f)));
      toast?.toast(t("common.error"), "error");
    } finally {
      setBusy(null);
    }
  }

  /** A preset: the server decides the keys (the body names the preset only) and answers what it changed. */
  async function applyPreset(preset: FeaturePreset): Promise<boolean> {
    setPresetBusy(true);
    try {
      const res = await apiPost<{ preset: FeaturePreset; changed: { key: FeatureKey; on: boolean }[] }>("/api/settings/features", { preset });
      const changed = new Map(res.changed.map((c) => [c.key, c.on]));
      setItems((all) => all.map((f) => (changed.has(f.key) ? { ...f, on: changed.get(f.key) as boolean } : f)));
      toast?.toast(t("featureGroups.applied", { name: t(`featureGroups.presets.${preset}.name`) }), "success");
      router.refresh();
      return true;
    } catch {
      toast?.toast(t("common.error"), "error");
      return false;
    } finally {
      setPresetBusy(false);
    }
  }

  // «وضع التوفير» is an overlay: what the owner left on stays on in the list, and is only MARKED while the master switch holds it off
  const economy = items.find((f) => f.key === "economyMode")?.on ?? false;
  const held = new Set<FeatureKey>(economy ? ECONOMY_FORCED_OFF.filter((key) => items.find((f) => f.key === key)?.on) : []);
  // the owner's own choices, for «بيحتاج»: a key the list was not given is at its default
  const choices = Object.fromEntries(items.map((f) => [f.key, f.on])) as Record<FeatureKey, boolean>;

  function toggle(item: { key: FeatureKey; on: boolean }, disabled = false) {
    return <Switch checked={item.on} onChange={(on) => flip(item.key, on)} label={t(`features.${item.key}.name`)} disabled={busy === item.key || presetBusy || disabled} />;
  }

  /** One switch: its name, its hint, «بيحتاج», the group's note and ⚠️/🔧 where it has them, and the toggle. */
  function row(f: { key: FeatureKey; on: boolean }, extra?: { risk?: boolean; note?: boolean }) {
    const needs = missingParents(f.key, choices);
    return (
      <li key={f.key} className="flex min-h-14 items-center justify-between gap-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">
            {t(`features.${f.key}.name`)}
            {notReady.includes(f.key) ? <span className="ms-2 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">{t("semantic.not_ready")}</span> : null}
            {held.has(f.key) ? <span className="ms-2 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">{t("economy.held")}</span> : null}
          </p>
          <p className="text-xs text-muted">{t(`features.${f.key}.hint`)}</p>
          {needs.length > 0 ? (
            <p data-needs={f.key} className="text-xs text-warn">
              {t("featureGroups.needs", { names: needs.map((k) => t(`features.${k}.name`)).join("، ") })}
            </p>
          ) : null}
          {extra?.note ? <p className="text-xs text-muted">{t(`companyChat.note.${f.key}`)}</p> : null}
          {!extra?.risk && showModelWarning(items, f.key) ?<p data-model-warning className="text-xs leading-6 text-warn">{t("features.model_warn")}</p> : null}
          {notReady.includes(f.key) ? <p className="text-xs text-warn">{t("semantic.not_ready_hint")}</p> : null}
          {extra?.risk ? (
            <div className="space-y-0.5" data-risk={f.key}>
              <p className="text-xs leading-6 text-warn">{t(`companyChat.warn.${f.key}`)}</p>
              <p className="text-xs leading-6 text-fg">{t(`companyChat.fix.${f.key}`)}</p>
            </div>
          ) : null}
        </div>
        <div className={cn(held.has(f.key) && "opacity-50")}>
          {/* a switch that is OFF cannot be switched on while a parent is off; one that is already ON can always be switched off */}
          {toggle(f, needs.length > 0 && !f.on)}
        </div>
      </li>
    );
  }

  // the groups: the chat group first (C4.3), then the other five in the spec's order. A key the list was not given is skipped; a search keeps what matches.
  const sections = FEATURE_GROUP_ORDER.flatMap((group) => {
    const groupTitle = t(`featureGroups.group.${group}`);
    const rows = groupKeys(group).flatMap((key) => {
      const item = items.find((f) => f.key === key);
      if (!item) return [];
      if (!matchesSearch([t(`features.${key}.name`), t(`features.${key}.hint`), groupTitle], query)) return [];
      return [{ item, extra: group === "chat" ? CHAT_EXTRAS.get(key) : undefined }];
    });
    return rows.length > 0 ? [{ group, groupTitle, rows }] : [];
  });

  return (
    <div className="space-y-3">
      <PresetsBar items={items} onApply={applyPreset} busy={presetBusy || busy !== null} />
      <Input type="search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder={t("featureGroups.search.placeholder")} aria-label={t("featureGroups.search.label")} />
      {/* «وضع التوفير»: the one switch for a server that is not strong enough; what it holds off is printed, with the way back */}
      <section
        className={cn("space-y-3 rounded-[14px] p-4", economy ? "bg-warn/10" : "bg-surface-1")}
        aria-labelledby="economy-title"
        data-economy-panel
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p id="economy-title" className="text-sm font-semibold text-fg">
              {t("economy.title")}
              {economy ? <span className="ms-2 rounded-full bg-warn/20 px-2 py-0.5 text-xs font-medium text-warn">{t("economy.active")}</span> : null}
            </p>
            <p className="text-xs text-muted">{t("economy.subtitle")}</p>
          </div>
          {toggle({ key: "economyMode", on: economy })}
        </div>
        <div>
          <p className="text-xs font-medium text-fg">{t("economy.list_title")}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5" data-economy-list>
            {ECONOMY_FORCED_OFF.map((key) => (
              <li key={key} className="rounded-full border border-border bg-surface-1 px-2.5 py-0.5 text-xs text-fg">
                {t(`features.${key}.name`)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">{t("economy.slower", { n: ECONOMY_POLL_FACTOR })}</p>
        </div>
        <div className="space-y-0.5 text-xs">
          <p className="text-warn">{t("economy.warn")}</p>
          <p className="text-fg">{t("economy.fix")}</p>
        </div>
      </section>
      {sections.map(({ group, groupTitle, rows }) => (
        <section key={group} className="space-y-1.5" aria-labelledby={`feature-group-${group}`} data-feature-group={group} {...(group === "chat" ? { "data-company-chat-group": true } : {})}>
          <h3 id={`feature-group-${group}`} className="px-1 pt-2 text-[13px] font-bold text-accent">
            {groupTitle}
          </h3>
          {group === "chat" ? <p className="px-1 text-xs text-muted">{t("companyChat.subtitle")}</p> : null}
          <ul className="divide-y divide-border rounded-[14px] bg-surface-1 px-3.5">{rows.map(({ item, extra }) => row(item, extra))}</ul>
        </section>
      ))}
      {sections.length === 0 ? <p className="text-sm text-muted">{t("featureGroups.search.none")}</p> : null}
    </div>
  );
}
