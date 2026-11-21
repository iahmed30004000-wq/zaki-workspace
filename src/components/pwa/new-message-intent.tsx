"use client";

import React, { useState } from "react";
import { NewDmDialog } from "@/components/chat/home/new-dm-dialog";
import { NEW_MESSAGE_INTENT } from "@/lib/nav/new-actions";
import { useNewIntent } from "@/lib/nav/use-new-intent";

/**
 * M1a — the chat's half of `/chat?new=message` (the installed app's shortcut «رسالة جديدة», `src/app/manifest.ts`): it opens the «محادثة جديدة» dialog once and
 * takes `?new=message` off the address, so a reload or the back button does not open it again (`useNewIntent`). It is mounted by the chat list with the other
 * installed-app pieces (`chat-pwa-host.tsx`) and not for an external partner, who has no private chats to start.
 */
export function NewMessageIntent(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  useNewIntent(NEW_MESSAGE_INTENT, () => setOpen(true));
  return <NewDmDialog open={open} onOpenChange={setOpen} />;
}
