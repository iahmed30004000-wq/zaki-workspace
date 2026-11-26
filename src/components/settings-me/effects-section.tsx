"use client";

import { useEffect, useState } from "react";
import { SwitchRow } from "@/components/members/switch-row";
import { Group, Scope } from "@/components/settings-me/parts";
import { useI18n } from "@/lib/i18n";
import { patchDevicePrefs, readDevicePrefs } from "@/lib/device-prefs";
import { EFFECT_KEYS, applyEffectsOff, type EffectKey } from "@/lib/motion/effects";

/**
 * «التأثيرات الحركية»: one switch per effect, for THIS device. A change is written, put on the page at once (`applyEffectsOff`), and followed by whatever
 * is mounted. A device that asks for less motion stops the moving ones by itself, whatever the switches say, and the page says so.
 */
export function EffectsSection() {
  const { t } = useI18n();
  const [off, setOff] = useState<EffectKey[]>([]);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setOff(readDevicePrefs().effectsOff ?? []);
    setReduced(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  function set(key: EffectKey, on: boolean) {
    const next = EFFECT_KEYS.filter((k) => (k === key ? !on : off.includes(k)));
    setOff(next);
    patchDevicePrefs({ effectsOff: next.length > 0 ? next : undefined });
    applyEffectsOff(next);
  }

  return (
    <div data-section-body="effects">
      <Group title={t("settingsMe.fx.title")} hint={reduced ? t("settingsMe.fx.reduced") : t("settingsMe.fx.lead")} rows>
        {EFFECT_KEYS.map((key) => (
          <div key={key} data-effect-row={key} className="px-0.5">
            <SwitchRow title={t(`settingsMe.fx.${key}`)} hint={t(`settingsMe.fx.${key}.hint`)} checked={!off.includes(key)} onChange={(on) => set(key, on)} />
          </div>
        ))}
      </Group>
      <div className="px-4 md:px-1">
        <Scope device />
      </div>
    </div>
  );
}
