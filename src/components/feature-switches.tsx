"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPatch } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useOptionalToast } from "@/components/ui/toast";
import { ECONOMY_FORCED_OFF, ECONOMY_POLL_FACTOR, type FeatureKey } from "@/lib/features";
import { showModelWarning } from "@/lib/chat/customer-data-hint";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

/**
 * «الميزات»: the owner switches each feature on or off. Off, the feature is gone from every screen and its doors
 * answer «not found»; what it stored is kept, and switching it on brings it all back.
 */
export function FeatureSwitches({ initial, notReady = [] }: { initial: { key: FeatureKey; on: boolean }[]; notReady?: FeatureKey[] }) {
  const { t } = useI18n();
  const toast = useOptionalToast();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<FeatureKey | null>(null);

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

  // «وضع التوفير» is an overlay: what the owner left on stays on in the list, and is only MARKED while the master switch holds it off
  const economy = items.find((f) => f.key === "economyMode")?.on ?? false;
  const held = new Set<FeatureKey>(economy ? ECONOMY_FORCED_OFF.filter((key) => items.find((f) => f.key === key)?.on) : []);

  function toggle(item: { key: FeatureKey; on: boolean }) {
    return <Switch checked={item.on} onChange={(on) => flip(item.key, on)} label={t(`features.${item.key}.name`)} disabled={busy === item.key} />;
  }

  return (
    <div className="space-y-4">
      {/* «وضع التوفير»: the one switch for a server that is not strong enough; what it holds off is printed, with the way back */}
      <section
        className={cn("space-y-3 rounded-lg border p-4", economy ? "border-warn/40 bg-warn/10" : "border-border bg-surface-2")}
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
      <ul className="divide-y divide-border">
        {items
          .filter((f) => f.key !== "economyMode")
          .map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">
                  {t(`features.${f.key}.name`)}
                  {notReady.includes(f.key) ? <span className="ms-2 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">{t("semantic.not_ready")}</span> : null}
                  {held.has(f.key) ? <span className="ms-2 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">{t("economy.held")}</span> : null}
                </p>
                <p className="text-xs text-muted">{t(`features.${f.key}.hint`)}</p>
                {showModelWarning(items, f.key) ? <p data-model-warning className="text-xs leading-6 text-warn">{t("features.model_warn")}</p> : null}
                {notReady.includes(f.key) ? <p className="text-xs text-warn">{t("semantic.not_ready_hint")}</p> : null}
              </div>
              <div className={cn(held.has(f.key) && "opacity-50")}>
                {toggle(f)}
              </div>
            </li>
          ))}
      </ul>
    </div>
  );
}
