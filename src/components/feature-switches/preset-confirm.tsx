"use client";

import { useI18n } from "@/lib/i18n";
import type { FeaturePreset } from "@/lib/feature-groups";
import type { FeatureKey } from "@/lib/features";
import { Button } from "@/components/ui/button";

/**
 * A1.4 — the confirmation of a preset: what WILL change (only the switches whose value differs), that nothing stored is deleted, the ⚠️ with its 🔧 under it,
 * and for «الوضع البسيط» the line that goals, production, campaigns and CRM are permissions this button does not hide. Nothing happens until «أكّد».
 */
export function PresetConfirm({
  preset,
  changes,
  busy,
  onConfirm,
  onCancel,
}: {
  preset: FeaturePreset;
  changes: { key: FeatureKey; on: boolean }[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const turningOn = changes.filter((c) => c.on);
  const turningOff = changes.filter((c) => !c.on);
  const list = (title: string, rows: { key: FeatureKey }[]) =>
    rows.length > 0 ? (
      <div>
        <p className="text-xs font-medium text-fg">{title}</p>
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {rows.map((c) => (
            <li key={c.key} className="rounded-full border border-border bg-surface-1 px-2.5 py-0.5 text-xs text-fg">
              {t(`features.${c.key}.name`)}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div className="space-y-3 rounded-lg border border-accent/40 bg-surface-2 p-3" role="group" aria-labelledby={`preset-confirm-${preset}`} data-preset-confirm={preset}>
      <p id={`preset-confirm-${preset}`} className="text-sm font-semibold text-fg">
        {t("featureGroups.confirm.title", { name: t(`featureGroups.presets.${preset}.name`) })}
      </p>
      {changes.length === 0 ? (
        <p className="text-xs text-muted">{t("featureGroups.confirm.none")}</p>
      ) : (
        <>
          {list(t("featureGroups.confirm.to_off"), turningOff)}
          {list(t("featureGroups.confirm.to_on"), turningOn)}
          <p className="text-xs text-muted">{t("featureGroups.confirm.kept")}</p>
          <div className="space-y-0.5">
            <p className="text-xs leading-6 text-warn">{t(`featureGroups.confirm.warn.${preset}`)}</p>
            <p className="text-xs leading-6 text-fg">{t(`featureGroups.confirm.fix.${preset}`)}</p>
          </div>
          {preset === "simple" ? <p className="text-xs leading-6 text-muted">{t("featureGroups.confirm.tabs.simple")}</p> : null}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {changes.length > 0 ? (
          <Button type="button" size="sm" onClick={onConfirm} disabled={busy}>
            {t("featureGroups.confirm.go")}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
          {t("featureGroups.confirm.cancel")}
        </Button>
      </div>
    </div>
  );
}
