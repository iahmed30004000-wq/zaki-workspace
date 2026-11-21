import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { PushBannerView } from "@/components/pwa/push-banner";
import { InstallHintView } from "@/components/pwa/install-hint";
import { I18nProvider } from "@/lib/i18n";
import {
  alreadyAsked,
  bannerDismissed,
  dismissBanner,
  markAsked,
  PUSH_ASKED_KEY,
  PUSH_BANNER_DISMISS_KEY,
  pushBannerMode,
  shouldAskOnFirstDm,
} from "@/lib/pwa/push-ask";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("when the chat asks for notifications", () => {
  it("the banner is for a person who was never asked (or let the question go), and for an iPhone that must add the site to its home screen first", () => {
    expect(pushBannerMode({ state: "default", dismissed: false })).toBe("ask");
    expect(pushBannerMode({ state: "ios_home", dismissed: false })).toBe("ios-home");
  });

  it("never after a refusal (only the browser's settings undo it), once allowed, where push does not exist, or after ✕", () => {
    for (const state of ["denied", "granted", "unsupported"] as const) expect(pushBannerMode({ state, dismissed: false }), state).toBe("hidden");
    expect(pushBannerMode({ state: "default", dismissed: true })).toBe("hidden");
    expect(pushBannerMode({ state: "ios_home", dismissed: true })).toBe("hidden");
  });

  it("the browser's own question is asked by itself ONCE, on the first PRIVATE chat opened, inside the tap that opened it", () => {
    expect(shouldAskOnFirstDm({ state: "default", asked: false, kind: "DM", activated: true })).toBe(true);
    expect(shouldAskOnFirstDm({ state: "default", asked: true, kind: "DM", activated: true })).toBe(false);
    for (const kind of ["TOPIC", "GROUP", "SPACE", null, undefined]) expect(shouldAskOnFirstDm({ state: "default", asked: false, kind, activated: true }), String(kind)).toBe(false);
    for (const state of ["granted", "denied", "unsupported", "ios_home"] as const) expect(shouldAskOnFirstDm({ state, asked: false, kind: "DM", activated: true }), state).toBe(false);
  });

  it("with no tap (a page opened from a notification, a reload) nothing is asked and the one try is not used up: the banner stays", () => {
    expect(shouldAskOnFirstDm({ state: "default", asked: false, kind: "DM", activated: false })).toBe(false);
    const host = read("src/components/pwa/chat-pwa-host.tsx");
    expect(host).toContain("userActivation");
    // the flag is written only after the decision to ask
    expect(host.indexOf("shouldAskOnFirstDm(")).toBeLessThan(host.indexOf("markAsked(storage)"));
  });
});

describe("what is remembered on the device", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
  };

  it("✕ hides the banner for 30 days, then it may come back; a blocked storage never breaks the page", () => {
    const store = memory();
    const now = Date.now();
    expect(bannerDismissed(store, now)).toBe(false);
    expect(dismissBanner(store, now)).toBe(true);
    expect(store.data.has(PUSH_BANNER_DISMISS_KEY)).toBe(true);
    expect(bannerDismissed(store, now + 29 * 86_400_000)).toBe(true);
    expect(bannerDismissed(store, now + 31 * 86_400_000)).toBe(false);
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(bannerDismissed(blocked, now)).toBe(false);
    expect(dismissBanner(blocked, now)).toBe(false);
    expect(bannerDismissed(null, now)).toBe(false);
  });

  it("«asked» is remembered once and read back; the blocked storage answers «not asked» and «could not store»", () => {
    const store = memory();
    expect(alreadyAsked(store)).toBe(false);
    expect(markAsked(store)).toBe(true);
    expect(store.data.get(PUSH_ASKED_KEY)).toBe("1");
    expect(alreadyAsked(store)).toBe(true);
    expect(alreadyAsked(null)).toBe(false);
    expect(markAsked(null)).toBe(false);
  });
});

describe("the banner", () => {
  it("says the owner's words, has a button that asks (a tap) and a ✕", () => {
    const html = renderToStaticMarkup(React.createElement(PushBannerView, { mode: "ask", onEnable: () => undefined, onDismiss: () => undefined }));
    expect(html).toContain("فعّل الإشعارات لتوصلك الرسائل والجهاز مسكّر");
    expect(html).toContain("فعّل الإشعارات</button>");
    expect(html).toContain('data-push-banner="ask"');
    expect(html).toContain('aria-label="إخفاء هذا الاقتراح"');
  });

  it("on an iPhone before «الشاشة الرئيسية» it explains instead of offering a button that could not work", () => {
    const html = renderToStaticMarkup(React.createElement(PushBannerView, { mode: "ios-home", onEnable: () => undefined, onDismiss: () => undefined }));
    expect(html).toContain("الرئيسية");
    expect(html).toContain("16.4");
    expect(html).not.toContain("<button type=\"button\" class=\"inline-flex");
    expect(html).not.toContain("فعّل الإشعارات</button>");
  });
});

describe("the install hint on an iPhone says push needs the home-screen app", () => {
  const Translations = I18nProvider as unknown as React.FunctionComponent<{ initial: "ar"; children?: React.ReactNode }>;
  it("the Safari steps carry the note (iOS 16.4 and later); the Android prompt mode does not", () => {
    const safari = renderToStaticMarkup(React.createElement(Translations, { initial: "ar" }, React.createElement(InstallHintView, { mode: "ios-safari", onDismiss: () => undefined })));
    expect(safari).toContain("الإشعارات على الآيفون بتشتغل بس بعد");
    expect(safari).toContain("16.4");
    const prompt = renderToStaticMarkup(React.createElement(Translations, { initial: "ar" }, React.createElement(InstallHintView, { mode: "prompt", onInstall: () => undefined, onDismiss: () => undefined })));
    expect(prompt).not.toContain("الإشعارات على الآيفون");
  });
});

describe("where the pieces are mounted", () => {
  it("the chat list mounts the host once; the host registers the worker, asks on the first private chat and closes a conversation's notification", () => {
    expect(read("src/components/chat/v2/list/chat-list-column.tsx")).toContain("<ChatPwaHost guest={guest} />");
    const host = read("src/components/pwa/chat-pwa-host.tsx");
    expect(host).toContain("registerServiceWorker()");
    expect(host).toContain("shouldAskOnFirstDm(");
    expect(host).toContain("closeChatNotifications(openId)");
    // a guest has no private chats to start
    expect(host).toContain("guest ? null : <NewMessageIntent />");
  });

  it("the worker is also registered from the shell's install button, which every signed-in person has", () => {
    expect(read("src/components/pwa/install-hint.tsx")).toContain("registerServiceWorker()");
  });

  it("the worker is registered at /sw.js with NO query (push-client.ts registers the same address: two addresses would replace each other's worker)", () => {
    expect(read("src/lib/pwa/register.ts")).toContain('register("/sw.js")');
    expect(read("src/components/calls/push-client.ts")).toContain('register("/sw.js")');
  });
});
