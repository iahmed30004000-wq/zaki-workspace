"use client";

import { Segmented } from "@/components/ui/segmented";
import { useDigits } from "@/components/theme/digits-provider";
import { useI18n } from "@/lib/i18n";
import { DIGIT_MODES, type DigitMode } from "@/lib/digits";
import { Group } from "@/components/settings-me/parts";

/**
 * C4.1 — «اللغة والأرقام»: Arabic (the only language, listed for completeness) and the digits «123 / ١٢٣» (`User.digits`, `POST /api/me/digits`, applied at once
 * by the digits provider: nothing reloads). The words are the ones the theme picker already uses.
 */
export function DigitsBlock() {
  const { t } = useI18n();
  const { digits, setDigits } = useDigits();
  return (
    <Group title={t("digits.picker")} hint={t("settingsMe.l.digits.hint")} id="l-digits">
      <Segmented<DigitMode> value={digits} label={t("digits.picker")} options={DIGIT_MODES.map((mode) => ({ value: mode, label: t(`digits.${mode}`) }))} onChange={setDigits} />
    </Group>
  );
}

export function LanguageSection() {
  const { t } = useI18n();
  return (
    <div data-section-body="language">
      <Group title={t("settingsMe.l.arabic")} hint={t("settingsMe.l.arabic.hint")} id="l-arabic">
        <p aria-current="true" className="inline-flex min-h-11 items-center rounded-xl bg-selected-row px-4 text-sm font-medium text-selected-row-fg">
          {t("settingsMe.l.arabic")}
        </p>
      </Group>
      <DigitsBlock />
    </div>
  );
}
