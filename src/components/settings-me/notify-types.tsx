"use client";

import { useState } from "react";
import Link from "next/link";
import { AtSign, ChevronDown, ChevronLeft, MessagesSquare, Music, Phone, Reply, UserRound, type LucideIcon } from "lucide-react";
import { SwitchRow } from "@/components/members/switch-row";
import { Switch } from "@/components/ui/switch";
import { Group, WarnFix } from "@/components/settings-me/parts";
import { soundChoiceName, useMySounds } from "@/components/settings-me/sounds-section";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { arabicPlural } from "@/lib/format";
import { tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { NOTIFY_TYPES, notifyRuleOf, type ChatPrefs, type NotifyRule, type NotifyType } from "@/lib/chat/prefs";
import type { SoundEvent } from "@/lib/sound-library/choice";
import { cleanSoundChoices } from "@/lib/sound-library/device";
import { SOUNDS_HREF, notifySubHref, soundsSubHref } from "@/lib/sound-library/hrefs";

/**
 * «الإشعارات» on a phone with Telegram's look: one card of the five kinds (a tap opens the kind's page, the switch at the end turns it on and off) and the
 * kind's own page: «أشعرني عن», «إظهار معاينة للرسالة», «الصوت» and «خيارات أكثر». It holds nothing the older page did not already store
 * (`chatPrefs.notifications`: on and preview per kind); the sounds are the sounds library's, one for all the message kinds, and the page says so.
 */
const ICONS: Record<NotifyType, LucideIcon> = { private: UserRound, topics: MessagesSquare, mentions: AtSign, replies: Reply, calls: Phone };

/** The two kinds whose muted chats are their exceptions. */
export type ExceptionKind = "private" | "topics";
export const exceptionKindOf = (type: NotifyType): ExceptionKind | null => (type === "private" || type === "topics" ? type : null);
export const isExceptionOf = (kind: ExceptionKind, row: { kind: string }): boolean => (kind === "private" ? row.kind === "DM" : row.kind !== "DM");

const WARNED_TYPES: Partial<Record<NotifyType, true>> = { mentions: true, calls: true };

/** The line under a kind's name: on or off, a switched-off preview, and how many chats are exceptions. */
export function notifySummary(t: (key: string, vars?: Record<string, string | number>) => string, type: NotifyType, rule: NotifyRule, exceptions: number): string {
  const parts = [t(rule.on === false ? "tgsheets.notify.off" : "tgsheets.notify.on")];
  if (rule.on !== false && rule.preview === false && type !== "calls") parts.push(t("tgsheets.notify.no_preview"));
  if (exceptions > 0) parts.push(t(`tgsheets.notify.exceptions.${arabicPlural(exceptions)}`, { n: exceptions }));
  return parts.join("، ");
}

export function NotifyTypeList({ prefs, loaded, exceptions, onRule }: { prefs: ChatPrefs; loaded: boolean; exceptions: Partial<Record<NotifyType, number>>; onRule: (type: NotifyType, rule: NotifyRule) => void }) {
  const { t } = useI18n();
  return (
    <>
      <Group title={t("tgsheets.notify.types")} rows>
        {NOTIFY_TYPES.map((type) => {
          const rule = notifyRuleOf(prefs, type);
          const on = rule.on !== false;
          const Icon = ICONS[type];
          return (
            <div key={type} data-notify-type={type} className="flex min-h-14 items-center gap-2 pe-3.5">
              <Link href={notifySubHref(type)} className="flex min-w-0 flex-1 items-center gap-3 py-2 ps-3.5 hover:bg-surface-2">
                <Icon aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-fg">{t(`settingsMe.n.type.${type}`)}</span>
                  <span className="block truncate text-[13px] text-fg-muted">{notifySummary(t, type, rule, exceptions[type] ?? 0)}</span>
                </span>
              </Link>
              <span aria-hidden="true" className="h-7 w-px shrink-0 bg-border" />
              <Switch checked={on} disabled={!loaded} label={t(`settingsMe.n.type.${type}`)} onChange={(next) => onRule(type, { ...rule, on: next })} className="min-h-11 min-w-11 justify-center" />
              {!on && WARNED_TYPES[type] ? <span className="sr-only">{t(`settingsMe.n.warn.${type}`)}</span> : null}
            </div>
          );
        })}
      </Group>
      {NOTIFY_TYPES.filter((type) => WARNED_TYPES[type] && notifyRuleOf(prefs, type).on === false).map((type) => (
        <WarnFix key={type} warn={t(`settingsMe.n.warn.${type}`)} fix={t(`settingsMe.n.fix.${type}`)} className="mx-3 mt-3" />
      ))}
    </>
  );
}

/** One row that leads to one event's radio list, with what it is set to now. */
function SoundLink({ event, title, value }: { event: SoundEvent; title: string; value: string }) {
  return (
    <Link href={soundsSubHref(event)} data-notify-sound={event} className="flex min-h-12 items-center gap-3 px-3.5 py-2 text-[15px] hover:bg-surface-2">
      <span className="min-w-0 flex-1 truncate text-fg">{title}</span>
      <bdi className="shrink-0 truncate text-[13px] text-accent">{value}</bdi>
    </Link>
  );
}

export function SoundLibraryRow() {
  const { t } = useI18n();
  return (
    <Group rows>
      <Link href={SOUNDS_HREF} data-sound-library="" className="flex min-h-14 items-center gap-3 px-3.5 py-2 hover:bg-surface-2">
        <Music aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] text-fg">{t("settingsMe.s.sounds")}</span>
          <span className="block truncate text-[13px] text-fg-muted">{t("settingsMe.s.sounds.hint")}</span>
        </span>
        <ChevronLeft aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
      </Link>
    </Group>
  );
}

export function NotifyTypePage({
  type,
  prefs,
  loaded,
  onRule,
  masterSounds,
  onMasterSounds,
  exceptionList,
  moreOpen: initiallyOpen = false,
}: {
  type: NotifyType;
  prefs: ChatPrefs;
  loaded: boolean;
  onRule: (type: NotifyType, rule: NotifyRule) => void;
  /** this device's «أصوات الدردشات» */
  masterSounds: boolean;
  onMasterSounds: (on: boolean) => void;
  /** the muted chats of this kind (drawn by the page that has the chat list); absent for the kinds with none */
  exceptionList?: React.ReactNode;
  /** a test opens «خيارات أكثر» without a browser */
  moreOpen?: boolean;
}) {
  const { t } = useI18n();
  const [more, setMore] = useState(initiallyOpen);
  const mine = useMySounds().data ?? [];
  const choices = cleanSoundChoices(prefs.sounds);
  const rule = notifyRuleOf(prefs, type);
  const on = rule.on !== false;
  const calls = type === "calls";
  const soundRow = (event: SoundEvent, title: string) => <SoundLink event={event} title={title} value={soundChoiceName(t, event, choices[event], mine)} />;
  return (
    <div data-notify-page={type}>
      <Group title={t("tgsheets.notify.about_title")} rows>
        <SwitchRow checked={on} disabled={!loaded} onChange={(next) => onRule(type, { ...rule, on: next })} title={t(`tgsheets.notify.about.${type}`)} hint={t(`settingsMe.n.type.${type}.hint`)} />
        {!on && WARNED_TYPES[type] ? <WarnFix warn={t(`settingsMe.n.warn.${type}`)} fix={t(`settingsMe.n.fix.${type}`)} className="m-3" /> : null}
      </Group>
      <Group title={t("tgsheets.notify.settings")} hint={calls ? undefined : t("tgsheets.notify.sound_shared")} rows>
        {calls ? null : <SwitchRow checked={rule.preview !== false} disabled={!loaded || !on} onChange={(next) => onRule(type, { ...rule, preview: next })} title={t("tgsheets.notify.preview")} hint={t("settingsMe.n.preview.hint")} />}
        {soundRow(calls ? "ring" : "inChat", t("tgsheets.notify.sound"))}
        <button type="button" data-notify-more="" aria-expanded={more} onClick={() => setMore((open) => !open)} className="flex min-h-12 w-full items-center gap-3 px-3.5 text-start text-[15px] text-accent hover:bg-surface-2">
          <span className="min-w-0 flex-1">{t("tgsheets.notify.more")}</span>
          <ChevronDown aria-hidden="true" className={cn("tg-chevron size-4 shrink-0", more && "rotate-180")} />
        </button>
        {more ? (
          <div data-notify-more-rows="" className="tg-rows-in [&>*+*]:border-t [&>*+*]:border-border" style={tgMotionVars(["moreRowsMs"])}>
            {calls ? soundRow("ringback", t("tgsheets.sounds.event.ringback")) : soundRow("received", t("tgsheets.sounds.event.received"))}
            {calls ? null : soundRow("sent", t("tgsheets.sounds.event.sent"))}
            {calls ? null : <SwitchRow checked={masterSounds} onChange={onMasterSounds} title={t("settingsMe.n.sounds")} hint={t("settingsMe.n.sounds.hint")} />}
            <button type="button" data-notify-reset={type} disabled={!loaded || (rule.on !== false && rule.preview !== false)} onClick={() => onRule(type, {})} className="flex min-h-12 w-full items-center px-3.5 text-start text-[15px] text-danger hover:bg-surface-2 disabled:text-fg-muted">
              {t("tgsheets.notify.reset_one")}
            </button>
          </div>
        ) : null}
      </Group>
      {exceptionList ? (
        <Group title={t("settingsMe.n.exceptions")} hint={t("settingsMe.n.exceptions.hint")}>
          {exceptionList}
        </Group>
      ) : null}
    </div>
  );
}
