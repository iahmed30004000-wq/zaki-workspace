import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { DevicesSection, sessionLabelOf } from "@/components/settings-me/devices-section";
import AR from "@/lib/i18n/ar.settings-me.json";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

/**
 * C4.2 — «الجلسات المفتوحة» on the devices screen of «إعداداتي». The behaviour behind the buttons (a revoked session gets 401 at its next request, the others keep
 * working) is proved on the real routes in tests/db/user-sessions.test.ts; here: what the screen offers and says.
 */

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, element))));
}
const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");
const strings = AR as Record<string, string>;

describe("«الجلسات المفتوحة»", () => {
  it("the devices screen has the group, between the browsers and «اطلع من كل الأجهزة»", () => {
    const html = render(createElement(DevicesSection, { appConnection: true }));
    const at = (needle: string) => html.indexOf(needle);
    expect(html).toContain(strings["settingsMe.v.sessions"] as string);
    expect(html).toContain(strings["settingsMe.v.sessions.hint"] as string);
    expect(at('id="v-browsers"')).toBeLessThan(at('id="v-sessions"'));
    expect(at('id="v-sessions"')).toBeLessThan(at('id="v-everywhere"'));
  });

  it("each device can be ended alone (the route is the row's own id), and ending THIS one asks first and says it is a sign-out", () => {
    const src = read("src/components/settings-me/devices-section.tsx");
    expect(src).toContain("`/api/me/sessions/${encodeURIComponent(row.id)}`");
    expect(src).toContain('apiDelete(');
    expect(strings["settingsMe.v.sessions.end"]).toBe("اطلع من هالجهاز");
    expect(strings["settingsMe.v.sessions.confirm"]).toContain("تطلع منه");
    // ending the current one leaves like any sign-out: queues and cache of the person wiped
    expect(src).toMatch(/if \(row\.current\) \{\s*await leaveThisDevice\(\)/);
    expect(src).toMatch(/async function leaveThisDevice[\s\S]*clearAllOutboxes\(\)[\s\S]*wipeChatCache\(\)[\s\S]*clearMirror\(\)/);
    // «اطلع من كل الأجهزة» keeps its own button and route
    expect(src).toContain('apiPost("/api/me/logout-everywhere")');
  });

  it("a device is named from its user agent: the Android app by its HTTP client, a browser in Arabic, an unknown one honestly", () => {
    const words = { app: "تطبيق ذكي على أندرويد", unknown: "متصفح ما بنعرف اسمه", on: "على" };
    expect(sessionLabelOf("okhttp/4.12.0", words)).toBe(words.app);
    // the app names itself (android/.../NetworkModule.kt `userAgent`): «ZakiApp/<version> (Android <release>; <model>)»
    expect(sessionLabelOf("ZakiApp/5.2.0 (Android 15; Pixel 8)", words)).toBe(words.app);
    expect(sessionLabelOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", words)).toBe("كروم على ويندوز");
    expect(sessionLabelOf(null, words)).toBe(words.unknown);
    expect(sessionLabelOf("", words)).toBe(words.unknown);
  });

  it("the refusal has its Arabic sentence", () => {
    expect(strings["session.not_found"]).toBeTruthy();
  });
});
