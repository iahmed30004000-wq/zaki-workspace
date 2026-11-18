"use client";

import React, { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { THEME_KEYS, THEMES, themeLabelKey } from "@/lib/themes/registry";
import { Button, BUTTON_VARIANTS } from "@/components/ui/button";
import { Badge, BADGE_TONES } from "@/components/ui/badge";
import { ListRow } from "@/components/ui/list-row";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Avatar } from "@/components/ui/avatar";

/**
 * «معاينة المظاهر» (D1.3): every primitive in every theme, side by side, for the owner to review and pick the final accent shades. Each theme is a box with its own
 * \`data-theme\`, so the CSS variables of that theme apply inside it whatever theme the page is in. Nothing here saves anything.
 */
function Sample({ themeKey }: { themeKey: (typeof THEME_KEYS)[number] }) {
  const { t } = useI18n();
  const [seg, setSeg] = useState("a");
  const [on, setOn] = useState(true);
  const dark = THEMES[themeKey].dark;
  return (
    <section data-theme={themeKey} className={`${dark ? "dark " : ""}space-y-3 rounded-xl border border-border bg-surface p-3 text-fg`} aria-label={t(themeLabelKey(themeKey))}>
      <h3 className="text-sm font-semibold">{t(themeLabelKey(themeKey))}</h3>
      <div className="flex flex-wrap items-center gap-2">
        {BUTTON_VARIANTS.map((v) => (
          <Button key={v} variant={v} type="button">
            {v === "fab" ? "+" : t(`design.button.${v}`)}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {BADGE_TONES.map((b) => (
          <Badge key={b} tone={b}>
            {b === "accent" ? "3" : t(`design.badge.${b}`)}
          </Badge>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface-1">
        <ListRow leading={<Avatar name={t("design.sample.name")} />} title={t("design.sample.name")} subtitle={t("design.sample.line")} trailing="10:30" />
        <ListRow leading={<Avatar name={t("design.sample.name2")} />} title={t("design.sample.name2")} subtitle={t("design.sample.line")} trailing="09:12" selected />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={seg} onChange={setSeg} label={t("design.sample.segmented")} options={[{ value: "a", label: t("design.sample.opt_a") }, { value: "b", label: t("design.sample.opt_b") }]} />
        <Switch checked={on} onChange={setOn} label={t("design.sample.switch")} />
      </div>
      <div className="space-y-1 rounded-lg p-2" style={{ background: "rgb(var(--chat-wallpaper))" }}>
        <p className="w-fit max-w-[85%] rounded-2xl bg-bubble-in px-3 py-1.5 text-[15px] leading-[1.45] text-bubble-in-fg">{t("design.sample.in")}</p>
        <p className="ms-auto w-fit max-w-[85%] rounded-2xl bg-bubble-out px-3 py-1.5 text-[15px] leading-[1.45] text-bubble-out-fg">{t("design.sample.out")}</p>
      </div>
    </section>
  );
}

export function PrimitiveSamples() {
  const { t } = useI18n();
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface-1 p-5" aria-labelledby="design-review-title">
      <div>
        <h2 id="design-review-title" className="text-sm font-semibold">
          {t("design.review.title")}
        </h2>
        <p className="text-xs text-muted">{t("design.review.hint")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {THEME_KEYS.map((k) => (
          <Sample key={k} themeKey={k} />
        ))}
      </div>
    </section>
  );
}
