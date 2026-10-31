/**
 * The help every page gives about itself: two short lines - «شو هاي الصفحة» (what this page is) and
 * «الخطوة الجاية» (the next step) - a tour («فرجيني») when one fits, and the article that explains
 * more. A pure module, so the shell can use the matcher without loading the guide.
 *
 * The lines live in the dictionary (src/lib/i18n/ar.guide.json); an entry holds their keys.
 *
 * `guestNextKey`: an external partner (a guest) looks but does not write, so where the next step
 * would tell people to write, drag or tick something, they get a line that tells them to look; a
 * page the server refuses them says so instead of promising anything.
 *
 * A new page needs an entry here: tests/guide-page-help.test.ts fails for a page route without one.
 */
import { ARTICLE_AUDIENCE, canRead, type ArticleSlug, type Audience } from "./audience";
import type { TourKey } from "./tours";

export interface PageHelp {
  /** Stable name of the page (also part of the dictionary keys). */
  id: string;
  /** The URL, with `:id` for any dynamic segment. */
  pattern: string;
  whatKey: string;
  nextKey: string;
  /** The "next step" for a guest, when the normal one does not apply to them. */
  guestNextKey?: string;
  tour?: TourKey;
  article?: ArticleSlug;
}

/** A page the server refuses to guests (and the shell does not offer them). */
const INTERNAL = "guide.page.internal.next";

export const PAGE_HELP: readonly PageHelp[] = [
  {
    id: "home",
    pattern: "/",
    whatKey: "guide.page.home.what",
    nextKey: "guide.page.home.next",
    guestNextKey: "guide.page.home.next_guest",
    tour: "today",
    article: "start",
  },
  {
    id: "chat",
    pattern: "/chat",
    whatKey: "guide.page.chat.what",
    nextKey: "guide.page.chat.next",
    guestNextKey: "guide.page.chat.next_guest",
    tour: "shell",
    article: "chat",
  },
  {
    id: "conversation",
    pattern: "/chat/:id",
    whatKey: "guide.page.conversation.what",
    nextKey: "guide.page.conversation.next",
    guestNextKey: "guide.page.conversation.next_guest",
    article: "chat",
  },
  {
    id: "call",
    pattern: "/calls/:id",
    whatKey: "guide.page.call.what",
    nextKey: "guide.page.call.next",
    article: "calls",
  },
  {
    id: "watch",
    pattern: "/watch",
    whatKey: "guide.page.watch.what",
    nextKey: "guide.page.watch.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "watch-session",
    pattern: "/watch/:id",
    whatKey: "guide.page.watch-session.what",
    nextKey: "guide.page.watch-session.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "archive",
    pattern: "/archive",
    whatKey: "guide.page.archive.what",
    nextKey: "guide.page.archive.next",
    guestNextKey: INTERNAL,
    article: "chat",
  },
  // «الموافقات»: the static page `/approvals/forms` is listed BEFORE `/approvals/:id` (same length, the first one listed wins a tie)
  {
    id: "approval-forms",
    pattern: "/approvals/forms",
    whatKey: "guide.page.approval-forms.what",
    nextKey: "guide.page.approval-forms.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "approval",
    pattern: "/approvals/:id",
    whatKey: "guide.page.approval.what",
    nextKey: "guide.page.approval.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "approvals",
    pattern: "/approvals",
    whatKey: "guide.page.approvals.what",
    nextKey: "guide.page.approvals.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "owner-board",
    pattern: "/owner",
    whatKey: "guide.page.owner-board.what",
    nextKey: "guide.page.owner-board.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "owner-board-person",
    pattern: "/owner/people/:id",
    whatKey: "guide.page.owner-board-person.what",
    nextKey: "guide.page.owner-board-person.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "structure",
    pattern: "/structure",
    whatKey: "guide.page.structure.what",
    nextKey: "guide.page.structure.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "development-settings",
    pattern: "/development/settings",
    whatKey: "guide.page.development-settings.what",
    nextKey: "guide.page.development-settings.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "development-skills",
    pattern: "/development/skills",
    whatKey: "guide.page.development-skills.what",
    nextKey: "guide.page.development-skills.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "development-person",
    pattern: "/development/people/:id",
    whatKey: "guide.page.development-person.what",
    nextKey: "guide.page.development-person.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "development",
    pattern: "/development",
    whatKey: "guide.page.development.what",
    nextKey: "guide.page.development.next",
    guestNextKey: INTERNAL,
  },
  {
    id: "space",
    pattern: "/spaces/current",
    whatKey: "guide.page.space.what",
    nextKey: "guide.page.space.next",
    guestNextKey: INTERNAL,
    article: "spaces",
  },
  {
    id: "spaces",
    pattern: "/spaces",
    whatKey: "guide.page.spaces.what",
    nextKey: "guide.page.spaces.next",
    guestNextKey: INTERNAL,
    article: "spaces",
  },
  {
    id: "my-work",
    pattern: "/my-work",
    whatKey: "guide.page.my-work.what",
    nextKey: "guide.page.my-work.next",
    guestNextKey: "guide.page.my-work.next_guest",
    tour: "shell",
    article: "tasks",
  },
  {
    id: "projects",
    pattern: "/projects",
    whatKey: "guide.page.projects.what",
    nextKey: "guide.page.projects.next",
    guestNextKey: "guide.page.projects.next_guest",
    tour: "shell",
    article: "projects",
  },
  {
    id: "project",
    pattern: "/projects/:id",
    whatKey: "guide.page.project.what",
    nextKey: "guide.page.project.next",
    guestNextKey: "guide.page.project.next_guest",
    tour: "shell",
    article: "projects",
  },
  {
    id: "project-timeline",
    pattern: "/projects/:id/timeline",
    whatKey: "guide.page.project-timeline.what",
    nextKey: "guide.page.project-timeline.next",
    tour: "shell",
    article: "projects",
  },
  {
    id: "board",
    pattern: "/boards/:id",
    whatKey: "guide.page.board.what",
    nextKey: "guide.page.board.next",
    guestNextKey: "guide.page.board.next_guest",
    tour: "shell",
    article: "projects",
  },
  {
    id: "task",
    pattern: "/tasks/:id",
    whatKey: "guide.page.task.what",
    nextKey: "guide.page.task.next",
    guestNextKey: "guide.page.task.next_guest",
    tour: "shell",
    article: "tasks",
  },
  {
    id: "list",
    pattern: "/list",
    whatKey: "guide.page.list.what",
    nextKey: "guide.page.list.next",
    tour: "shell",
    article: "tasks",
  },
  {
    id: "calendar",
    pattern: "/calendar",
    whatKey: "guide.page.calendar.what",
    nextKey: "guide.page.calendar.next",
    guestNextKey: "guide.page.calendar.next_guest",
    tour: "shell",
    article: "tasks",
  },
  {
    id: "goals",
    pattern: "/goals",
    whatKey: "guide.page.goals.what",
    nextKey: "guide.page.goals.next",
    tour: "shell",
    article: "ideas-goals",
  },
  {
    id: "cards",
    pattern: "/cards",
    whatKey: "guide.page.cards.what",
    nextKey: "guide.page.cards.next",
    guestNextKey: "guide.page.cards.next_guest",
    tour: "shell",
  },
  {
    id: "card",
    pattern: "/cards/:id",
    whatKey: "guide.page.card.what",
    nextKey: "guide.page.card.next",
    guestNextKey: "guide.page.card.next_guest",
  },
  {
    id: "ideas",
    pattern: "/ideas",
    whatKey: "guide.page.ideas.what",
    nextKey: "guide.page.ideas.next",
    guestNextKey: "guide.page.ideas.next_guest",
    tour: "shell",
    article: "ideas-goals",
  },
  {
    id: "production",
    pattern: "/production",
    whatKey: "guide.page.production.what",
    nextKey: "guide.page.production.next",
    guestNextKey: "guide.page.production.next_guest",
    tour: "shell",
    article: "company",
  },
  {
    id: "departments",
    pattern: "/departments",
    whatKey: "guide.page.departments.what",
    nextKey: "guide.page.departments.next",
    guestNextKey: INTERNAL,
    tour: "shell",
    article: "company",
  },
  {
    id: "tickets",
    pattern: "/tickets",
    whatKey: "guide.page.tickets.what",
    nextKey: "guide.page.tickets.next",
    guestNextKey: INTERNAL,
    tour: "shell",
    article: "company",
  },
  {
    id: "campaigns",
    pattern: "/campaigns",
    whatKey: "guide.page.campaigns.what",
    nextKey: "guide.page.campaigns.next",
    guestNextKey: INTERNAL,
    tour: "shell",
    article: "company",
  },
  {
    id: "teams",
    pattern: "/teams",
    whatKey: "guide.page.teams.what",
    nextKey: "guide.page.teams.next",
    tour: "shell",
    article: "places",
  },
  {
    id: "members",
    pattern: "/members",
    whatKey: "guide.page.members.what",
    nextKey: "guide.page.members.next",
    guestNextKey: INTERNAL,
    tour: "shell",
    article: "team",
  },
  {
    id: "files",
    pattern: "/files",
    whatKey: "guide.page.files.what",
    nextKey: "guide.page.files.next",
    guestNextKey: INTERNAL,
    tour: "shell",
    article: "company",
  },
  {
    id: "documents",
    pattern: "/documents",
    whatKey: "guide.page.documents.what",
    nextKey: "guide.page.documents.next",
    guestNextKey: "guide.page.documents.next_guest",
    tour: "shell",
    article: "company",
  },
  {
    id: "document",
    pattern: "/documents/:id",
    whatKey: "guide.page.document.what",
    nextKey: "guide.page.document.next",
    guestNextKey: "guide.page.document.next_guest",
    tour: "shell",
    article: "company",
  },
  {
    id: "crm",
    pattern: "/crm",
    whatKey: "guide.page.crm.what",
    nextKey: "guide.page.crm.next",
    guestNextKey: INTERNAL,
    tour: "shell",
    article: "company",
  },
  {
    id: "time",
    pattern: "/time",
    whatKey: "guide.page.time.what",
    nextKey: "guide.page.time.next",
    guestNextKey: INTERNAL,
    tour: "shell",
    article: "places",
  },
  {
    id: "checkins",
    pattern: "/checkins",
    whatKey: "guide.page.checkins.what",
    nextKey: "guide.page.checkins.next",
    guestNextKey: INTERNAL,
    tour: "shell",
    article: "places",
  },
  {
    id: "analytics",
    pattern: "/analytics",
    whatKey: "guide.page.analytics.what",
    nextKey: "guide.page.analytics.next",
    tour: "shell",
    article: "places",
  },
  {
    id: "automation",
    pattern: "/automation",
    whatKey: "guide.page.automation.what",
    nextKey: "guide.page.automation.next",
    tour: "shell",
    article: "places",
  },
  {
    id: "telegram",
    pattern: "/telegram",
    whatKey: "guide.page.telegram.what",
    nextKey: "guide.page.telegram.next",
    guestNextKey: INTERNAL,
    tour: "shell",
    article: "places",
  },
  {
    id: "settings",
    pattern: "/settings",
    whatKey: "guide.page.settings.what",
    nextKey: "guide.page.settings.next",
    tour: "shell",
    article: "team",
  },
  {
    id: "profile",
    pattern: "/profile",
    whatKey: "guide.page.profile.what",
    nextKey: "guide.page.profile.next",
    tour: "shell",
    article: "privacy",
  },
  {
    id: "person",
    pattern: "/u/:id",
    whatKey: "guide.page.person.what",
    nextKey: "guide.page.person.next",
    tour: "shell",
    article: "privacy",
  },
  {
    id: "guide",
    pattern: "/guide",
    whatKey: "guide.page.guide.what",
    nextKey: "guide.page.guide.next",
    tour: "shell",
    article: "start",
  },
  {
    id: "guide-article",
    pattern: "/guide/:id",
    whatKey: "guide.page.guide-article.what",
    nextKey: "guide.page.guide-article.next",
    tour: "shell",
    article: "start",
  },
];

const WILDCARD = ":id";

const parsed = PAGE_HELP.map((entry) => ({ entry, segments: entry.pattern.split("/").filter(Boolean) }));

/** The segments of a URL path, without its query string, hash or trailing slash; null when it is no path. */
function segmentsOf(pathname: string): string[] | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return null;
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  return path.split("/").filter(Boolean);
}

/**
 * The help for the page at this path, or null when the page has none (a login screen, a redirect).
 * The most specific entry wins (`/projects/x/timeline` over `/projects/:id`), a deeper unknown path
 * falls back to the page it belongs under, and the home page answers for the root alone.
 */
export function matchHelp(pathname: string): PageHelp | null {
  const parts = segmentsOf(pathname);
  if (!parts) return null;
  let best: PageHelp | null = null;
  let bestLength = -1;
  for (const { entry, segments } of parsed) {
    if (segments.length === 0) {
      if (parts.length === 0) return entry;
      continue;
    }
    if (segments.length > parts.length) continue;
    if (!segments.every((segment, i) => segment === WILDCARD || segment === parts[i])) continue;
    if (segments.length > bestLength) {
      best = entry;
      bestLength = segments.length;
    }
  }
  return best;
}

/** The key of the internal-only «what» line, for a guest the page refuses. */
export const INTERNAL_WHAT_KEY = "guide.page.internal.what";

/**
 * The «what this page is» line this viewer gets: a guest whose page has an internal-only next step
 * (the server refuses them there) gets the internal-page line instead of the page's normal one.
 */
export function helpWhatKey(help: PageHelp, audience: Audience): string {
  return audience === "everyone" && help.guestNextKey === INTERNAL ? INTERNAL_WHAT_KEY : help.whatKey;
}

/** The "next step" line this viewer gets: a guest the read-only one when there is one. */
export function helpNextKey(help: PageHelp, audience: Audience): string {
  return audience === "everyone" && help.guestNextKey ? help.guestNextKey : help.nextKey;
}

/**
 * Where the "read more" link goes: the article for the page when this viewer may open it, otherwise
 * the guide's index (which lists exactly what they can read). A link never leads to a 404. With no
 * viewer level given, only articles meant for everyone are linked.
 */
export function helpArticleHref(help: PageHelp, audience: Audience = "everyone"): string {
  const slug = help.article;
  if (!slug) return "/guide";
  return canRead(audience, ARTICLE_AUDIENCE[slug]) ? `/guide/${slug}` : "/guide";
}
