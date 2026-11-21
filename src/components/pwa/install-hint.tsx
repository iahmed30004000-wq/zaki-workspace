"use client";

import * as React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Download, Share, Smartphone, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { registerServiceWorker } from "@/lib/pwa/register";
import {
  detectIos,
  installMode,
  isStandaloneDisplay,
  readDismissal,
  writeDismissal,
  type InstallMode,
  type IosKind,
} from "@/lib/pwa-install";

/**
 * "Install the app" hint. Put it where the person will see it once (the Today page, the account menu).
 *
 * - Already installed (`display-mode: standalone` / `navigator.standalone`): renders nothing.
 * - Android and desktop Chrome: when the browser offers its install prompt, a button «تثبيت التطبيق» calls it.
 * - iPhone Safari (no prompt exists): the two taps in Arabic, with a word on what each icon looks like.
 * - Any other iPhone browser: "open this in Safari first".
 * - ✕ remembers the dismissal in localStorage for 30 days (inside try/catch: storage may be blocked).
 *
 * It looks at the browser only after it has mounted, so the server and the first client render both
 * draw nothing (no hydration mismatch). The pure decisions are in src/lib/pwa-install.ts.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

// The browser offers the install prompt once, usually before the page has finished hydrating. Catch it
// when this module loads, keep it, and tell whoever is mounted.
let captured: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // keep the prompt for our own button instead of the browser's mini-bar
    captured = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    captured = null;
    notify();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const getCaptured = () => captured;
const getServerCaptured = () => null;

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

interface Environment {
  ready: boolean;
  standalone: boolean;
  dismissed: boolean;
  ios: IosKind | null;
}

export function InstallHint({ className }: { className?: string }): React.JSX.Element | null {
  const prompt = useSyncExternalStore(subscribe, getCaptured, getServerCaptured);
  const [env, setEnv] = useState<Environment>({ ready: false, standalone: false, dismissed: false, ios: null });

  useEffect(() => {
    setEnv({
      ready: true,
      standalone: isStandaloneDisplay({
        displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
        navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
      }),
      dismissed: readDismissal(safeStorage(), Date.now()),
      ios: detectIos({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }),
    });
  }, []);

  if (!env.ready) return null;
  const mode = installMode({ standalone: env.standalone, dismissed: env.dismissed, ios: env.ios, canPrompt: prompt !== null });
  if (mode === "hidden") return null;

  const dismiss = () => {
    writeDismissal(safeStorage(), Date.now());
    setEnv((current) => ({ ...current, dismissed: true }));
  };

  const install = async () => {
    const event = captured;
    if (!event) return;
    captured = null; // a browser prompt can be used once
    notify();
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "dismissed") dismiss();
    } catch {
      // the browser refused to show it: the hint is gone for this visit, nothing else to do
    }
  };

  return <InstallHintView mode={mode} onInstall={install} onDismiss={dismiss} className={className} />;
}

export interface InstallHintViewProps {
  mode: Exclude<InstallMode, "hidden">;
  /** The install button's action (mode `prompt` only). */
  onInstall?: () => void;
  onDismiss: () => void;
  className?: string;
}

/** What the hint looks like in each mode. No state, so it can be rendered (and tested) on the server. */
export function InstallHintView({ mode, onInstall, onDismiss, className }: InstallHintViewProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <section aria-label={t("pwa.region_label")} className={cn("flex items-start gap-3 rounded-xl border border-border bg-surface-1 p-3", className)}>
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Smartphone className="size-5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{t("pwa.install_title")}</p>

        {mode === "prompt" ? (
          <>
            <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t("pwa.install_text")}</p>
            <Button type="button" onClick={onInstall} className="mt-2 h-11 px-5">
              <Download className="size-4" aria-hidden="true" />
              {t("pwa.install_button")}
            </Button>
          </>
        ) : null}

        {mode === "ios-safari" ? (
          <>
            <p className="mt-0.5 text-sm leading-6 text-fg">{t("pwa.ios_steps")}</p>
            <ol className="mt-3 space-y-3">
              <Step icon={<Share className="size-5" aria-hidden="true" />} text={t("pwa.ios_step_share")} icon_text={t("pwa.ios_step_share_icon")} />
              <Step icon={<SquarePlus className="size-5" aria-hidden="true" />} text={t("pwa.ios_step_add")} icon_text={t("pwa.ios_step_add_icon")} />
              <Step icon={<Check className="size-5" aria-hidden="true" />} text={t("pwa.ios_step_confirm")} />
            </ol>
            {/* M1a: on an iPhone, web push works only for the app added to the home screen (iOS 16.4+) */}
            <p className="mt-3 text-xs leading-5 text-fg-muted">{t("mobile.pwa.ios_push_note")}</p>
          </>
        ) : null}

        {mode === "ios-other" ? <p className="mt-0.5 text-sm leading-6 text-fg">{t("pwa.ios_other")}</p> : null}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("pwa.dismiss_label")}
        className="-me-1 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </section>
  );
}

/** One numbered step of the iPhone instructions: the icon as the person will see it, the words, and what the icon looks like. */
function Step({ icon, text, icon_text }: { icon: React.ReactNode; text: string; icon_text?: string }): React.JSX.Element {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-accent">
        {icon}
      </span>
      <span className="min-w-0 text-xs leading-5 text-fg">
        {text}
        {icon_text ? <span className="ms-1 text-fg-muted">{icon_text}</span> : null}
      </span>
    </li>
  );
}

/**
 * «ثبّت التطبيق», always there in the side menu until the app is installed (the owner, 2026-10-26: «زر تثبيت التطبيق
 * وينو؟» — the Today hint can be dismissed and is gone). Where the browser offers its prompt (Android, Chrome and Edge on
 * a computer) one tap opens it; on an iPhone, and in a browser that offers none, it shows the steps.
 */
export function InstallAppButton({ collapsed = false }: { collapsed?: boolean }): React.JSX.Element | null {
  const { t } = useI18n();
  const prompt = useSyncExternalStore(subscribe, getCaptured, getServerCaptured);
  const [env, setEnv] = useState<{ ready: boolean; standalone: boolean; ios: IosKind | null }>({ ready: false, standalone: false, ios: null });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setEnv({
      ready: true,
      standalone: isStandaloneDisplay({
        displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
        navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
      }),
      ios: detectIos({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }),
    });
  }, []);

  // M1a: this button is in the menu of everybody who is signed in, so it is also where the service worker (offline page, cached shell, grouped notifications) is registered at sign-in
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  if (!env.ready || env.standalone) return null;

  const click = async () => {
    const event = prompt ?? captured;
    if (!event) return setOpen(true);
    captured = null; // a browser prompt can be used once
    notify();
    try {
      await event.prompt();
    } catch {
      setOpen(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void click()}
        title={collapsed ? t("pwa.install_button") : undefined}
        className={cn(
          "flex h-11 w-full items-center gap-2.5 rounded-xl text-sm font-semibold text-fg transition-colors hover:bg-surface-2",
          collapsed ? "justify-center px-0" : "px-3",
        )}
      >
        <Download aria-hidden="true" className="size-5 shrink-0 text-accent" />
        <span className={cn("truncate", collapsed && "sr-only")}>{t("pwa.install_button")}</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("pwa.install_title")}>
        {env.ios ? (
          <InstallHintView mode={env.ios === "safari" ? "ios-safari" : "ios-other"} onInstall={() => undefined} onDismiss={() => setOpen(false)} />
        ) : (
          <p className="text-sm leading-relaxed">{t("pwa.desktop_steps")}</p>
        )}
      </Modal>
    </>
  );
}
