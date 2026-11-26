"use client";

import { Check } from "lucide-react";
import { SwitchRow } from "@/components/members/switch-row";
import { Group, Scope, WarnFix } from "@/components/settings-me/parts";
import { usePersonPrefs, useSavePatch } from "@/components/settings-me/use-person-prefs";
import { useOptionalToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { SPEECH_AUTO, SPEECH_LANGS, resolveSpeech, type SpeechPrefs } from "@/lib/chat/speech-langs";

/**
 * «تحويل الكلام لنص» (`tgPhone`) — the person's own choices, saved on the account (`User.chatPrefs.speech`): the language (Arabic first and the default),
 * the live words while recording, and whether a recording's words are written by themselves before it is sent. It says plainly where the sound goes. The
 * same body is the settings page and the sheet the recording bar's gear opens (so opening it never throws a recording away).
 */
export function SpeechSection({ serviceReady, liveAllowed }: { /** the company's transcription service is set up and its switch is on */ serviceReady: boolean; /** the company's switch `voiceLiveText` */ liveAllowed: boolean }) {
  const { t } = useI18n();
  const { prefs } = usePersonPrefs();
  const save = useSavePatch();
  const toast = useOptionalToast();
  const speech = resolveSpeech(prefs.speech);
  const set = (patch: Partial<SpeechPrefs>) =>
    void save((current) => ({ speech: { ...(current.speech ?? {}), ...patch } })).then((ok) => {
      if (!ok) toast?.toast(t("tgvoice.set.save_failed"), "error");
    });
  const choices = [...SPEECH_LANGS.map((l) => ({ code: l.code as string, label: t(l.labelKey) })), { code: SPEECH_AUTO, label: t("tgvoice.lang_auto") }];

  return (
    <div data-section-body="speech">
      <Group title={t("tgvoice.set.recording_title")} rows>
        <div data-speech-live className="px-0.5">
          <SwitchRow
            title={t("tgvoice.set.live_title")}
            hint={t("tgvoice.set.live_hint")}
            checked={liveAllowed && speech.live}
            disabled={!liveAllowed}
            note={liveAllowed ? undefined : t("tgvoice.set.live_company_off")}
            onChange={(live) => set({ live })}
          />
        </div>
        <div data-speech-preview className="px-0.5">
          <SwitchRow title={t("tgvoice.set.preview_title")} hint={t("tgvoice.set.preview_hint")} checked={speech.preview} onChange={(preview) => set({ preview })} />
        </div>
      </Group>
      {liveAllowed ? (
        <div className="px-3 pt-2 md:px-0">
          <WarnFix warn={t("tgvoice.set.live_warn")} fix={t("tgvoice.set.live_fix")} />
        </div>
      ) : null}
      <Group title={t("tgvoice.set.lang_title")} hint={t("tgvoice.set.lang_hint")} rows>
        <div role="radiogroup" aria-label={t("tgvoice.set.lang_title")} className="divide-y divide-border">
          {choices.map((choice) => {
            const on = speech.language === choice.code;
            return (
              <button
                key={choice.code}
                type="button"
                role="radio"
                aria-checked={on}
                data-speech-lang={choice.code}
                onClick={() => set({ language: choice.code })}
                className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-start text-[15px] text-fg hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">{choice.label}</span>
                <Check aria-hidden="true" className={on ? "size-5 shrink-0 text-accent" : "invisible size-5 shrink-0"} />
              </button>
            );
          })}
        </div>
      </Group>
      <Group title={t("tgvoice.set.service_title")}>
        <p data-speech-service={serviceReady ? "ready" : "off"} className="text-sm text-fg">
          {t(serviceReady ? "tgvoice.set.service_on" : "tgvoice.set.service_off")}
        </p>
      </Group>
      <div className="px-4 md:px-1">
        <Scope />
      </div>
    </div>
  );
}
