import type { MediaCountsDto } from "@/server/chat/media";

/**
 * C3d — THE INFO PANEL'S TABS «الوسائط · الملفات · الروابط · الصوتيات · الشغل · المثبّتة», as pure functions. A tab is drawn ONLY when it has something in it (no empty
 * placeholder, no tab for a feature that is off): the counts come from `GET …/media?counts=1` (one request), the work from `GET …/media/work`, the pinned from the
 * header the cache already holds.
 */
export type InfoTabId = "media" | "files" | "links" | "voice" | "work" | "pinned";

export const INFO_TAB_ORDER: readonly InfoTabId[] = ["media", "files", "links", "voice", "work", "pinned"];

const LABELS: Record<InfoTabId, string> = {
  media: "chatinfo.tab.media",
  files: "chatinfo.tab.files",
  links: "chatinfo.tab.links",
  voice: "chatinfo.tab.voice",
  work: "chatinfo.tab.work",
  pinned: "chatinfo.tab.pinned",
};

/** The dictionary key of a tab's name. */
export const tabLabelKey = (id: InfoTabId): string => LABELS[id];

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
}

export interface InfoTab {
  id: InfoTabId;
  labelKey: string;
  count: number;
}

/** The tabs that have data, in the order above. */
export function tabsOf(facts: InfoTabFacts): InfoTab[] {
  const counts = facts.counts;
  const numbers: Record<InfoTabId, number> = {
    media: counts ? counts.IMAGE + counts.VIDEO : 0,
    files: counts?.FILE ?? 0,
    links: counts?.LINK ?? 0,
    voice: counts?.AUDIO ?? 0,
    work: facts.work ? facts.work.tasks + facts.work.tickets : 0,
    pinned: facts.pinned,
  };
  return INFO_TAB_ORDER.filter((id) => numbers[id] > 0).map((id) => ({ id, labelKey: LABELS[id], count: numbers[id] }));
}

/** The tab shown: the one the person chose while it still has data, otherwise the first. */
export function activeTabOf(tabs: readonly InfoTab[], chosen: InfoTabId | null): InfoTabId | null {
  if (chosen && tabs.some((t) => t.id === chosen)) return chosen;
  return tabs[0]?.id ?? null;
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
