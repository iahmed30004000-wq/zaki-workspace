"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { TG_BUBBLE_RADIUS, TG_FONT_PX } from "@/lib/chat/prefs";
import { Group, Scope } from "@/components/settings-me/parts";
import { usePersonPrefs, useSavePatch } from "@/components/settings-me/use-person-prefs";
import { withChat } from "@/components/settings-me/chat-section";

/**
 * «تيليجرام على التلفون»: the message text (12 to 30) and the bubble's corners (0 to 17), each on a slider, over two sample bubbles that change under the
 * finger. The sample follows at once; the account is written when the finger lets go.
 */
export function TgChatShape() {
  const { t } = useI18n();
  const { toast } = useToast();
  const person = usePersonPrefs();
  const save = useSavePatch();
  const savedPx = person.prefs.chat?.fontPx ?? TG_FONT_PX.default;
  const savedRadius = person.prefs.chat?.bubbleRadius ?? TG_BUBBLE_RADIUS.default;
  const [px, setPx] = useState<number>(savedPx);
  const [radius, setRadius] = useState<number>(savedRadius);
  useEffect(() => setPx(savedPx), [savedPx]);
  useEffect(() => setRadius(savedRadius), [savedRadius]);

  async function keep(key: "fontPx" | "bubbleRadius", value: number, standard: number) {
    if (value === (key === "fontPx" ? savedPx : savedRadius)) return;
    const ok = await save((p) => ({ chat: withChat(p, key, value === standard ? undefined : value) }));
    if (!ok) toast(t("settingsMe.failed"), "error");
  }

  const bubble = "max-w-[85%] px-3 py-1.5 shadow-sm";
  const slider = (key: "fontPx" | "bubbleRadius", label: string, value: number, range: { min: number; max: number; default: number }, set: (next: number) => void) => (
    <label className="mt-3 block">
      <span className="flex items-center justify-between text-sm text-fg">
        <span>{label}</span>
        <span className="tabular-nums text-accent">{value}</span>
      </span>
      <input
        type="range"
        data-tg-slider={key}
        min={range.min}
        max={range.max}
        step={1}
        value={value}
        onChange={(event) => set(Number(event.currentTarget.value))}
        onPointerUp={(event) => void keep(key, Number(event.currentTarget.value), range.default)}
        onKeyUp={(event) => void keep(key, Number(event.currentTarget.value), range.default)}
        onBlur={(event) => void keep(key, Number(event.currentTarget.value), range.default)}
        className="h-11 w-full accent-accent"
      />
    </label>
  );

  return (
    <Group title={t("settingsMe.c.font")} hint={t("settingsMe.tg.hint")} id="c-font">
      <div data-tg-shape-sample className="space-y-1.5 rounded-xl bg-chat-wallpaper p-3" style={{ fontSize: px, lineHeight: 1.45 }}>
        <p className={`${bubble} me-auto w-fit bg-bubble-in text-bubble-in-fg`} style={{ borderRadius: radius }}>
          {t("settingsMe.tg.sample.in")}
        </p>
        <p className={`${bubble} ms-auto w-fit bg-bubble-out text-bubble-out-fg`} style={{ borderRadius: radius }}>
          {t("settingsMe.c.font.sample")}
        </p>
      </div>
      {slider("fontPx", t("settingsMe.tg.size"), px, TG_FONT_PX, setPx)}
      {slider("bubbleRadius", t("settingsMe.tg.radius"), radius, TG_BUBBLE_RADIUS, setRadius)}
      <Scope />
    </Group>
  );
}
