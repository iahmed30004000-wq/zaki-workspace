"use client";

import { clearAllOutboxes } from "@/lib/chat/outbox/registry";
import { wipeChatCache } from "@/lib/chat/cache/wipe";
import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, LogOut, Palette, UserRound } from "lucide-react";
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
export function Initial({ name, src, large = false }: { name: string; src?: string | null; large?: boolean }) {
  if (src) return <Avatar name={name} src={src} className={large ? "size-11" : "size-8"} />;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-accent/15 font-semibold text-fg",
        large ? "size-11 text-base" : "size-8 text-sm",
      )}
    >
      {Array.from(initials(name))[0] ?? "?"}
    </span>
  );
}

/**
 * The avatar menu: who is signed in (name, @username or the e-mail, and the rank in Arabic), then
 * «المظهر» (the theme picker, in a sheet), «الدليل», «حسابي», and «تسجيل الخروج». Nothing else: no
 * button for something that does not exist yet.
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
  const { toast } = useToast();
  const [themeOpen, setThemeOpen] = useState(false);
  const themeAfterClose = useRef(false);
  const handle = user.username ? `@${user.username}` : (user.email ?? "");

  const logout = useMutation({
    mutationFn: () => apiPost("/api/auth/logout"),
    onSuccess: async () => {
      // nothing of this person stays queued in the browser for the next one to sign in (src/lib/chat/outbox/)
      await clearAllOutboxes();
      // ⚠️ message text is kept on the device for the instant start (C1.5): 🔧 gone with the person who signed out
      await wipeChatCache();
      window.location.href = "/login";
    },
    onError: () => toast(t("common.error"), "error"),
  });

  const opensUp = variant !== "bar";

  return (
    <>
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
          <div className="flex items-center gap-3 px-3 pb-3 pt-2">
            <Initial name={user.name} src={user.avatarUrl} large />
            <div className="min-w-0 flex-1">
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
          <DropdownMenuItem
            onSelect={() => {
              themeAfterClose.current = true;
            }}
          >
            <Palette aria-hidden="true" className="size-4 text-muted" />
            {t("theme.picker")}
          </DropdownMenuItem>
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
          <DropdownMenuItem tone="danger" disabled={logout.isPending} onSelect={() => logout.mutate()}>
            <LogOut aria-hidden="true" className="size-4" />
            {t("shell.avatar.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
    </>
  );
}
