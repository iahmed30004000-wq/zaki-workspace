import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(globalThis as { React?: typeof React }).React = React;

import { I18nProvider } from "@/lib/i18n";
import { VoicePlayer } from "@/components/chat/message/voice-player";
import { BubbleMedia } from "@/components/chat/v2/bubble/bubble-media";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import type { ConversationHeaderDto } from "@/server/chat/dto";

/** «الصوت زي تيليجرام» (the switch `voiceTelegram`, on by default): the speed button on EVERY voice note, and the bar under the header while one plays. Off: as it was. */
const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8");
const draw = (el: React.ReactElement) => renderToStaticMarkup(React.createElement(I18nProvider, { locale: "ar", children: el } as never));
const attachments = [{ id: "a1", name: "voice.webm", url: "/api/chat/attachments/a1", mime: "audio/webm", kind: "AUDIO" as const, size: 100, peaks: [20, 60, 90], durationMs: 8000 }];

describe("the speed button on every note", () => {
  it("an idle note at 1× shows the button when the switch is on, and does not when it is off (exactly as before)", () => {
    expect(draw(React.createElement(VoicePlayer, { src: "/api/chat/attachments/a1", peaks: [30, 60], durationMs: 5000, speedAlways: true }))).toContain('data-voice-speed="1"');
    expect(draw(React.createElement(VoicePlayer, { src: "/api/chat/attachments/a1", peaks: [30, 60], durationMs: 5000 }))).not.toContain("data-voice-speed");
  });

  it("the bubble passes the switch down: on by default, off when the header says so", () => {
    const on = draw(React.createElement(BubbleMedia, { attachments, kind: "VOICE", canTranscribe: false, canReadImages: false }));
    expect(on).toContain("data-voice-speed");
    const off = draw(React.createElement(BubbleMedia, { attachments, kind: "VOICE", canTranscribe: false, canReadImages: false, voiceTg: false }));
    expect(off).not.toContain("data-voice-speed");
  });

  it("the facts of a conversation carry the switch (absent: on, `false`: off)", () => {
    const header = (extra: Record<string, unknown>) =>
      ({ id: "c", kind: "TOPIC", me: { id: "u", canPost: true, canModerate: false, oversight: false }, ...extra }) as unknown as ConversationHeaderDto;
    expect(bubbleFactsOf(header({})).voiceTg).toBe(true);
    expect(bubbleFactsOf(header({ voiceTelegram: true })).voiceTg).toBe(true);
    expect(bubbleFactsOf(header({ voiceTelegram: false })).voiceTg).toBe(false);
  });
});

describe("the bar under the header", () => {
  it("stays while a note plays (even when its bubble is on screen) with the switch on; with it off it keeps the old rule (only when the bubble is out of sight)", () => {
    const bar = SRC("components/chat/v2/pane/voice-mini-player.tsx");
    expect(bar).toContain("always = false");
    expect(bar).toContain("if (!note || (snap.activeVisible && !always)) return null;");
    expect(SRC("components/chat/v2/pane/conversation-pane.tsx")).toContain("always={header.voiceTelegram !== false}");
  });

  it("the bar says who sent the note, its speed and has a stop (the title is «رسالة صوتية من فلان»)", () => {
    const bar = SRC("components/chat/v2/pane/voice-mini-player.tsx");
    expect(bar).toContain('ct("chatvoice.from", { name: note.authorName })');
    expect(bar).toContain("data-voice-mini-stop");
    expect(bar).toContain("voiceSpeedLabel(speed)");
  });
});
