import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(globalThis as { React?: typeof React }).React = React;

import { I18nProvider } from "@/lib/i18n";
import { VoicePlayer } from "@/components/chat/message/voice-player";
import { BubbleMedia } from "@/components/chat/v2/bubble/bubble-media";
import { classTokens } from "./ui-render";

/**
 * The person's OWN voice note looked empty on the phone: their bubble is the accent colour (`--bubble-out` equals `--accent` on most themes), and the player drew its
 * button and bars in the accent colour too, so nothing showed but the bubble. In the person's own bubble the player takes the bubble's text colour (`bubble-out-fg`).
 */
const peaks = [20, 60, 90, 40, 70, 30, 55, 80];
const player = (mine: boolean) =>
  renderToStaticMarkup(React.createElement(I18nProvider, { locale: "ar", children: React.createElement(VoicePlayer, { src: "/api/chat/attachments/a1", peaks, durationMs: 8000, mine }) } as never));

describe("the voice player in the person's own bubble", () => {
  it("draws the button, the bars and the time in the bubble's text colour, never in the accent the bubble is made of", () => {
    const tokens = classTokens(player(true));
    expect(tokens).toContain("bg-bubble-out-fg");
    expect(tokens).toContain("text-bubble-out");
    expect(tokens.filter((t) => /^(bg|text)-accent/.test(t)), "accent on an accent bubble").toEqual([]);
    expect(tokens).not.toContain("text-fg-muted");
  });

  it("in somebody else's bubble it is as it was (accent on the incoming bubble)", () => {
    const tokens = classTokens(player(false));
    expect(tokens).toContain("bg-accent");
    expect(tokens).not.toContain("bg-bubble-out-fg");
  });

  it("every theme where the outgoing bubble IS the accent colour is the reason (the contrast the rule exists for)", () => {
    const css = readFileSync(join(__dirname, "..", "src", "app", "themes.css"), "utf8");
    const same = [...css.matchAll(/--accent:\s*([\d ]+);[\s\S]*?--bubble-out:\s*([\d ]+);/g)].filter((m) => m[1]!.trim() === m[2]!.trim());
    expect(same.length).toBeGreaterThan(2);
  });

  it("BubbleMedia passes `mine` to the player (a voice note of mine)", () => {
    const attachments = [{ id: "a1", name: "voice.webm", url: "/api/chat/attachments/a1", mime: "audio/webm", kind: "AUDIO" as const, size: 100, peaks, durationMs: 8000 }];
    const html = renderToStaticMarkup(
      React.createElement(I18nProvider, { locale: "ar", children: React.createElement(BubbleMedia, { attachments, kind: "VOICE", canTranscribe: false, canReadImages: false, mine: true }) } as never),
    );
    expect(classTokens(html)).toContain("bg-bubble-out-fg");
  });
});
