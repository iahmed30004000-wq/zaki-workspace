"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { FEATURE_PRESETS, presetActive, presetChanges, type FeaturePreset } from "@/lib/feature-groups";
import type { FeatureKey } from "@/lib/features";
import { cn } from "@/lib/utils";
import { PresetConfirm } from "./preset-confirm";

/**
 * A1.4 — the two presets at the top of «الميزات»: «الوضع البسيط» and «كل شي». A press only OPENS the confirmation (what would change); `onApply` runs
 * on «أكّد» and the server decides the keys (the client names the preset, never a list). `initialPending` is for the markup tests.
 */
export function PresetsBar({
  items,
  onApply,
  busy = false,
  initialPending = null,
}: {
  items: { key: FeatureKey; on: boolean }[];
  onApply: (preset: FeaturePreset) => Promise<void>;
  busy?: boolean;
  initialPending?: FeaturePreset | null;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState<FeaturePreset | null>(initialPending);

  async function confirm(preset: FeaturePreset) {
    await onApply(preset);
    setPending(null);
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface-1 p-4" aria-labelledby="presets-title" data-presets>
      <div>
        <h3 id="presets-title" className="text-sm font-semibold text-fg">
          {t("featureGroups.presets.title")}
        </h3>
        <p className="text-xs text-muted">{t("featureGroups.presets.subtitle")}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {FEATURE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            data-preset={preset}
            aria-pressed={pending === preset}
            disabled={busy}
            onClick={() => setPending(pending === preset ? null : preset)}
            className={cn(
              "rounded-lg border p-3 text-start transition-colors disabled:opacity-60",
              pending === preset ? "border-accent bg-accent/[0.08]" : "border-border bg-surface-2 hover:bg-surface",
            )}
          >
            <span className="block text-sm font-medium text-fg">
              {t(`featureGroups.presets.${preset}.name`)}
              {presetActive(preset, items) ? <span className="ms-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">{t("featureGroups.presets.active")}</span> : null}
            </span>
            <span className="mt-1 block text-xs leading-6 text-muted">{t(`featureGroups.presets.${preset}.desc`)}</span>
          </button>
        ))}
      </div>
      {pending ? <PresetConfirm preset={pending} changes={presetChanges(pending, items)} busy={busy} onConfirm={() => confirm(pending)} onCancel={() => setPending(null)} /> : null}
    </section>
  );
}
