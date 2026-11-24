import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(globalThis as { React?: typeof React }).React = React;

import { RecordBar, type LiveView } from "@/components/chat/v2/composer/record-bar";
import { AR } from "@/lib/i18n/dict";
import { FEATURES, FEATURE_DEFAULTS, FEATURE_META } from "@/lib/features";
import { textOf } from "./ui-render";

/** «نص مباشر أثناء التسجيل»: the live words above the recorder pill, the language picker and «ابعت كنص». Nothing of it exists unless the engine hands a `live`. */
const recording = { mode: "recording" as const, elapsedMs: 4000, peaks: [10, 40, 80], hold: false, locked: true };
const live = (over: Partial<LiveView> = {}): LiveView => ({ supported: true, listening: true, text: "مرحبا شباب كيفكم", lang: "ar-JO", error: null, setLang: () => undefined, sendAsText: () => undefined, ...over });
const bar = (l?: LiveView) => renderToStaticMarkup(React.createElement(RecordBar, { voice: recording, error: "", live: l, onCancel: () => undefined, onSend: () => undefined }));

describe("the recorder bar with live text", () => {
  it("draws the words, the language picker (Arabic first) and the send-as-text button", () => {
    const html = bar(live());
    expect(html).toContain("data-live-text");
    expect(html).toContain("data-live-lang");
    expect(html).toContain("data-live-send");
    expect(textOf(html)).toContain("مرحبا شباب كيفكم");
    expect(textOf(html)).toContain(AR["chatlive.send_text"]);
    expect(textOf(html)).toContain(AR["chatlive.listening"]);
    expect(html.indexOf(AR["chatlive.lang_ar_jo"]!)).toBeLessThan(html.indexOf(AR["chatlive.lang_en_us"]!));
    expect(html).toContain('value="ar-JO" selected');
  });

  it("with no words yet the button is disabled and a placeholder shows", () => {
    const html = bar(live({ text: "" }));
    expect(textOf(html)).toContain(AR["chatlive.placeholder"]);
    expect(html).toMatch(/data-live-send[^>]*disabled|disabled[^>]*data-live-send/);
  });

  it("a refused or busy recognition says so in one plain line and the recorder stays", () => {
    expect(textOf(bar(live({ listening: false, error: "denied" })))).toContain(AR["chatlive.err_denied"]);
    expect(textOf(bar(live({ listening: false, error: "busy" })))).toContain(AR["chatlive.err_busy"]);
    expect(textOf(bar(live({ listening: false, error: "failed" })))).toContain(AR["chatlive.err_failed"]);
    expect(bar(live({ error: "busy" }))).toContain('data-recording="recording"');
  });

  it("without `live` (the switch off) or in a browser with no recognition the bar is exactly the old one", () => {
    expect(bar(undefined)).not.toContain("data-live-text");
    expect(bar(live({ supported: false }))).not.toContain("data-live-text");
    expect(bar(undefined)).toContain('data-recording="recording"');
  });
});

describe("the two switches of the voice stage", () => {
  it("«الصوت زي تيليجرام» is ON by default, «نص مباشر» is OFF (the sound leaves the company); both are chat switches that need voice notes, with their words and the ⚠️ 🔧", () => {
    for (const key of ["voiceTelegram", "voiceLiveText"] as const) {
      expect(FEATURES).toContain(key);
      expect(FEATURE_META[key]).toEqual({ group: "chat", dependsOn: ["voiceNotes"] });
      expect(AR[`features.${key}.name`], key).toBeTruthy();
      expect(AR[`features.${key}.hint`], key).toContain("⚠️");
      expect(AR[`features.${key}.hint`], key).toContain("🔧");
    }
    expect(FEATURE_DEFAULTS.voiceTelegram).toBe(true);
    expect(FEATURE_DEFAULTS.voiceLiveText).toBe(false);
  });

  it("the composer builds the dictation only with the switch (header `voiceLiveText`), and the header answers it only while voice notes are on", () => {
    const composer = readFileSync(join(__dirname, "..", "src", "lib", "chat", "v2", "composer", "use-composer.ts"), "utf8");
    expect(composer).toMatch(/liveTextOn = detail\.voiceLiveText === true/);
    expect(composer).toMatch(/createDictation\(browserRecognition\(\)\)/);
    const topics = readFileSync(join(__dirname, "..", "src", "server", "chat", "topics.ts"), "utf8");
    expect((topics.match(/voiceLiveText:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
