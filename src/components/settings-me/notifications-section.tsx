"use client";

import { useEffect, useRef, useState } from "react";
import { startRing } from "@/lib/calls/ring-sound";
import { DEFAULT_RING_TONE, loadRingTone, RING_TONE_LABEL, RING_TONES, saveRingTone, type RingTone } from "@/lib/calls/ring-prefs";
import { Button } from "@/components/ui/button";
import { SwitchRow } from "@/components/members/switch-row";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { NOTIFY_TYPES, notifyRuleOf, type ChatPrefs, type NotifyRule, type NotifyType } from "@/lib/chat/prefs";
import { setSoundsEnabled, soundsEnabled } from "@/lib/chat/sounds";
import { useChatList } from "@/lib/chat/cache";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { usePersonalCall } from "@/components/chat/v2/row-menu";
import { Group, WarnFix } from "@/components/settings-me/parts";
import { useSavePatch, usePersonPrefs } from "@/components/settings-me/use-person-prefs";

/**
 * C4.1 — «الإشعارات والأصوات». Five kinds (a private chat, a topic, a mention, a reply to me, a call), each with its own switch and, except calls, the preview
 * of the words in the push. What is saved is `User.chatPrefs.notifications`, and it is what `src/server/chat/notify.ts` and `src/server/calls/push.ts` obey. A
 * kind that is off carries ⚠️ and its 🔧 where switching it off costs the person something. «أعد ضبط الإشعارات» puts the whole section back to its defaults.
 */

/** The `notifications` section after one kind's rule changed: the other kinds and any key this screen does not know stay as they were. */
export function withRule(prefs: ChatPrefs, type: NotifyType, rule: NotifyRule): NonNullable<ChatPrefs["notifications"]> {
  const next: NonNullable<ChatPrefs["notifications"]> = { ...(prefs.notifications ?? {}) };
  const clean: NotifyRule = {};
  if (rule.on === false) clean.on = false;
  if (rule.preview === false) clean.preview = false;
  if (Object.keys(clean).length === 0) delete next[type];
  else next[type] = clean;
  return next;
}

const WARNED: Partial<Record<NotifyType, true>> = { mentions: true, calls: true };

function stopPreview(preview: { current: { stop: () => void; timer: ReturnType<typeof setTimeout> } | null }): void {
  if (!preview.current) return;
  clearTimeout(preview.current.timer);
  preview.current.stop();
  preview.current = null;
}

export function NotificationsSection() {
  const { t } = useI18n();
  const { toast } = useToast();
  const person = usePersonPrefs();
  const save = useSavePatch();
  const [sounds, setSounds] = useState(true);
  useEffect(() => setSounds(soundsEnabled()), []);
  // the incoming-call ringtone of THIS device (three to choose from; «جرّبها» plays it for a few seconds)
  const [ringTone, setRingTone] = useState<RingTone>(DEFAULT_RING_TONE);
  useEffect(() => setRingTone(loadRingTone()), []);
  const preview = useRef<{ stop: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => () => stopPreview(preview), []);
  function chooseTone(tone: RingTone) {
    setRingTone(tone);
    saveRingTone(tone);
    tryTone(tone);
  }
  function tryTone(tone: RingTone) {
    stopPreview(preview);
    preview.current = { stop: startRing({ tone }), timer: setTimeout(() => stopPreview(preview), 3500) };
  }

  async function change(type: NotifyType, rule: NotifyRule) {
    const ok = await save((current) => {
      const next = withRule(current, type, rule);
      return { notifications: Object.keys(next).length === 0 ? null : next };
    });
    if (!ok) toast(t("settingsMe.failed"), "error");
  }

  async function reset() {
    const ok = await save(() => ({ notifications: null }));
    toast(ok ? t("settingsMe.n.reset.done") : t("settingsMe.failed"), ok ? "success" : "error");
  }

  return (
    <div data-section-body="notifications">
      <p className="px-3 pb-3 text-[13px] leading-[1.45] text-fg-muted md:px-0">{t("settingsMe.n.intro")}</p>
      {NOTIFY_TYPES.map((type) => {
        const rule = notifyRuleOf(person.prefs, type);
        const on = rule.on !== false;
        return (
          <Group key={type} id={`n-${type}`} rows>
            <SwitchRow
              checked={on}
              disabled={!person.loaded}
              onChange={(next) => void change(type, { ...rule, on: next })}
              title={t(`settingsMe.n.type.${type}`)}
              hint={t(`settingsMe.n.type.${type}.hint`)}
            />
            {on && type !== "calls" ? (
              <SwitchRow
                checked={rule.preview !== false}
                disabled={!person.loaded}
                onChange={(next) => void change(type, { ...rule, preview: next })}
                title={t("settingsMe.n.preview")}
                hint={t("settingsMe.n.preview.hint")}
              />
            ) : null}
            {!on && WARNED[type] ? <WarnFix warn={t(`settingsMe.n.warn.${type}`)} fix={t(`settingsMe.n.fix.${type}`)} className="m-3" /> : null}
          </Group>
        );
      })}

      <Group rows>
        <SwitchRow
          checked={sounds}
          onChange={(next) => {
            setSounds(next);
            setSoundsEnabled(next);
          }}
          title={t("settingsMe.n.sounds")}
          hint={t("settingsMe.n.sounds.hint")}
        />
      </Group>

      <Group title={t("calls.tone.title")} hint={t("calls.tone.hint")} id="n-ringtone">
        <div role="radiogroup" aria-label={t("calls.tone.title")} className="flex flex-col gap-2">
          {RING_TONES.map((tone) => (
            <div key={tone} className="flex items-center gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={ringTone === tone}
                onClick={() => chooseTone(tone)}
                className={`flex min-h-11 flex-1 items-center gap-2 rounded-lg border px-3 text-start text-sm ${ringTone === tone ? "border-accent bg-accent/10 font-semibold text-fg" : "border-border text-fg hover:bg-surface-2"}`}
              >
                <span aria-hidden="true" className={`size-4 shrink-0 rounded-full border-2 ${ringTone === tone ? "border-accent bg-accent" : "border-border"}`} />
                {t(RING_TONE_LABEL[tone])}
              </button>
              <Button type="button" size="sm" variant="ghost" onClick={() => tryTone(tone)}>
                {t("calls.tone.try")}
              </Button>
            </div>
          ))}
        </div>
      </Group>

      <Group title={t("settingsMe.n.exceptions")} hint={t("settingsMe.n.exceptions.hint")} id="n-exceptions">
        <MutedChats />
      </Group>

      <Group title={t("settingsMe.n.reset")} hint={t("settingsMe.n.reset.hint")}>
        <Button type="button" variant="secondary" disabled={!person.loaded} onClick={() => void reset()}>
          {t("settingsMe.n.reset")}
        </Button>
      </Group>
    </div>
  );
}

/** «استثناءات»: the chats the person muted, each with «ألغِ الكتم» (the same personal door the chat list uses). */
export function MutedChats() {
  const { t } = useI18n();
  const list = useChatList("all");
  const muted = [...list.rows, ...list.archivedRows].filter((row, at, all) => row.muted && all.findIndex((r) => r.id === row.id) === at);
  if (muted.length === 0) return <p className="text-sm text-fg-muted">{t("settingsMe.n.exceptions.none")}</p>;
  return (
    <ul data-muted-chats className="-mx-3.5 -my-3 divide-y divide-border">
      {muted.map((row) => (
        <MutedRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

function MutedRow({ row }: { row: ChatRowDto }) {
  const { t } = useI18n();
  const { call, busy } = usePersonalCall(row);
  return (
    <li className="flex min-h-14 items-center justify-between gap-3 px-3 py-2">
      <span className="min-w-0 truncate text-sm text-fg">
        <bdi>{row.title}</bdi>
      </span>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void call({ mutedUntil: null })}>
        {t("settingsMe.n.exceptions.unmute")}
      </Button>
    </li>
  );
}
