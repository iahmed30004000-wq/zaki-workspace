"use client";

import Link from "next/link";
import { MessageCircle, Settings, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PlaceBadge } from "./place-badge";

/**
 * «شريط تيليجرام السفلي» (the switch `tgTabBar`, off by default): on a phone the bar along the bottom is Telegram's four tabs — الدردشات (with the unread badge) · جهات الاتصال ·
 * الإعدادات · البروفايل (the person's own picture) — a floating glass pill with a press animation, drawn in place of the places bar (or beside the drawer). Every tab is a page
 * that already exists; nothing is removed. While a conversation is open the bar is hidden, as the places bar is (`data-frame-bars="hide-all"`). Never for an external partner.
 */
export const TG_TABS = [
  { key: "chats", href: "/chat", labelKey: "tgbar.chats" },
  { key: "contacts", href: "/members", labelKey: "tgbar.contacts" },
  { key: "settings", href: "/settings/me", labelKey: "tgbar.settings" },
  { key: "profile", href: "/profile", labelKey: "tgbar.profile" },
] as const;
export type TgTabKey = (typeof TG_TABS)[number]["key"];

/** Which tab the page belongs to (the profile and a person's page are «البروفايل» and «جهات الاتصال» respectively; anything else is none). Pure. */
export function tgTabOf(pathname: string): TgTabKey | null {
  const p = pathname.split("?")[0] ?? "";
  if (p === "/chat" || p.startsWith("/chat/")) return "chats";
  if (p === "/members" || p.startsWith("/members/") || p.startsWith("/u/")) return "contacts";
  if (p === "/settings" || p.startsWith("/settings/")) return "settings";
  if (p === "/profile" || p.startsWith("/profile/")) return "profile";
  return null;
}

export function TelegramTabBar({ pathname, chatUnread, user }: { pathname: string; chatUnread: number; user: { name: string; avatarUrl?: string | null } }) {
  const { t } = useI18n();
  const current = tgTabOf(pathname);
  return (
    <nav
      aria-label={t("tgbar.label")}
      data-tg-tab-bar
      className="pointer-events-none fixed bottom-0 end-0 start-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] md:hidden group-has-[[data-frame-bars=hide-all]]/frame:max-md:hidden"
    >
      <ul className="pointer-events-auto mx-auto flex max-w-md items-center rounded-3xl border border-border/60 bg-surface-1/85 p-1 shadow-card backdrop-blur-md">
        {TG_TABS.map((tab) => {
          const active = tab.key === current;
          const label = t(tab.labelKey);
          return (
            <li key={tab.key} className="min-w-0 flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                data-tg-tab={tab.key}
                className={cn(
                  "flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-xs transition-[transform,background-color,color] duration-150 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
                  active ? "bg-accent/15 font-semibold text-accent" : "text-fg-muted hover:text-fg",
                )}
              >
                <span className="relative grid h-6 w-10 place-items-center">
                  {tab.key === "chats" ? <MessageCircle aria-hidden="true" className="size-5" /> : null}
                  {tab.key === "contacts" ? <Users aria-hidden="true" className="size-5" /> : null}
                  {tab.key === "settings" ? <Settings aria-hidden="true" className="size-5" /> : null}
                  {tab.key === "profile" ? <Avatar name={user.name} src={user.avatarUrl ?? null} className={cn("size-6 text-xs", active && "ring-2 ring-accent")} /> : null}
                  {tab.key === "chats" ? <PlaceBadge count={chatUnread} place="chat" className="absolute -top-1 end-0" /> : null}
                </span>
                <span className="max-w-full truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
