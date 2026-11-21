"use client";

import React, { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import type { ConversationHeaderDto } from "@/server/chat/dto";
import { useChatSoundsActive } from "@/lib/chat/chime/use-active";
import { loadChatSoundPrefs, saveChatSoundPrefs, topicModeOf, withTopicMode, type TopicSoundMode } from "@/lib/chat/chime/prefs";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";

const MODES: readonly TopicSoundMode[] = ["all", "mentions"];

/**
 * S5.1 — «صوت هالموضوع» in the info panel of a TOPIC (or a legacy group): «كل الرسائل» (every message makes the tone) or «الذكر بس» (only a message that names me). It is the person's own choice
 * on THIS device (`zk-chat-sound`, `topics`): a conversation member has no notify-level field on the server, so nothing is sent anywhere. Drawn only while the company's switch `chatSounds` is
 * on (the listener says so: `useChatSoundsActive`), and not for a private chat (every private message sounds), «الرسائل المحفوظة» or a reader in silent oversight.
 */
export function TopicSoundRow({ header, saved }: { header: ConversationHeaderDto; saved: boolean }) {
  const active = useChatSoundsActive();
  const [mode, setMode] = useState<TopicSoundMode>("all");
  useEffect(() => setMode(topicModeOf(loadChatSoundPrefs(), header.id)), [header.id]);
  if (!active || saved || header.kind === "DM" || header.me.oversight === true) return null;

  const choose = (next: TopicSoundMode) => {
    setMode(next);
    saveChatSoundPrefs(withTopicMode(loadChatSoundPrefs(), header.id, next));
  };

  return (
    <section data-info-sound={mode} className="mt-2 bg-surface-1 px-4 py-3">
      <p className="flex items-center gap-3 text-sm">
        <Volume2 aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
        {ct("chatsound.mode.title")}
      </p>
      <p className="mt-1 text-xs text-fg-muted">{ct("chatsound.mode.hint")}</p>
      <div role="radiogroup" aria-label={ct("chatsound.mode.title")} className="mt-2 flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            data-info-sound-mode={m}
            onClick={() => choose(m)}
            className={cn(
              "inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              mode === m ? "border-accent bg-accent/10 font-semibold text-fg" : "border-border hover:bg-surface-2",
            )}
          >
            {ct(`chatsound.mode.${m}`)}
          </button>
        ))}
      </div>
    </section>
  );
}
