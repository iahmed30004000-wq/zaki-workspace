"use client";

import { clearAllOutboxes } from "@/lib/chat/outbox/registry";
import { wipeChatCache } from "@/lib/chat/cache/wipe";
import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, LogOut, Palette, Settings, UserRound } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { enumLabel } from "@/lib/i18n/enums";
import { initials } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { NavRole } from "@/lib/nav/places";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ThemePicker } from "@/components/theme/theme-picker";
import { useToast } from "@/components/ui/toast";
import { MeEffects } from "@/components/settings-me/me-effects";
import { useSettingsOneDoor } from "./nav-options";
import { clearMirror } from "@/lib/device-prefs";

/** What the menu shows of the signed-in person (CurrentUser fits as it is). */
export interface AvatarUser {
  name: string;
  username: string | null;
  email: string | null;
  /** `/api/avatars/<id>` — the picture this person uploaded, or null for the initials. */
  avatarUrl?: string | null;
}

/**
 * Where the menu sits: `bar` the phone's top bar (opens downwards), `sidebar` the bottom of the computer's
 * side menu with the name beside the circle, `rail` the same folded to an icon (both open upwards).
 */
export type AvatarVariant = "bar" | "sidebar" | "rail";

/** The person's picture in a circle, or their first letter (decoration: the button carries the name). */
export function Initial({ name, src, large = false, onAccent = false }: { name: string; src?: string | null; large?: boolean; /** On the accent (the phone drawer's header): a translucent disc in the accent's own text colour. */ onAccent?: boolean }) {
  if (src) return <Avatar name={name} src={src} className={large ? "size-11" : "size-8"} />;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        onAccent ? "bg-accent-fg/20 text-accent-fg" : "bg-accent/15 text-fg",
        large ? "size-11 text-base" : "size-8 text-sm",
      )}
    >
      {Array.from(initials(name))[0] ?? "?"}
    </span>
  );
}

/**
 * The sign-out, once: the avatar menu's last row and the phone drawer's last button both use it. Nothing of this person stays on the device for the next one to sign in.
 */
function useLogout() {
  const { t } = useI18n();
  const { toast } = useToast();
  return useMutation({
    mutationFn: () => apiPost("/api/auth/logout"),
    onSuccess: async () => {
      // nothing of this person stays queued in the browser for the next one to sign in (src/lib/chat/outbox/)
      await clearAllOutboxes();
      // ⚠️ message text is kept on the device for the instant start (C1.5): 🔧 gone with the person who signed out
      await wipeChatCache();
      // the copy of this person's settings (theme, text size, send key) leaves with them (C4.1)
      clearMirror();
      window.location.href = "/login";
    },
    onError: () => toast(t("common.error"), "error"),
  });
}

/**
 * «تسجيل الخروج» as a button of its own: the LAST thing in the phone drawer, one tap (the owner: no opening the profile to find it). The danger colour, 48px high.
 */
export function SignOutButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const logout = useLogout();
  return (
    <button
      type="button"
      data-shell="drawer-signout"
      disabled={logout.isPending}
      onClick={() => logout.mutate()}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-3 text-start text-sm font-semibold text-danger transition-colors hover:bg-danger/15 disabled:opacity-60",
        className,
      )}
    >
      <LogOut aria-hidden="true" className="size-5 shrink-0" />
      <span className="truncate">{t("shell.avatar.logout")}</span>
    </button>
  );
}

/**
 * The avatar menu: who is signed in (name, @username or the e-mail, and the rank in Arabic), then
 * «المظهر» (the theme picker, in a sheet), «الدليل», «حسابي», and «تسجيل الخروج». Nothing else: no
 * button for something that does not exist yet. C4.1 adds «إعداداتي» (`/settings/me`) as the gear beside the person's name at the top of the menu (the four items below are
 * pinned by tests/shell-render.test.ts; «حسابي» is the first section of «إعداداتي» and its old address `/profile` redirects there), and mounts `MeEffects` (draws nothing):
 * the device's copy of the person's choices and Ctrl+, .
 *
 * 2026-11-22: while «الإعدادات» is ONE door the menu has no «الإعدادات» row either (a duplicate of the side menu and the rail). S3.3: the theme row and its sheet are gone (the theme's home is the person's own settings, «المظهر واللغة»).
 *
 * The theme sheet opens only once the menu has closed and handed focus back to the avatar, so the sheet
 * remembers the avatar as its opener and gives focus back to it when it closes.
 *
 * `data-tour="avatar"` is on the trigger. `defaultOpen` and `portal={false}` are for server-render tests.
 */
export function AvatarMenu({
  user,
  rank,
  variant = "bar",
  defaultOpen,
  portal = true,
}: {
  user: AvatarUser;
  rank: NavRole;
  variant?: AvatarVariant;
  defaultOpen?: boolean;
  portal?: boolean;
}) {
  const { t } = useI18n();
  // S3.1: «الإعدادات» is ONE door: the menu keeps the theme, ONE row «الإعدادات» (it replaces «إعداداتي», «الدليل» and «حسابي»: «حسابي» is the first section inside) and the sign-out
  const oneDoor = useSettingsOneDoor();
  const [themeOpen, setThemeOpen] = useState(false);
  const themeAfterClose = useRef(false);
  const handle = user.username ? `@${user.username}` : (user.email ?? "");

  const logout = useLogout();

  const opensUp = variant !== "bar";

  return (
    <>
      <MeEffects />
      <DropdownMenu defaultOpen={defaultOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-tour="avatar"
            aria-label={t("shell.avatar.open", { name: user.name })}
            title={variant === "rail" ? user.name : undefined}
            className={cn(
              "flex min-w-0 items-center gap-2.5 rounded-xl text-start transition-colors hover:bg-surface-2",
              variant === "sidebar" ? "h-12 w-full px-2" : "size-11 justify-center",
            )}
          >
            <Initial name={user.name} src={user.avatarUrl} />
            {variant === "sidebar" ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg"><bdi>{user.name}</bdi></span>
                {handle ? (
                  <span dir="ltr" className="block truncate text-end text-xs text-muted">
                    {handle}
                  </span>
                ) : null}
              </span>
            ) : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          portal={portal}
          side={opensUp ? "top" : "bottom"}
          align={opensUp ? "start" : "end"}
          className="w-72"
          onCloseAutoFocus={() => {
            if (!themeAfterClose.current) return;
            themeAfterClose.current = false;
            // after Radix has given focus back to the avatar (it does so right after this handler)
            window.setTimeout(() => setThemeOpen(true), 0);
          }}
        >
          <div className="relative flex items-center gap-3 px-3 pb-3 pt-2">
            {oneDoor ? null : (
              <Link
                href="/settings/me"
                data-settings-me-link
                aria-label={t("settingsMe.avatar")}
                title={t("settingsMe.avatar")}
                className="absolute end-1 top-0 grid size-11 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <Settings aria-hidden="true" className="size-4" />
              </Link>
            )}
            <Initial name={user.name} src={user.avatarUrl} large />
            <div className="min-w-0 flex-1 pe-9">
              <p className="truncate text-sm font-semibold text-fg"><bdi>{user.name}</bdi></p>
              {handle ? (
                <p dir="ltr" className="truncate text-end text-xs text-fg-muted">
                  {handle}
                </p>
              ) : null}
              <p className="mt-1.5 inline-flex rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-fg">{enumLabel("OrgRole", rank)}</p>
            </div>
          </div>
          <DropdownMenuSeparator />
          {/* S3.3: while «الإعدادات» is ONE door the theme has ONE home (settings › «المظهر واللغة»), so this menu draws no theme row and no sheet */}
          {oneDoor ? null : (
            <DropdownMenuItem
              onSelect={() => {
                themeAfterClose.current = true;
              }}
            >
              <Palette aria-hidden="true" className="size-4 text-muted" />
              {t("theme.picker")}
            </DropdownMenuItem>
          )}
          {/* the owner (2026-11-22): while «الإعدادات» is ONE door this menu has no row for it: the side menu and the rail already carry the door, so a second one was a duplicate */}
          {oneDoor ? null : (
            <>
              <DropdownMenuItem asChild>
                <Link href="/guide">
                  <BookOpen aria-hidden="true" className="size-4 text-muted" />
                  {t("guide.title")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/profile">
                  <UserRound aria-hidden="true" className="size-4 text-muted" />
                  {t("shell.avatar.account")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem tone="danger" disabled={logout.isPending} onSelect={() => logout.mutate()}>
            <LogOut aria-hidden="true" className="size-4" />
            {t("shell.avatar.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {oneDoor ? null : (
        <Sheet open={themeOpen} onOpenChange={setThemeOpen}>
          <SheetContent aria-describedby={undefined}>
            <SheetHeader>
              <SheetTitle>{t("shell.avatar.theme_title")}</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <ThemePicker />
            </SheetBody>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
