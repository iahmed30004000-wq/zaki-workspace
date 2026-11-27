import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/me/sounds",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { SoundsSection, MY_SOUNDS_KEY, soundChoiceName } from "@/components/settings-me/sounds-section";
import { NotificationsSection } from "@/components/settings-me/notifications-section";
import { NotifyTypePage, notifySummary, isExceptionOf } from "@/components/settings-me/notify-types";
import { SectionHead } from "@/components/settings-me/parts";
import { TgPhoneProvider } from "@/components/shell/tg-phone";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { CHAT_PREFS_KEY } from "@/lib/chat/cache/queries";
import { builtinsFor } from "@/lib/sound-library/catalog";
import { SOUND_EVENTS } from "@/lib/sound-library/choice";
import { notifyKindOf, soundKindOf, soundsSubHref, notifySubHref } from "@/lib/sound-library/hrefs";
import { soundDisplayName } from "@/server/services/sounds";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Tg = TgPhoneProvider as unknown as FunctionComponent<{ on: boolean; children?: ReactNode }>;

function seeded(prefs: Record<string, unknown> = {}, sounds: { id: string; name: string; size: number; url: string }[] = []): QueryClient {
  const client = new QueryClient();
  client.setQueryData(CHAT_PREFS_KEY, { prefs });
  client.setQueryData(MY_SOUNDS_KEY, sounds);
  return client;
}
function render(element: ReactElement, opts: { tg?: boolean; client?: QueryClient } = {}): string {
  const inner = createElement(Toasts, null, element);
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: opts.client ?? seeded() }, createElement(Tg, { on: opts.tg === true }, inner))));
}
const t = (key: string, vars?: Record<string, string | number>) => interpolate((AR as Record<string, string>)[key] ?? key, vars);
const mine = [{ id: "f1", name: "رنتي", size: 100, url: "/api/me/sounds/f1" }];

describe("the sounds library's pages", () => {
  it("the first page lists the five events with what each is set to", () => {
    const html = render(createElement(SoundsSection), { client: seeded({ sounds: { ring: "ring-wave", sent: "none", received: "custom:f1" } }, mine) });
    for (const event of SOUND_EVENTS) {
      expect(html).toContain(`data-sound-event="${event}"`);
      expect(html).toContain(`href="${soundsSubHref(event)}"`);
    }
    for (const word of [AR["tgsheets.sound.ring-wave"]!, "بلا صوت", "رنتي", "افتراضي"]) expect(html).toContain(word);
  });

  it("one event's page: «إضافة صوت», my uploads, «بلا صوت», «افتراضي» and our sounds as radios, the chosen one checked", () => {
    const html = render(createElement(SoundsSection, { event: "ring" }), { client: seeded({ sounds: { ring: "custom:f1" } }, mine) });
    expect(html).toContain("إضافة صوت");
    expect(html).toContain('accept="audio/*"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('data-sound-option="none"');
    expect(html).toContain('data-sound-option="default"');
    for (const sound of builtinsFor("ring")) expect(html).toContain(`data-sound-option="${sound.id}"`);
    expect(html).not.toContain('data-sound-option="tick"');
    expect(html).toMatch(/aria-checked="true" data-sound-option="custom:f1"/);
    expect(html).toContain('data-sound-remove="f1"');
  });

  it("an external partner is offered no upload", () => {
    const html = render(createElement(SoundsSection, { event: "sent", canUpload: false }));
    expect(html).not.toContain("data-sound-add");
    expect(html).not.toContain('type="file"');
  });

  it("names: default, none, an upload that is gone, a built-in of another family", () => {
    expect(soundChoiceName(t, "sent", undefined, [])).toBe("افتراضي");
    expect(soundChoiceName(t, "sent", "none", [])).toBe("بلا صوت");
    expect(soundChoiceName(t, "sent", "custom:zzz", [])).toBe(AR["tgsheets.sounds.custom"]);
    expect(soundChoiceName(t, "sent", "ring-wave", [])).toBe("افتراضي");
  });

  it("the addresses of the sub-pages take only known values", () => {
    expect(soundKindOf("ring")).toBe("ring");
    expect(soundKindOf(["sent"])).toBe("sent");
    expect(soundKindOf("x")).toBeNull();
    expect(notifyKindOf("calls")).toBe("calls");
    expect(notifyKindOf("x")).toBeNull();
    expect(notifySubHref("private")).toBe("/settings/me/notifications?type=private");
  });

  it("an upload's name is its file's name without the ending", () => {
    expect(soundDisplayName("رنة الصبح.mp3")).toBe("رنة الصبح");
    expect(soundDisplayName("C:\\x\\a.b.m4a")).toBe("a.b");
    expect(soundDisplayName(".mp3")).toBe(".mp3");
  });

  it("the section is wired: the route's switch, the owner-only reads and the SOUND purpose", () => {
    const page = read("src/app/(app)/settings/me/[section]/page.tsx");
    expect(page).toContain('case "sounds"');
    expect(page).toContain("soundLibraryOn(actor)");
    const service = read("src/server/services/sounds.ts");
    // every read, count and delete is by the uploader
    expect(service).toContain("uploaderId: userId, purpose: SOUND_PURPOSE");
    expect(service).toContain('sniffChatMedia(input.bytes, "AUDIO"');
    expect(read("src/server/services/files.ts")).toContain('purpose !== "AVATAR" && purpose !== "SOUND"');
    expect(read("src/app/api/me/sounds/route.ts")).toContain("assertSoundLibraryOn");
    expect(read("src/app/api/me/sounds/[id]/route.ts")).toContain("parseByteRange");
  });
});

describe("«الإشعارات» on a phone", () => {
  it("the switch off: exactly the page of before (no card of kinds, nothing hidden by width)", () => {
    const html = render(createElement(NotificationsSection, { sub: "private" }));
    expect(html).not.toContain("data-notify-phone");
    expect(html).not.toContain("data-notify-page");
    expect(html).not.toContain("max-md:hidden");
  });

  it("the switch on: the card of five kinds for a phone, the old blocks for a computer", () => {
    const html = render(createElement(NotificationsSection), { tg: true });
    expect(html).toContain("data-notify-phone");
    for (const type of ["private", "topics", "mentions", "replies", "calls"]) expect(html).toContain(`data-notify-type="${type}"`);
    expect(html).toContain('href="/settings/me/notifications?type=private"');
    expect(html).toContain('href="/settings/me/sounds"');
    expect(html).toContain("max-md:hidden");
    // the older blocks of the page stay: the master switch, the tones, the ringtone
    expect(html).toContain('id="n-ringtone"');
  });

  it("one kind's page: about, preview, the sound and «خيارات أكثر»", () => {
    const html = render(createElement(NotificationsSection, { sub: "private" }), { tg: true });
    expect(html).toContain('data-notify-page="private"');
    expect(html).toContain("إظهار معاينة للرسالة");
    expect(html).toContain('data-notify-sound="inChat"');
    expect(html).toContain("خيارات أكثر");
    expect(html).not.toContain("data-notify-more-rows");
  });

  it("calls have no preview and ring with the incoming ring; the opened options hold the outgoing one and the reset", () => {
    const html = render(createElement(NotifyTypePage, { type: "calls", prefs: { notifications: { calls: { on: false } } }, loaded: true, onRule: () => {}, masterSounds: true, onMasterSounds: () => {}, moreOpen: true }), { tg: true });
    expect(html).not.toContain("إظهار معاينة للرسالة");
    expect(html).toContain('data-notify-sound="ring"');
    expect(html).toContain('data-notify-sound="ringback"');
    expect(html).toContain('data-notify-reset="calls"');
    expect(html).toContain("data-warn-fix");
  });

  it("the line under a kind: on or off, the preview, the exceptions in their Arabic number", () => {
    expect(notifySummary(t, "private", {}, 0)).toBe("مفعّلة");
    expect(notifySummary(t, "private", { preview: false }, 1)).toBe("مفعّلة، بدون معاينة، استثناء واحد");
    expect(notifySummary(t, "topics", { on: false }, 2)).toBe("مطفأة، استثناءان");
    expect(notifySummary(t, "topics", {}, 5)).toContain("5 استثناءات");
    expect(notifySummary(t, "topics", {}, 14)).toContain("14 استثناءً");
    expect(isExceptionOf("private", { kind: "DM" })).toBe(true);
    expect(isExceptionOf("topics", { kind: "DM" })).toBe(false);
    expect(isExceptionOf("topics", { kind: "TOPIC" })).toBe(true);
  });

  it("a section's head: with the switch on, a bar with a back button for the phone and the old head for a computer", () => {
    const off = render(createElement(SectionHead, { section: "sounds" }));
    expect(off).not.toContain("data-settings-phone-head");
    const on = render(createElement(SectionHead, { section: "sounds", sub: { titleKey: "tgsheets.sounds.event.ring", back: "/settings/me/sounds" } }), { tg: true });
    expect(on).toContain("data-settings-phone-head");
    expect(on).toContain('href="/settings/me/sounds"');
    expect(on).toContain(AR["tgsheets.sounds.event.ring"]!);
    expect(on).toContain("max-md:hidden");
  });

  it("a computer does not list «الأصوات», and the new motion obeys the effect and the device", () => {
    const css = read("src/components/settings-me/tg-settings.css");
    expect(css).toMatch(/min-width: 768px[\s\S]*data-section="sounds"[\s\S]*display: none/);
    expect(css).toContain('html[data-fx-off~="blur"] .tg-set-head');
    expect(css).toContain("prefers-reduced-motion: no-preference");
    expect(css).toContain('html:not([data-fx-off~="transitions"]) .tg-rows-in');
  });
});
