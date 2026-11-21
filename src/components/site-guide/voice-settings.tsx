"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_VOICE_PREFS, RATE_RANGE, VOLUME_RANGE, type VoicePrefs } from "@/lib/site-guide/voice-text";
import { getVoicePrefs, setVoicePrefs, speak, unlockAudio } from "@/components/site-guide/voice";

/**
 * The small panel inside the guide's window (and so inside «اتصل بالمساعد», which runs through the guide): how fast and how loud the assistant
 * speaks. The two values live on THIS device (localStorage), are never sent anywhere, and apply to the next piece it says.
 */
export function VoiceSettings() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<VoicePrefs>(DEFAULT_VOICE_PREFS);

  useEffect(() => {
    setPrefs(getVoicePrefs());
  }, []);

  const change = (next: Partial<VoicePrefs>) => setPrefs(setVoicePrefs(next));

  return (
    <div className="space-y-2 border-b border-border px-3 py-2 text-sm">
      <label className="block">
        <span className="flex items-center justify-between">
          <span>{t("voiceStack.rate")}</span>
          <span className="text-xs text-fg-muted">{prefs.rate.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={RATE_RANGE.min}
          max={RATE_RANGE.max}
          step={RATE_RANGE.step}
          value={prefs.rate}
          onChange={(e) => change({ rate: Number(e.target.value) })}
          className="mt-1 h-6 w-full"
        />
        <span className="flex justify-between text-xs text-fg-muted">
          <span>{t("voiceStack.slow")}</span>
          <span>{t("voiceStack.fast")}</span>
        </span>
      </label>
      <label className="block">
        <span className="flex items-center justify-between">
          <span>{t("voiceStack.volume")}</span>
          <span className="text-xs text-fg-muted">{Math.round(prefs.volume * 100)}%</span>
        </span>
        <input
          type="range"
          min={VOLUME_RANGE.min}
          max={VOLUME_RANGE.max}
          step={VOLUME_RANGE.step}
          value={prefs.volume}
          onChange={(e) => change({ volume: Number(e.target.value) })}
          className="mt-1 h-6 w-full"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            void speak(t("voiceStack.test_text"));
          }}
          className="min-h-9 rounded-lg border border-border px-3 py-1 text-sm hover:bg-surface-2"
        >
          {t("voiceStack.test")}
        </button>
        <p className="min-w-0 flex-1 text-xs text-fg-muted">{t("voiceStack.device_only")}</p>
      </div>
    </div>
  );
}
