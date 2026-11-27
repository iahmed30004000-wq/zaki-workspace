import type { MediaCountsDto } from "@/server/chat/media";
import { arabicPlural } from "@/lib/format";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";

/**
 * C3d + S5.4 — THE INFO PANEL'S TABS «الوسائط · الملفات · الروابط · الصوتيات · الأعضاء · الشغل · المثبّتة», as pure functions.
 *
 * S5.4: the first four are ALWAYS drawn, each with an empty sentence of its own when there is nothing (an empty conversation is not a panel with a hole in it), and
 * «الأعضاء» is always drawn for a conversation that has people (a topic or a group; a private chat has the profile instead). «الشغل» and «المثبّتة» (the old ones)
 * stay and are drawn only when they have something. The counts come from `GET …/media?counts=1` (one request), the work from `GET …/media/work`, the pinned from
 * the header the cache already holds, the members from the people the existing detail door gave.
 */
export type InfoTabId = "media" | "files" | "links" | "voice" | "members" | "work" | "pinned";

export const INFO_TAB_ORDER: readonly InfoTabId[] = ["media", "files", "links", "voice", "members", "work", "pinned"];

const LABELS: Record<InfoTabId, string> = {
  media: "chatinfo.tab.media",
  files: "chatinfo.tab.files",
  links: "chatinfo.tab.links",
  voice: "chatinfo.tab.voice",
  members: "chatprof.tab.members",
  work: "chatinfo.tab.work",
  pinned: "chatinfo.tab.pinned",
};

/** The tabs that are drawn whatever they hold. */
const ALWAYS: readonly InfoTabId[] = ["media", "files", "links", "voice"];

/** The dictionary key of a tab's name. */
export const tabLabelKey = (id: InfoTabId): string => LABELS[id];

/** The dictionary key of a tab's empty sentence (the four content tabs and the members). */
export const emptyKeyOf = (id: "media" | "files" | "links" | "voice" | "members"): string => `chatprof.empty.${id}`;

/** What the media route is asked for by a tab (the work and the pinned tabs have no page of the media route). */
export const TAB_KIND = { media: "MEDIA", files: "FILE", links: "LINK", voice: "AUDIO" } as const satisfies Partial<Record<InfoTabId, string>>;
export type PagedTab = keyof typeof TAB_KIND;
export const isPagedTab = (id: InfoTabId): id is PagedTab => id in TAB_KIND;

export interface InfoTabFacts {
  /** the media route's counts, or null while they are not known (a tab is never drawn from a guess) */
  counts: MediaCountsDto["counts"] | null;
  /** the work tab's rows (tasks and tickets this person may see), or null while not known */
  work: { tasks: number; tickets: number } | null;
  /** the pinned messages of the header */
  pinned: number;
  /** the number the members tab shows; null: this conversation has no members tab (a private chat) */
  members: number | null;
}

export interface InfoTab {
  id: InfoTabId;
  labelKey: string;
  /** what the tab holds (0 while it is not known: the tab says nothing until it knows, and never claims «empty» from a guess) */
  count: number;
}

/** The tabs of the panel in the order above: the always-drawn ones, the members where there are people, the work and the pinned only with data. */
export function tabsOf(facts: InfoTabFacts): InfoTab[] {
  const counts = facts.counts;
  const numbers: Record<InfoTabId, number> = {
    media: counts ? counts.IMAGE + counts.VIDEO : 0,
    files: counts?.FILE ?? 0,
    links: counts?.LINK ?? 0,
    voice: counts?.AUDIO ?? 0,
    members: facts.members ?? 0,
    work: facts.work ? facts.work.tasks + facts.work.tickets : 0,
    pinned: facts.pinned,
  };
  const drawn = (id: InfoTabId): boolean => (id === "members" ? facts.members !== null : ALWAYS.includes(id) || numbers[id] > 0);
  return INFO_TAB_ORDER.filter(drawn).map((id) => ({ id, labelKey: LABELS[id], count: numbers[id] }));
}

/**
 * The tab shown: the one the person chose; otherwise the first of the content tabs that has something in it (a conversation with only files opens on «الملفات»),
 * otherwise «الوسائط» (an empty conversation says so, it does not open on its people).
 */
export function activeTabOf(tabs: readonly InfoTab[], chosen: InfoTabId | null): InfoTabId | null {
  if (chosen && tabs.some((t) => t.id === chosen)) return chosen;
  const withData = tabs.find((t) => t.id !== "members" && t.count > 0);
  return (withData ?? tabs[0])?.id ?? null;
}

/**
 * The tab an arrow key moves to. The screen is right-to-left, so the key toward the START edge (the right arrow) is the PREVIOUS tab and the left arrow the NEXT;
 * Home / End go to the ends; no wrapping past them. `null`: not a key of the tab list.
 */
export function tabAfterKey(tabs: readonly InfoTab[], current: InfoTabId | null, key: string): InfoTabId | null {
  if (tabs.length === 0) return null;
  const at = Math.max(0, tabs.findIndex((t) => t.id === current));
  if (key === "Home") return tabs[0]!.id;
  if (key === "End") return tabs[tabs.length - 1]!.id;
  const step = key === "ArrowLeft" ? 1 : key === "ArrowRight" ? -1 : 0;
  if (step === 0) return null;
  return tabs[Math.min(tabs.length - 1, Math.max(0, at + step))]!.id;
}

// ───────────────────────────── the phone's info page («تيليجرام على التلفون») ─────────────────────────────

/** The members first, then the rest in their usual order (a computer, and the switch off, keep `INFO_TAB_ORDER`). */
export function orderTabs(tabs: readonly InfoTab[], phone: boolean): InfoTab[] {
  if (!phone) return [...tabs];
  return [...tabs.filter((t) => t.id === "members"), ...tabs.filter((t) => t.id !== "members")];
}

/** The phone's page opens on its people where it has any, as the app does; otherwise by the usual rule. */
export function phoneActiveTabOf(tabs: readonly InfoTab[], chosen: InfoTabId | null): InfoTabId | null {
  if (chosen && tabs.some((t) => t.id === chosen)) return chosen;
  return tabs.some((t) => t.id === "members") ? "members" : activeTabOf(tabs, null);
}

/**
 * The tab a sideways swipe brings (`dx`, `dy`: how far the finger went). Right-to-left, the next tab lies on the left, so a finger moving RIGHT pulls it in.
 * `null`: too short, more up-and-down than sideways, or there is no tab that way.
 */
export function swipeTabOf(tabs: readonly InfoTab[], current: InfoTabId, dx: number, dy: number, rtl: boolean): InfoTabId | null {
  if (Math.abs(dx) < TG_MOTION.infoSwipePx || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  const forward = rtl ? dx > 0 : dx < 0;
  const at = tabs.findIndex((t) => t.id === current);
  return at < 0 ? null : (tabs[at + (forward ? 1 : -1)]?.id ?? null);
}

/** The line under the header's title: what the active tab holds, in the Arabic form of the number. */
export const counterKeyOf = (id: InfoTabId, count: number): string => `tgsheets.count.${id}.${count === 0 ? "zero" : arabicPlural(count)}`;

/** The address of one page of a tab's list. */
export function mediaPageUrl(conversationId: string, kind: (typeof TAB_KIND)[PagedTab], before?: string | null): string {
  const base = `/api/chat/conversations/${encodeURIComponent(conversationId)}/media?kind=${kind}`;
  return before ? `${base}&before=${encodeURIComponent(before)}` : base;
}

export const mediaCountsUrl = (conversationId: string): string => `/api/chat/conversations/${encodeURIComponent(conversationId)}/media?counts=1`;
export const workUrl = (conversationId: string): string => `/api/chat/conversations/${encodeURIComponent(conversationId)}/media/work`;

/** Only an ordinary web address is opened from a link row (the server stores https pages only; this is the second lock). */
export function safeLinkHref(url: string): string | null {
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}
