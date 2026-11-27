"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronLeft, CirclePlus, MessageCircle, Phone, PhoneOutgoing, Send, Trash2, type LucideIcon } from "lucide-react";
import { Group, Scope } from "@/components/settings-me/parts";
import { useSavePatch, usePersonPrefs } from "@/components/settings-me/use-person-prefs";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { NO_SOUND, SOUND_EVENTS, SOUND_KEYS, SOUND_MAX_BYTES, customChoice, customIdOf, isTypeSoundEvent, type SoundChoices, type SoundEvent } from "@/lib/sound-library/choice";
import { builtinsFor } from "@/lib/sound-library/catalog";
import { cleanSoundChoices, saveSoundMirror, withSoundChoice } from "@/lib/sound-library/device";
import { previewSound } from "@/lib/sound-library/preview";
import { soundsSubHref } from "@/lib/sound-library/hrefs";
import type { MySoundDto } from "@/server/services/sounds";

/**
 * «الأصوات» — the sounds library (a phone with Telegram's look). The first page lists the five events with what each sounds like; one event's page is a radio
 * list: «بلا صوت», «افتراضي» (what it sounds like today), our own synthesized sounds, and the person's uploads with «إضافة صوت». A tap chooses, saves and
 * plays at once. The choice is the account's (`User.chatPrefs.sounds`); this device keeps a copy so a call can ring without asking.
 */
export const MY_SOUNDS_KEY = ["me", "sounds"] as const;

const EVENT_ICONS: Record<(typeof SOUND_EVENTS)[number], LucideIcon> = { sent: Send, received: MessageCircle, inChat: Bell, ringback: PhoneOutgoing, ring: Phone };

/** «افتراضي» of a kind of notification is the app's own sound; of an event it is what the app always played. */
const defaultName = (t: (key: string) => string, event: SoundEvent): string => t(isTypeSoundEvent(event) ? "typesounds.follow" : "tgsheets.sounds.default");

async function readMySounds(signal: AbortSignal): Promise<MySoundDto[]> {
  const res = await fetch("/api/me/sounds", { cache: "no-store", credentials: "same-origin", signal });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { sounds: MySoundDto[] }).sounds;
}

export function useMySounds() {
  return useQuery({ queryKey: MY_SOUNDS_KEY, queryFn: ({ signal }) => readMySounds(signal), staleTime: 60_000, retry: false, refetchOnWindowFocus: false });
}

/** The name of what an event is set to, for a row: «افتراضي», «بلا صوت», one of ours, or the upload's own name. */
export function soundChoiceName(t: (key: string) => string, event: SoundEvent, choice: string | undefined, mine: readonly MySoundDto[]): string {
  if (!choice) return defaultName(t, event);
  if (choice === NO_SOUND) return t("tgsheets.sounds.none");
  const fileId = customIdOf(choice);
  if (fileId) return mine.find((s) => s.id === fileId)?.name ?? t("tgsheets.sounds.custom");
  const built = builtinsFor(event).find((s) => s.id === choice);
  return built ? t(built.labelKey) : defaultName(t, event);
}

export function SoundsSection({ event = null, canUpload = true }: { event?: SoundEvent | null; /** an external partner uploads nothing (the route refuses too) */ canUpload?: boolean }) {
  const person = usePersonPrefs();
  const mine = useMySounds();
  const choices = cleanSoundChoices(person.prefs.sounds);
  return (
    <div data-section-body="sounds">
      {event ? <SoundPicker event={event} choices={choices} loaded={person.loaded} mine={mine.data ?? []} failed={mine.isError} canUpload={canUpload} /> : <SoundEventList choices={choices} mine={mine.data ?? []} />}
      <div className="px-4 pb-2 md:px-1">
        <Scope />
      </div>
    </div>
  );
}

function SoundEventList({ choices, mine }: { choices: SoundChoices; mine: readonly MySoundDto[] }) {
  const { t } = useI18n();
  const groups: { title: string; events: (typeof SOUND_EVENTS)[number][] }[] = [
    { title: t("tgsheets.sounds.group.messages"), events: SOUND_EVENTS.filter((e) => e === "sent" || e === "received" || e === "inChat") },
    { title: t("tgsheets.sounds.group.calls"), events: SOUND_EVENTS.filter((e) => e === "ringback" || e === "ring") },
  ];
  return (
    <>
      {groups.map((group) => (
        <Group key={group.title} title={group.title} rows>
          {group.events.map((event) => {
            const Icon = EVENT_ICONS[event];
            return (
              <Link key={event} href={soundsSubHref(event)} data-sound-event={event} className="flex min-h-14 items-center gap-3 px-3.5 py-2 hover:bg-surface-2">
                <Icon aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-fg">{t(`tgsheets.sounds.event.${event}`)}</span>
                  <span className="block truncate text-[13px] text-accent">{soundChoiceName(t, event, choices[event], mine)}</span>
                </span>
                <ChevronLeft aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
              </Link>
            );
          })}
        </Group>
      ))}
    </>
  );
}

function Radio({ id, label, checked, disabled, onSelect, children }: { id: string; label: string; checked: boolean; disabled: boolean; onSelect: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 pe-1.5">
      <button type="button" role="radio" aria-checked={checked} data-sound-option={id} disabled={disabled} onClick={onSelect} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3.5 text-start text-[15px] text-fg hover:bg-surface-2 disabled:opacity-60">
        <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", checked ? "border-accent" : "border-fg-muted/50")}>
          <span className={cn("tg-radio-dot size-2.5 rounded-full bg-accent", checked ? "scale-100" : "scale-0")} />
        </span>
        <bdi className="min-w-0 flex-1 truncate">{label}</bdi>
      </button>
      {children}
    </div>
  );
}

function SoundPicker({ event, choices, loaded, mine, failed, canUpload }: { event: SoundEvent; choices: SoundChoices; loaded: boolean; mine: readonly MySoundDto[]; failed: boolean; canUpload: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const save = useSavePatch();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  const current = choices[event];

  function hear(choice: string | null) {
    stopRef.current?.();
    stopRef.current = previewSound(event, choice);
  }

  async function keep(next: (before: SoundChoices) => SoundChoices) {
    const ok = await save((prefs) => {
      const sounds = next(cleanSoundChoices(prefs.sounds));
      saveSoundMirror(sounds);
      return { sounds: Object.keys(sounds).length === 0 ? null : sounds };
    });
    if (!ok) toast(t("settingsMe.failed"), "error");
  }

  function choose(choice: string | null) {
    hear(choice);
    void keep((before) => withSoundChoice(before, event, choice));
  }

  async function upload(file: File) {
    if (file.size > SOUND_MAX_BYTES) {
      toast(t("sound.too_large"), "error");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/me/sounds", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await res.json().catch(() => null)) as (MySoundDto & { message?: string }) | null;
      if (!res.ok || !body?.id) {
        toast(t(body?.message?.startsWith("sound.") ? body.message : "tgsheets.sounds.upload_failed"), "error");
        return;
      }
      await qc.invalidateQueries({ queryKey: MY_SOUNDS_KEY });
      choose(customChoice(body.id));
    } catch {
      toast(t("tgsheets.sounds.upload_failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(sound: MySoundDto) {
    stopRef.current?.();
    setRemoving(null);
    const res = await fetch(sound.url, { method: "DELETE", credentials: "same-origin" }).catch(() => null);
    if (!res?.ok) {
      toast(t("settingsMe.failed"), "error");
      return;
    }
    await qc.invalidateQueries({ queryKey: MY_SOUNDS_KEY });
    // every event that used it goes back to «افتراضي»
    if (SOUND_KEYS.some((e) => choices[e] === customChoice(sound.id))) {
      await keep((before) => SOUND_KEYS.reduce<SoundChoices>((all, e) => (all[e] === customChoice(sound.id) ? withSoundChoice(all, e, null) : all), before));
    }
  }

  return (
    <>
      <Group title={t("tgsheets.sounds.mine")} rows>
        {canUpload ? (
          <div>
            <button type="button" data-sound-add="" disabled={busy} onClick={() => input.current?.click()} className="flex min-h-12 w-full items-center gap-3 px-3.5 text-start text-[15px] font-medium text-accent hover:bg-surface-2 disabled:opacity-60">
              <CirclePlus aria-hidden="true" className="size-5 shrink-0" />
              {busy ? t("tgsheets.sounds.uploading") : t("tgsheets.sounds.add")}
            </button>
            <input
              ref={input}
              type="file"
              accept="audio/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void upload(file);
              }}
            />
          </div>
        ) : null}
        {mine.map((sound) => (
          <Radio key={sound.id} id={customChoice(sound.id)} label={sound.name} checked={current === customChoice(sound.id)} disabled={!loaded} onSelect={() => choose(customChoice(sound.id))}>
            {removing === sound.id ? (
              <button type="button" data-sound-remove-confirm={sound.id} onClick={() => void remove(sound)} className="min-h-11 shrink-0 rounded-full bg-danger px-3 text-[13px] font-semibold text-danger-fg">
                {t("tgsheets.sounds.remove_confirm")}
              </button>
            ) : (
              <button type="button" data-sound-remove={sound.id} aria-label={t("tgsheets.sounds.remove", { name: sound.name })} onClick={() => setRemoving(sound.id)} className="grid size-11 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-danger">
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            )}
          </Radio>
        ))}
        {failed ? (
          <p role="alert" className="px-3.5 py-3 text-[13px] text-fg-muted">
            {t("tgsheets.sounds.load_failed")}
          </p>
        ) : null}
      </Group>
      <Group title={t("tgsheets.sounds.ours")} hint={event === "inChat" ? t("tgsheets.sounds.inchat_hint") : undefined} rows>
        <div role="radiogroup" aria-label={t(`tgsheets.sounds.event.${event}`)} className="[&>*+*]:border-t [&>*+*]:border-border">
          <Radio id={NO_SOUND} label={t("tgsheets.sounds.none")} checked={current === NO_SOUND} disabled={!loaded} onSelect={() => choose(NO_SOUND)} />
          <Radio id="default" label={defaultName(t, event)} checked={!current} disabled={!loaded} onSelect={() => choose(null)} />
          {builtinsFor(event).map((sound) => (
            <Radio key={sound.id} id={sound.id} label={t(sound.labelKey)} checked={current === sound.id} disabled={!loaded} onSelect={() => choose(sound.id)} />
          ))}
        </div>
      </Group>
      {canUpload ? <p className="px-4 pt-2 text-xs text-fg-muted md:px-1">{t("tgsheets.sounds.limits")}</p> : null}
    </>
  );
}
