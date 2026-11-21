"use client";

import React, { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { ensurePush, pushState } from "@/components/calls/push-client";
import { useChatRow } from "@/lib/chat/cache/selectors";
import { chatRouteOf } from "@/lib/chat/v2/routes";
import { closeChatNotifications } from "@/lib/pwa/notifications";
import { alreadyAsked, markAsked, shouldAskOnFirstDm } from "@/lib/pwa/push-ask";
import { registerServiceWorker } from "@/lib/pwa/register";
import { NewMessageIntent } from "./new-message-intent";
import { PushBanner } from "./push-banner";

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * M1a — everything the installed app adds to the chat, mounted ONCE by the chat list (`chat-list-column.tsx`, which stays mounted while the person moves between
 * conversations):
 *   - the service worker is registered (offline page, cached shell, grouped notifications: `public/sw.js`), for everybody who gets this far;
 *   - the browser's notification question is asked the FIRST time a private chat is opened on this device, inside the tap that opened it (once: `zk-push-asked`;
 *     with no tap it is not asked and not remembered), and the banner stays on the list for anybody who has not answered;
 *   - opening a conversation takes its notification off the screen (the notification's `tag` is the conversation's id);
 *   - `/chat?new=message` (the app icon's shortcut) opens the «محادثة جديدة» dialog.
 * It draws only the banner, and only while a question can still be answered.
 */
export function ChatPwaHost({ guest }: { guest: boolean }): React.JSX.Element {
  const pathname = usePathname();
  const route = useMemo(() => chatRouteOf(pathname), [pathname]);
  const openId = route.kind === "conversation" ? route.id : null;
  const kind = useChatRow(openId)?.kind ?? null;

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    if (!openId) return;
    void closeChatNotifications(openId);
  }, [openId]);

  useEffect(() => {
    if (!openId || kind === null) return;
    const storage = safeStorage();
    const activated = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true;
    if (!shouldAskOnFirstDm({ state: pushState(), asked: alreadyAsked(storage), kind, activated })) return;
    markAsked(storage);
    void ensurePush(true);
  }, [openId, kind]);

  return (
    <>
      <PushBanner />
      {guest ? null : <NewMessageIntent />}
    </>
  );
}
