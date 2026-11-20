"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { settingsShortcutOf } from "@/lib/chat/shortcuts";
import { mirrorStale, readDevicePrefs } from "@/lib/device-prefs";
import { applyAppearance } from "@/components/settings-me/appearance";
import { SETTINGS_ME_HREF } from "@/components/settings-me/sections";
import { usePersonPrefs, useApplyPersonPrefs } from "@/components/settings-me/use-person-prefs";

/**
 * C4.1 — what «إعداداتي» needs from every page of the app. Draws nothing.
 *
 *  1. Applies what this device already holds (the text size, the wallpaper) as soon as the page is up. The text size is also set before the first paint by the
 *     layout's boot script; the wallpaper needs its pattern fetched, so it comes here.
 *  2. Keeps the device's copy of the person's choices fresh: when the copy is older than six hours (or there is none) it asks the account once
 *     (`/api/me/chat-prefs` and `/api/me/chat-prefs/appearance`, the same query the folders use), writes the copy and applies it. On the settings screens
 *     (`always`) it reads whenever the screen is open, so a change made on another device shows.
 *  3. Ctrl+, opens «إعداداتي» from anywhere (a computer's key; the physical comma key, so an Arabic layout works). Several of these may be mounted at once (the side menu and
 *     the phone's bar): the first to see the key handles it and the others find it already handled.
 */
export function MeEffects({ always = false }: { always?: boolean }) {
  const router = useRouter();
  // read once on the client: with no storage (the server render) the copy counts as stale, which only decides whether to ask
  const stale = typeof window === "undefined" ? true : mirrorStale(readDevicePrefs(), Date.now());
  const person = usePersonPrefs(always || stale);
  useApplyPersonPrefs(person.loaded ? person.prefs : undefined, person.loaded ? person.themeV2 : undefined);

  useEffect(() => {
    applyAppearance(readDevicePrefs());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!settingsShortcutOf(event)) return;
      event.preventDefault();
      router.push(SETTINGS_ME_HREF);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return null;
}
