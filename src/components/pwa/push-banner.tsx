"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensurePush, pushState, type PushState } from "@/components/calls/push-client";
import { ct } from "@/lib/chat/text";
import { cn } from "@/lib/utils";
import { bannerDismissed, dismissBanner, markAsked, pushBannerMode, type PushBannerMode } from "@/lib/pwa/push-ask";

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * M1a — «فعّل الإشعارات لتوصلك الرسائل والجهاز مسكّر»: the banner on the chat list for a person who was never asked (or let the browser's question go). The
 * button is a tap, which is what browsers require before they ask (`ensurePush(true)`); ✕ hides it for 30 days. It is drawn only where a question can still
 * be answered: not after a refusal (the browser's own settings turn that back on), not once allowed. On an iPhone that has not added the site to its home
 * screen it shows the note about that instead (web push there needs the home-screen app).
 *
 * It looks at the browser only after it has mounted, so the server and the first client render draw nothing.
 */
export function PushBanner({ className }: { className?: string }): React.JSX.Element | null {
  const [state, setState] = useState<PushState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setState(pushState());
    setDismissed(bannerDismissed(safeStorage(), Date.now()));
  }, []);

  // the browser's own question (asked by the first private chat, or from the bell) is answered outside this banner: follow the permission, so it goes when allowed
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let alive = true;
    navigator.permissions
      ?.query({ name: "notifications" as PermissionName })
      .then((found) => {
        if (!alive) return;
        status = found;
        found.onchange = () => setState(pushState());
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (status) status.onchange = null;
    };
  }, []);

  if (state === null) return null;
  const mode = pushBannerMode({ state, dismissed });
  if (mode === "hidden") return null;

  const enable = async () => {
    markAsked(safeStorage());
    await ensurePush(true);
    setState(pushState());
  };
  const dismiss = () => {
    dismissBanner(safeStorage(), Date.now());
    setDismissed(true);
  };
  return <PushBannerView mode={mode} onEnable={() => void enable()} onDismiss={dismiss} {...(className ? { className } : {})} />;
}

export interface PushBannerViewProps {
  mode: Exclude<PushBannerMode, "hidden">;
  onEnable: () => void;
  onDismiss: () => void;
  className?: string;
}

/** What the banner looks like: no state, so it can be rendered (and tested) on the server. */
export function PushBannerView({ mode, onEnable, onDismiss, className }: PushBannerViewProps): React.JSX.Element {
  return (
    <section data-push-banner={mode} aria-label={ct("mobile.push.banner_region")} className={cn("flex shrink-0 items-center gap-3 border-b border-border/60 bg-surface-1 px-3 py-2", className)}>
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Bell className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-6 text-fg">{ct(mode === "ask" ? "mobile.push.banner_text" : "mobile.push.ios_text")}</p>
        {mode === "ask" ? (
          <Button type="button" onClick={onEnable} className="mt-1 h-11 px-5">
            {ct("mobile.push.banner_enable")}
          </Button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={ct("pwa.dismiss_label")}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </section>
  );
}
