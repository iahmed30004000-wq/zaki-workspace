"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Group } from "@/components/settings-me/parts";
import { useI18n } from "@/lib/i18n";
import { CHAT_TONES, type ChatToneId } from "@/lib/chat/chime/tones";
import { DEFAULT_CHAT_SOUND_PREFS, loadChatSoundPrefs, saveChatSoundPrefs, type ChatSoundPrefs } from "@/lib/chat/chime/prefs";
import { previewChime } from "@/lib/chat/chime/player";

/**
 * S5.1 — «نغمة الرسائل» in «الإعدادات ← الإشعارات»: which of the five tones a chat message makes, how loud, and «جرّب الصوت» (plays the chosen tone at the chosen volume). Kept on THIS
 * device (`zk-chat-sound`, `src/lib/chat/chime/prefs.ts`). It needs no company switch: the page is the person's own; the tone is heard in the chats once the company turns `chatSounds` on
 * (the arrival sound of the open conversation uses it from then, and so does every other chat). The master switch «أصوات الدردشة» is the row above it.
 */
export function ChatSoundBlock() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<ChatSoundPrefs>(DEFAULT_CHAT_SOUND_PREFS);
  useEffect(() => setPrefs(loadChatSoundPrefs()), []);

  const keep = (next: ChatSoundPrefs) => {
    setPrefs(next);
    saveChatSoundPrefs(next);
  };
  const choose = (tone: ChatToneId) => {
    keep({ ...prefs, tone });
    void previewChime({ tone, volume: prefs.volume });
  };
  const percent = Math.round(prefs.volume * 100);

  return (
    <Group title={t("settingsMe.cs.title")} hint={t("settingsMe.cs.hint")} id="n-chat-tone">
      <div role="radiogroup" aria-label={t("settingsMe.cs.tones")} className="flex flex-col gap-2">
        {CHAT_TONES.map((tone) => (
          <button
            key={tone.id}
            type="button"
            role="radio"
            aria-checked={prefs.tone === tone.id}
            data-chat-tone={tone.id}
            onClick={() => choose(tone.id)}
            className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-start text-sm ${prefs.tone === tone.id ? "border-accent bg-accent/10 font-semibold text-fg" : "border-border text-fg hover:bg-surface-2"}`}
          >
            <span aria-hidden="true" className={`size-4 shrink-0 rounded-full border-2 ${prefs.tone === tone.id ? "border-accent bg-accent" : "border-border"}`} />
            {t(tone.labelKey)}
          </button>
        ))}
      </div>

      <label className="mt-4 block">
        <span className="flex items-center justify-between text-sm text-fg">
          {t("settingsMe.cs.volume")}
          <span className="text-fg-muted" data-chat-volume-value="">
            {t("settingsMe.cs.volume.value", { percent })}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          data-chat-volume=""
          onPointerUp={() => void previewChime({ tone: prefs.tone, volume: prefs.volume })}
          onChange={(e) => keep({ ...prefs, volume: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
          className="mt-2 h-11 w-full accent-accent"
        />
      </label>

      <Button type="button" variant="secondary" className="mt-3" data-chat-sound-try="" onClick={() => void previewChime({ tone: prefs.tone, volume: prefs.volume })}>
        {t("settingsMe.cs.try")}
      </Button>
    </Group>
  );
}
