"use client";

import { useSyncExternalStore } from "react";
import { chatSoundsActive, subscribeChatSoundsActive } from "@/lib/chat/chime/active";

/** Is the company's switch `chatSounds` on (the listener is mounted)? Off on the server and until the listener says so. */
export function useChatSoundsActive(): boolean {
  return useSyncExternalStore(subscribeChatSoundsActive, chatSoundsActive, () => false);
}
