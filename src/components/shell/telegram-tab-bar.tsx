"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Briefcase, MessageCircle, Settings, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PlaceBadge } from "./place-badge";
import { useTgPhoneOn } from "./tg-phone";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";

/**
 * «شريط تيليجرام السفلي» (the switch `tgTabBar`, off by default): on a phone the bar along the bottom is Telegram's tabs — الدردشات (with the unread badge) · جهات الاتصال ·
 * الإعدادات · الشغل · البروفايل (the person's own picture) — a floating glass pill with a press animation, drawn in place of the places bar (or beside the drawer). Every tab is a page
 * that already exists; nothing is removed. While a conversation is open the bar is hidden, as the places bar is (`data-frame-bars="hide-all"`). Never for an external partner.
 */
export const TG_TABS = [
  { key: "chats", href: "/chat", labelKey: "tgbar.chats" },
  { key: "contacts", href: "/contacts", labelKey: "tgbar.contacts" },
  { key: "settings", href: "/settings/me", labelKey: "tgbar.settings" },
  // the owner, 2026-11-27: the bar took the places bar's room, so «الشغل» stands in it, beside the profile
  { key: "work", href: "/my-work", labelKey: "nav.place.work" },
  { key: "profile", href: "/profile", labelKey: "tgbar.profile" },
] as const;
export type TgTabKey = (typeof TG_TABS)[number]["key"];

/**
 * A tab's word is never cut (the owner, 2026-11-27: «الكلمات متل البروفايل كبيرة ومش ظاهرة»): it does not grow with a phone set to bigger text (a fifth of the
 * row cannot grow with it), and if a phone enlarges it all the same, it goes onto a second line and the tab grows.
 */
const LABEL = "line-clamp-2 max-w-full text-center text-[length:min(0.75rem,12px)] leading-[1.35]";

/** The pages of «الشغل» (the place `work` of the map, src/lib/nav/places.ts, and what it owns). */
const WORK_PAGES = ["/my-work", "/tasks", "/projects", "/list", "/calendar", "/requests", "/approvals", "/time"] as const;

/** Which tab the page belongs to (the profile and a person's page are «البروفايل» and «جهات الاتصال» respectively; anything else is none). Pure. */
export function tgTabOf(pathname: string): TgTabKey | null {
  const p = pathname.split("?")[0] ?? "";
  if (p === "/chat" || p.startsWith("/chat/")) return "chats";
  if (p === "/contacts" || p === "/members" || p.startsWith("/members/") || p.startsWith("/u/")) return "contacts";
  // the profile's own page, and the form that changes it
  if (p === "/profile" || p.startsWith("/profile/") || p === "/settings/me/account") return "profile";
  if (p === "/settings" || p.startsWith("/settings/")) return "settings";
  if (WORK_PAGES.some((base) => p === base || p.startsWith(`${base}/`))) return "work";
  return null;
}

export function TelegramTabBar({ pathname, chatUnread, user }: { pathname: string; chatUnread: number; user: { name: string; avatarUrl?: string | null } }) {
  const { t } = useI18n();
  const current = tgTabOf(pathname);
  const tg = useTgPhoneOn();
  const at = TG_TABS.findIndex((tab) => tab.key === current);
  // «تيليجرام»: the page comes from the side of the tab that was pressed, 120 ms (the stylesheet moves it)
  const before = useRef(at);
  useEffect(() => {
    const from = before.current;
    before.current = at;
    if (!tg || from < 0 || at < 0 || from === at) return;
    const main = document.getElementById("zk-main");
    if (!main) return;
    main.setAttribute("data-tg-tab-in", at > from ? "next" : "prev");
    const timer = window.setTimeout(() => main.removeAttribute("data-tg-tab-in"), TG_MOTION.tabSwitchMs + 40);
    return () => {
      window.clearTimeout(timer);
      main.removeAttribute("data-tg-tab-in");
    };
  }, [at, tg]);
  return (
    <nav
      aria-label={t("tgbar.label")}
      data-tg-tab-bar
      className="pointer-events-none fixed bottom-0 end-0 start-0 z-40 px-1 pb-[max(env(safe-area-inset-bottom),0.5rem)] md:hidden group-has-[[data-frame-bars=hide-all]]/frame:max-md:hidden"
    >
      <ul className="pointer-events-auto relative isolate mx-auto flex max-w-md items-center rounded-3xl border border-border/60 bg-surface-1/85 p-0.5 shadow-card backdrop-blur-md">
        {tg && at >= 0 ? (
          // a fifth of the row each; the pill moves toward the inline end (leftwards here)
          <li role="presentation" aria-hidden="true" data-tg-tab-pill="" className="pointer-events-none absolute inset-y-0.5 start-0.5 -z-10 w-[calc((100%-0.25rem)/5)] rounded-2xl bg-selected-row ltr:[transform:translateX(calc(var(--at)*100%))] rtl:[transform:translateX(calc(var(--at)*-100%))]" style={{ "--at": at } as React.CSSProperties} />
        ) : null}
        {TG_TABS.map((tab) => {
          const active = tab.key === current;
          // «تيليجرام على التلفون» says them as his pictures do
          const label = t(tg && tab.key === "chats" ? "tgbar.tg.chats" : tg && tab.key === "profile" ? "tgbar.tg.profile" : tab.labelKey);
          return (
            <li key={tab.key} className="min-w-0 flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                data-tg-tab={tab.key}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-0 py-0.5 transition-[transform,background-color,color] duration-150 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
                  active ? (tg ? "font-semibold text-accent" : "bg-accent/15 font-semibold text-accent") : "text-fg-muted hover:text-fg",
                )}
              >
                <span className="relative grid h-6 w-10 place-items-center">
                  {tab.key === "chats" ? <MessageCircle aria-hidden="true" className="size-5" /> : null}
                  {tab.key === "contacts" ? <Users aria-hidden="true" className="size-5" /> : null}
                  {tab.key === "settings" ? <Settings aria-hidden="true" className="size-5" /> : null}
                  {tab.key === "work" ? <Briefcase aria-hidden="true" className="size-5" /> : null}
                  {tab.key === "profile" ? <Avatar name={user.name} src={user.avatarUrl ?? null} className={cn("size-6 text-xs", active && "ring-2 ring-accent")} /> : null}
                  {tab.key === "chats" ? <PlaceBadge count={chatUnread} place="chat" className="absolute -top-1 end-0" /> : null}
                </span>
                {tg && tab.key === "profile" ? (
                  // five tabs leave 69px each on a 360px phone and «الملف الشخصي» needs 75 at the smallest readable size: the short word stands in there
                  <span className={LABEL}>
                    <span className="max-[374px]:hidden">{label}</span>
                    <span className="hidden max-[374px]:inline">{t("tgbar.tg.profile_short")}</span>
                  </span>
                ) : (
                  <span className={LABEL}>{label}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
