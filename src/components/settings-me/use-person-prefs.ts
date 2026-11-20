"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CHAT_PREFS_KEY, chatPrefsQueryOptions, saveChatPrefs, type ChatPrefsDto } from "@/lib/chat/cache/queries";
import type { ChatPrefs, ChatPrefsPatch } from "@/lib/chat/prefs";
import { mirrorOf, patchDevicePrefs, readDevicePrefs } from "@/lib/device-prefs";
import { applyAppearance } from "@/components/settings-me/appearance";

/**
 * C4.1 — the person's own choices on the account (`User.chatPrefs`), for the settings screens and for the little that has to follow them everywhere.
 * Reads through the SAME query the folders use (`chatPrefsQueryOptions`: one request, five minutes), saves through the same one-after-another line
 * (`useSaveChatPrefs`: the screen shows a change at once, a refused save puts it back), and keeps this device's copy (the mirror, `zk-device-prefs`) in step.
 */
export interface PersonPrefs {
  loaded: boolean;
  prefs: ChatPrefs;
  /** the company's switch `themeV2Default` (what «تلقائي حسب الجهاز» and a person who never chose a theme resolve to) */
  themeV2: boolean;
}

const NONE: ChatPrefs = {};

/** The company switch that decides the theme pair (`GET /api/me/chat-prefs/appearance`), kept like the prefs: five minutes, never refetched on focus. */
export const APPEARANCE_KEY = ["chat-prefs", "appearance"] as const;
export function appearanceQueryOptions() {
  return {
    queryKey: APPEARANCE_KEY,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<{ themeV2: boolean }> => {
      const res = await fetch("/api/me/chat-prefs/appearance", { cache: "no-store", credentials: "same-origin", signal });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { themeV2: boolean };
    },
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  } as const;
}

export function usePersonPrefs(enabled = true): PersonPrefs {
  const query = useQuery({ ...chatPrefsQueryOptions(), enabled });
  const appearance = useQuery({ ...appearanceQueryOptions(), enabled });
  const data = query.data;
  const themeV2 = appearance.data?.themeV2 === true;
  return useMemo(() => ({ loaded: !!data, prefs: data?.prefs ?? NONE, themeV2 }), [data, themeV2]);
}

/**
 * Writes the device's copy of the account's choices and applies the ones that show at once (the text size, the wallpaper) whenever the answer changes. Mounted by
 * the settings screens and, through `MeEffects`, by the shell, so the account's choices reach every device that signs in. Without an answer it does nothing.
 */
export function useApplyPersonPrefs(prefs: ChatPrefs | undefined, themeV2: boolean | undefined): void {
  useEffect(() => {
    if (!prefs) return;
    const mirror = { ...mirrorOf(prefs, Date.now()), ...(typeof themeV2 === "boolean" ? { themeV2 } : {}) };
    patchDevicePrefs({ mirror });
    applyAppearance(readDevicePrefs());
    // the theme may be «تلقائي»: the boot script of the layout re-reads the copy
    (window as unknown as { __zkThemeBoot?: () => void }).__zkThemeBoot?.();
  }, [prefs, themeV2]);
}

/**
 * Saves a patch and tells the screen whether it worked (a toast is the caller's). The patch is BUILT from the prefs as they are in the cache at the moment of the
 * save, not from what the screen drew a moment ago: two quick changes (or one made from another tab) each start from the other's result, so none is lost.
 */
export function useSavePatch(): (build: (current: ChatPrefs) => ChatPrefsPatch) => Promise<boolean> {
  const qc = useQueryClient();
  return useCallback(
    (build) => {
      const current = qc.getQueryData<ChatPrefsDto>(CHAT_PREFS_KEY)?.prefs ?? {};
      return saveChatPrefs(qc, build(current)).then(
        () => true,
        () => false,
      );
    },
    [qc],
  );
}
