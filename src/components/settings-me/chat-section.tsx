"use client";

import { useEffect, useReducer, useState } from "react";
import { Check } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { SwitchRow } from "@/components/members/switch-row";
import { ThemePicker } from "@/components/theme/theme-picker";
import { chooseTheme } from "@/components/theme/theme-provider";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { DEFAULT_WALLPAPER, FONT_SCALES, SEND_KEYS, WALLPAPERS, fontStepOf, quickReactionsPref, type ChatPrefs, type SendKey, type Wallpaper } from "@/lib/chat/prefs";
import { effectiveFontStep, patchDevicePrefs, readDevicePrefs } from "@/lib/device-prefs";
import { QUICK_COUNT, QUICK_PALETTE, doubleTapEmojiOf, quickReactionsOf } from "@/lib/chat/v2/menu/quick-reactions";
import { THEME_COOKIE, prefCookieString } from "@/lib/themes/registry";
import { applyAppearance } from "@/components/settings-me/appearance";
import { Group, Scope, WarnFix } from "@/components/settings-me/parts";
import { useSavePatch, usePersonPrefs } from "@/components/settings-me/use-person-prefs";

/**
 * C4.1 — «الدردشة»: the text size, the wallpaper, the theme, the send key, the quick reactions and the double tap. The account's choices are saved in
 * `User.chatPrefs.chat` (they follow the person); the text size may also be kept for THIS device only (`zk-device-prefs`). The text size and the wallpaper
 * apply at once, with no reload: the save updates the cache and the cache's effect (`useApplyPersonPrefs`) writes the device's copy and applies it.
 */

/** The `chat` section after one key changed (`undefined` removes it); keys this screen does not know stay as they were. */
export function withChat(prefs: ChatPrefs, key: string, value: unknown): NonNullable<ChatPrefs["chat"]> {
  const next: Record<string, unknown> = { ...(prefs.chat ?? {}) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next as NonNullable<ChatPrefs["chat"]>;
}

/** Was «تلقائي حسب الجهاز» chosen on this device (the cookie says `system`)? */
export function autoThemeChosen(): boolean {
  return typeof document !== "undefined" && /(?:^|;\s*)zaki_theme=system(?:;|$)/.test(document.cookie);
}

function useRerenderOnTheme(): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const observer = new MutationObserver(() => bump());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
}

export function FontSizeBlock() {
  const { t } = useI18n();
  const { toast } = useToast();
  const person = usePersonPrefs();
  const save = useSavePatch();
  const [device, setDevice] = useState(readDevicePrefs);
  useEffect(() => setDevice(readDevicePrefs()), [person.prefs]);
  const perDevice = device.textSize !== undefined;
  const step = perDevice ? effectiveFontStep(device) : fontStepOf(person.prefs);

  async function pick(next: number) {
    if (perDevice) {
      setDevice(patchDevicePrefs({ textSize: next }));
      applyAppearance(readDevicePrefs());
      return;
    }
    const ok = await save((p) => ({ chat: withChat(p, "fontStep", next === 2 ? undefined : next) }));
    if (!ok) toast(t("settingsMe.failed"), "error");
  }

  function togglePerDevice(on: boolean) {
    setDevice(patchDevicePrefs({ textSize: on ? step : undefined }));
    applyAppearance(readDevicePrefs());
  }

  return (
    <Group title={t("settingsMe.c.font")} hint={t("settingsMe.c.font.hint")} id="c-font">
      <div role="radiogroup" aria-label={t("settingsMe.c.font")} className="grid grid-cols-5 gap-1 rounded-xl bg-surface-2 p-1">
        {FONT_SCALES.map((scale, at) => (
          <button
            key={scale}
            type="button"
            role="radio"
            aria-checked={at === step}
            data-font-step={at}
            onClick={() => void pick(at)}
            className={cn("min-h-11 rounded-lg px-1 text-xs transition-colors", at === step ? "bg-surface font-semibold text-fg shadow-card" : "text-fg-muted hover:text-fg")}
          >
            {t(`settingsMe.c.font.${at}`)}
          </button>
        ))}
      </div>
      <p data-font-sample className="mt-3 rounded-xl bg-bubble-in px-3 py-2 text-bubble-in-fg" style={{ fontSize: `calc(15px * ${FONT_SCALES[step] ?? 1})` }}>
        {t("settingsMe.c.font.sample")}
      </p>
      <SwitchRow checked={perDevice} onChange={togglePerDevice} title={t("settingsMe.c.font.device")} hint={t("settingsMe.c.font.device.hint")} />
      <Scope device={perDevice} />
    </Group>
  );
}

export function WallpaperBlock() {
  const { t } = useI18n();
  const { toast } = useToast();
  const person = usePersonPrefs();
  const save = useSavePatch();
  const current: Wallpaper = person.prefs.chat?.wallpaper ?? DEFAULT_WALLPAPER;

  async function pick(next: Wallpaper) {
    const ok = await save((p) => ({ chat: withChat(p, "wallpaper", next) }));
    if (!ok) toast(t("settingsMe.failed"), "error");
  }

  return (
    <Group title={t("settingsMe.c.wallpaper")} hint={t("settingsMe.c.wallpaper.hint")} id="c-wallpaper">
      <div role="radiogroup" aria-label={t("settingsMe.c.wallpaper")} className="grid grid-cols-4 gap-2">
        {WALLPAPERS.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={key === current}
            data-wallpaper={key}
            onClick={() => void pick(key)}
            className={cn(
              "relative flex min-h-20 flex-col items-center justify-end overflow-hidden rounded-xl border p-1.5 text-xs transition-colors",
              key === current ? "border-accent text-fg" : "border-border text-fg-muted hover:border-accent/50",
            )}
            style={{ background: "rgb(var(--chat-wallpaper))" }}
          >
            {key === "plain" ? null : (
              <span
                aria-hidden="true"
                className="absolute inset-0 opacity-60"
                style={{ backgroundColor: "rgb(var(--chat-pattern))", WebkitMask: `url(/brand/wallpapers/${key}.svg) center / 48px 48px`, mask: `url(/brand/wallpapers/${key}.svg) center / 48px 48px` }}
              />
            )}
            <span className="relative rounded-full bg-surface-1 px-2 py-0.5 text-fg">{t(`settingsMe.c.wallpaper.${key}`)}</span>
            {key === current ? <Check aria-hidden="true" className="absolute end-1 top-1 size-4 text-accent" /> : null}
          </button>
        ))}
      </div>
      <Scope />
    </Group>
  );
}

/** «تلقائي حسب الجهاز» and then the themes of the picker (a concrete pick always wins over «تلقائي»). */
export function ThemeBlock() {
  const { t } = useI18n();
  const person = usePersonPrefs();
  const save = useSavePatch();
  useRerenderOnTheme();
  const auto = autoThemeChosen();
  const accountAuto = person.prefs.chat?.themeAuto === true;

  // the picker below chose a concrete theme: the account stops saying «تلقائي» too
  useEffect(() => {
    if (person.loaded && accountAuto && !auto) void save((p) => ({ chat: withChat(p, "themeAuto", undefined) }));
    // only when the cookie and the account disagree
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.loaded, accountAuto, auto]);

  async function setAuto(on: boolean) {
    if (on) {
      document.cookie = prefCookieString(THEME_COOKIE, "system", location.protocol === "https:");
      (window as unknown as { __zkThemeBoot?: () => void }).__zkThemeBoot?.();
      await save((p) => ({ chat: withChat(p, "themeAuto", true) }));
    } else {
      // back to a concrete theme: the one on screen now
      chooseTheme((document.documentElement.getAttribute("data-theme") ?? "night") as Parameters<typeof chooseTheme>[0]);
      await save((p) => ({ chat: withChat(p, "themeAuto", undefined) }));
    }
  }

  return (
    <Group title={t("settingsMe.c.theme")} id="c-theme">
      <SwitchRow checked={auto} onChange={(on) => void setAuto(on)} title={t("settingsMe.c.theme.auto")} hint={t("settingsMe.c.theme.auto.hint")} />
      <p className="mb-3 text-xs text-fg-muted">{t("settingsMe.c.theme.device")}</p>
      <ThemePicker />
    </Group>
  );
}

export function SendKeyBlock() {
  const { t } = useI18n();
  const { toast } = useToast();
  const person = usePersonPrefs();
  const save = useSavePatch();
  const current: SendKey = person.prefs.chat?.sendKey ?? "enter";
  return (
    <Group title={t("settingsMe.c.sendkey")} hint={t("settingsMe.c.sendkey.hint")} id="c-sendkey">
      <Segmented<SendKey>
        value={current}
        label={t("settingsMe.c.sendkey")}
        options={SEND_KEYS.map((key) => ({ value: key, label: t(`settingsMe.c.sendkey.${key}`) }))}
        onChange={(next) => {
          void save((p) => ({ chat: withChat(p, "sendKey", next === "enter" ? undefined : next) })).then((ok) => {
            if (!ok) toast(t("settingsMe.failed"), "error");
          });
        }}
      />
      <Scope />
    </Group>
  );
}

/** «التفاعل السريع»: six slots, each picked from the palette; a reaction already in another slot is refused (the six must be different). */
export function QuickReactionsBlock() {
  const { t } = useI18n();
  const { toast } = useToast();
  const person = usePersonPrefs();
  const save = useSavePatch();
  const [slot, setSlot] = useState<number | null>(null);
  const six = quickReactionsOf(quickReactionsPref(person.prefs) ?? null);
  const doubleTap = doubleTapEmojiOf(person.prefs.chat?.doubleTap);

  async function put(next: readonly string[]) {
    const same = next.every((emoji, at) => emoji === quickReactionsOf(null)[at]);
    const ok = await save((p) => ({ chat: withChat(p, "quickReactions", same ? undefined : [...next]) }));
    if (!ok) toast(t("settingsMe.failed"), "error");
  }

  function choose(emoji: string) {
    if (slot === null) return;
    if (six.includes(emoji) && six[slot] !== emoji) {
      toast(t("settingsMe.c.quick.taken"), "error");
      return;
    }
    const next = [...six];
    next[slot] = emoji;
    setSlot(null);
    void put(next);
  }

  async function chooseDoubleTap(emoji: string | null) {
    const ok = await save((p) => ({ chat: withChat(p, "doubleTap", emoji ?? undefined) }));
    if (!ok) toast(t("settingsMe.failed"), "error");
  }

  return (
    <>
      <Group title={t("settingsMe.c.quick")} hint={t("settingsMe.c.quick.hint")} id="c-quick">
        <div data-quick-slots className="flex flex-wrap gap-2">
          {six.map((emoji, at) => (
            <button
              key={at}
              type="button"
              data-quick-slot={at}
              aria-label={t("settingsMe.c.quick.slot", { n: at + 1, emoji })}
              aria-pressed={slot === at}
              onClick={() => setSlot(slot === at ? null : at)}
              className={cn("grid size-12 place-items-center rounded-xl border text-2xl transition-colors", slot === at ? "border-accent bg-accent/10" : "border-border hover:border-accent/50")}
            >
              {emoji}
            </button>
          ))}
        </div>
        {slot !== null ? (
          <div data-quick-palette role="group" aria-label={t("settingsMe.c.quick.pick", { n: slot + 1 })} className="mt-3 flex flex-wrap gap-1.5 rounded-xl bg-surface-2 p-2">
            {QUICK_PALETTE.map((emoji) => (
              <button
                key={emoji}
                type="button"
                disabled={six.includes(emoji) && six[slot] !== emoji}
                onClick={() => choose(emoji)}
                className="grid size-11 place-items-center rounded-lg text-xl hover:bg-surface disabled:opacity-30"
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
        <p className="mt-2 text-xs text-fg-muted">{t("settingsMe.c.quick.reload")}</p>
        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => void put(quickReactionsOf(null))}>
          {t("settingsMe.c.quick.reset")}
        </Button>
        <Scope />
      </Group>
      <Group title={t("settingsMe.c.doubletap")} hint={t("settingsMe.c.doubletap.hint")} id="c-doubletap">
        <div data-double-tap role="radiogroup" aria-label={t("settingsMe.c.doubletap")} className="flex flex-wrap gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={doubleTap === null}
            onClick={() => void chooseDoubleTap(null)}
            className={cn("min-h-12 rounded-xl border px-3 text-sm", doubleTap === null ? "border-accent bg-accent/10 text-fg" : "border-border text-fg-muted")}
          >
            {t("settingsMe.c.doubletap.none")}
          </button>
          {six.slice(0, QUICK_COUNT).map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="radio"
              aria-checked={doubleTap === emoji}
              aria-label={t("settingsMe.c.doubletap.pick", { emoji })}
              onClick={() => void chooseDoubleTap(emoji)}
              className={cn("grid size-12 place-items-center rounded-xl border text-2xl", doubleTap === emoji ? "border-accent bg-accent/10" : "border-border hover:border-accent/50")}
            >
              {emoji}
            </button>
          ))}
        </div>
        <WarnFix warn={t("settingsMe.c.doubletap.warn")} fix={t("settingsMe.c.doubletap.fix")} className="mt-3" />
        <Scope />
      </Group>
    </>
  );
}

export function ChatSection() {
  return (
    <div data-section-body="chat">
      <FontSizeBlock />
      <WallpaperBlock />
      <ThemeBlock />
      <SendKeyBlock />
      <QuickReactionsBlock />
    </div>
  );
}
