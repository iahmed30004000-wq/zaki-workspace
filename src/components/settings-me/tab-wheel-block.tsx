"use client";

import { useEffect, useState } from "react";
import { SwitchRow } from "@/components/members/switch-row";
import { Group } from "@/components/settings-me/parts";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_WHEEL_PREFS, loadWheelPrefs, saveWheelPrefs, type WheelPrefs } from "@/lib/nav/tab-wheel";

/**
 * «شريط التبويبات» — the four choices for the phone's tab wheel (the owner, 2026-11-21): the wheel itself (off: the plain strip), its motion, its tick, its glass.
 * They are this device's (`localStorage`, `src/lib/nav/tab-wheel.ts`) and apply at once: saving tells the strip on screen.
 */
export function TabWheelBlock() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<WheelPrefs>(DEFAULT_WHEEL_PREFS);
  useEffect(() => setPrefs(loadWheelPrefs()), []);
  const set = (key: keyof WheelPrefs) => (on: boolean) => {
    const next = { ...prefs, [key]: on };
    setPrefs(next);
    saveWheelPrefs(next);
  };
  return (
    <Group title={t("settingsMe.wheel.title")} hint={t("settingsMe.wheel.hint")} id="l-tab-wheel" rows>
      <SwitchRow checked={prefs.wheel} onChange={set("wheel")} title={t("settingsMe.wheel.wheel")} hint={t("settingsMe.wheel.wheel.hint")} />
      <SwitchRow checked={prefs.motion} onChange={set("motion")} disabled={!prefs.wheel} title={t("settingsMe.wheel.motion")} hint={t("settingsMe.wheel.motion.hint")} />
      <SwitchRow checked={prefs.sound} onChange={set("sound")} disabled={!prefs.wheel} title={t("settingsMe.wheel.sound")} hint={t("settingsMe.wheel.sound.hint")} />
      <SwitchRow checked={prefs.glass} onChange={set("glass")} disabled={!prefs.wheel} title={t("settingsMe.wheel.glass")} hint={t("settingsMe.wheel.glass.hint")} />
    </Group>
  );
}
