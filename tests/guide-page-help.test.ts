import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { INTERNAL_WHAT_KEY, PAGE_HELP, helpArticleHref, helpNextKey, helpWhatKey, matchHelp } from "@/lib/guide/page-help";
import { ARTICLES, findArticle } from "@/lib/guide/articles";
import { TOURS } from "@/lib/guide/tours";

/** Every page the owner named, with a sample URL and the entry that must answer for it. */
const PAGES: [string, string][] = [
  ["/", "home"],
  ["/chat", "chat"],
  ["/chat/x", "conversation"],
  ["/calls/x", "call"],
  ["/watch", "watch"],
  ["/watch/x", "watch-session"],
  ["/archive", "archive"],
  ["/owner", "owner-board"],
  ["/owner/people/ckabc123", "owner-board-person"],
  ["/approvals", "approvals"],
  ["/approvals/ckabc123", "approval"],
  ["/approvals/forms", "approval-forms"],
  ["/structure", "structure"],
  ["/development", "development"],
  ["/development/skills", "development-skills"],
  ["/development/settings", "development-settings"],
  ["/development/people/ckabc123", "development-person"],
  ["/spaces", "spaces"],
  ["/spaces/current", "space"],
  ["/my-work", "my-work"],
  ["/projects", "projects"],
  ["/projects/ckabc123", "project"],
  ["/projects/ckabc123/timeline", "project-timeline"],
  ["/boards/ckabc123", "board"],
  ["/tasks/ckabc123", "task"],
  ["/list", "list"],
  ["/calendar", "calendar"],
  ["/goals", "goals"],
  ["/ideas", "ideas"],
  ["/cards", "cards"],
  ["/cards/ckabc123", "card"],
  ["/production", "production"],
  ["/departments", "departments"],
  ["/tickets", "tickets"],
  ["/campaigns", "campaigns"],
  ["/teams", "teams"],
  ["/members", "members"],
  ["/files", "files"],
  ["/documents", "documents"],
  ["/documents/ckabc123", "document"],
  ["/crm", "crm"],
  ["/time", "time"],
  ["/checkins", "checkins"],
  ["/analytics", "analytics"],
  ["/automation", "automation"],
  ["/telegram", "telegram"],
  ["/settings", "settings"],
  ["/profile", "profile"],
  ["/u/ckabc123", "person"],
  ["/guide", "guide"],
  ["/guide/tasks", "guide-article"],
];

describe("matchHelp: the page the person is on → its help", () => {
  it.each(PAGES)("%s → %s", (pathname, id) => {
    expect(matchHelp(pathname)?.id).toBe(id);
  });

  it("ignores a trailing slash, a query string and a hash", () => {
    expect(matchHelp("/my-work/")?.id).toBe("my-work");
    expect(matchHelp("/my-work?tab=overdue")?.id).toBe("my-work");
    expect(matchHelp("/projects?workspace=ckabc123")?.id).toBe("projects");
    expect(matchHelp("/projects/ckabc123/")?.id).toBe("project");
    expect(matchHelp("/guide/tasks#steps")?.id).toBe("guide-article");
    expect(matchHelp("/calendar?month=2026-10#top")?.id).toBe("calendar");
  });

  it("the most specific entry wins: a project, its timeline and the projects list are three different pages", () => {
    expect(matchHelp("/projects")?.id).toBe("projects");
    expect(matchHelp("/projects/x")?.id).toBe("project");
    expect(matchHelp("/projects/x/timeline")?.id).toBe("project-timeline");
  });

  it("a deeper path under a known page falls back to that page's help (never to the wrong one)", () => {
    expect(matchHelp("/settings/anything")?.id).toBe("settings");
    expect(matchHelp("/projects/x/something-new")?.id).toBe("project");
  });

  it("the home help belongs to the root alone: it does not swallow every unknown path", () => {
    expect(matchHelp("/")?.id).toBe("home");
    expect(matchHelp("/definitely-not-a-page")).toBeNull();
    expect(matchHelp("/login")).toBeNull();
    expect(matchHelp("/onboarding")).toBeNull();
    expect(matchHelp("/api/health")).toBeNull();
  });

  it("paths are case-sensitive, like the routes", () => {
    expect(matchHelp("/Projects")).toBeNull();
    expect(matchHelp("/MY-WORK")).toBeNull();
  });

  it("answers null for nothing, an empty string or something that is not a path", () => {
    expect(matchHelp("")).toBeNull();
    expect(matchHelp("projects")).toBeNull();
    expect(matchHelp(null as unknown as string)).toBeNull();
    expect(matchHelp(undefined as unknown as string)).toBeNull();
  });
});

describe("coverage: every page that exists has help", () => {
  const APP = path.resolve(__dirname, "../src/app/(app)");

  /** Folder → URL: `projects/[id]/timeline` → `/projects/x/timeline`; route groups vanish. */
  function pageUrls(dir: string, prefix = ""): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        const segment = /^\(.*\)$/.test(name) ? "" : name.replace(/^\[.+\]$/, "x");
        out.push(...pageUrls(full, segment ? `${prefix}/${segment}` : prefix));
      } else if (name === "page.tsx") {
        out.push(prefix === "" ? "/" : prefix);
      }
    }
    return out;
  }

  // `documents` is the empty "coming soon" page the new navigation redirects to /files
  const EXEMPT = new Set(["/documents"]);

  it("finds the pages it is supposed to find (so the check below is not vacuous)", () => {
    const urls = pageUrls(APP);
    expect(urls.length).toBeGreaterThanOrEqual(20);
    expect(urls).toEqual(expect.arrayContaining(["/", "/chat", "/projects/x", "/boards/x", "/tasks/x", "/u/x", "/guide"]));
  });

  it("every page route of the app has an entry (a new page needs its two lines)", () => {
    const missing = pageUrls(APP).filter((url) => !EXEMPT.has(url) && matchHelp(url) === null);
    expect(missing, "add these pages to src/lib/guide/page-help.ts").toEqual([]);
  });

  it("the explicit list covers every entry (no entry is unreachable)", () => {
    const reached = new Set(PAGES.map(([, id]) => id));
    for (const entry of PAGE_HELP) expect(reached.has(entry.id), entry.id).toBe(true);
  });
});

describe("the entries themselves", () => {
  it("have unique ids and unique patterns, and every pattern is an absolute path", () => {
    expect(new Set(PAGE_HELP.map((e) => e.id)).size).toBe(PAGE_HELP.length);
    expect(new Set(PAGE_HELP.map((e) => e.pattern)).size).toBe(PAGE_HELP.length);
    for (const entry of PAGE_HELP) expect(entry.pattern, entry.id).toMatch(/^\/([a-z0-9-]+|:id)?(\/([a-z0-9-]+|:id))*$/);
  });

  it("every page has both lines — «شو هاي الصفحة» and «الخطوة الجاية» — in the dictionary, in Arabic", () => {
    for (const entry of PAGE_HELP) {
      for (const key of [entry.whatKey, entry.nextKey, entry.guestNextKey].filter((k): k is string => !!k)) {
        const text = AR[key];
        expect(text, `${entry.id}: ${key}`).toBeTruthy();
        expect(text, key).toMatch(/[؀-ۿ]/);
      }
    }
  });

  it("each line is short enough to read on a phone in one glance", () => {
    for (const entry of PAGE_HELP) {
      for (const key of [entry.whatKey, entry.nextKey, entry.guestNextKey].filter((k): k is string => !!k)) {
        expect((AR[key] ?? "").length, key).toBeLessThanOrEqual(130);
      }
    }
  });

  it("the two lines of one page are different (the second is a step to take, not a repeat)", () => {
    for (const entry of PAGE_HELP) expect(AR[entry.whatKey], entry.id).not.toBe(AR[entry.nextKey]);
  });

  it("every tour named exists, and every article named exists", () => {
    for (const entry of PAGE_HELP) {
      if (entry.tour) expect(Object.keys(TOURS), entry.id).toContain(entry.tour);
      if (entry.article) expect(findArticle(entry.article), `${entry.id} → ${entry.article}`).toBeDefined();
    }
  });

  it("the home page offers the today tour; the other pages offer the app tour", () => {
    expect(matchHelp("/")?.tour).toBe("today");
    expect(matchHelp("/my-work")?.tour).toBe("shell");
    expect(matchHelp("/settings")?.tour).toBe("shell");
  });

  it("the pages a guest is refused say so (a guest line exists for each), and writing pages have a read-only line", () => {
    for (const url of ["/chat", "/members", "/files", "/crm", "/departments", "/telegram"]) {
      expect(matchHelp(url)?.guestNextKey, url).toBeTruthy();
    }
    // (goals, the list and the timeline only ever tell people to look, so one line serves everybody)
    for (const url of ["/", "/my-work", "/projects", "/projects/x", "/boards/x", "/tasks/x", "/calendar", "/ideas", "/production"]) {
      expect(matchHelp(url)?.guestNextKey, url).toBeTruthy();
    }
  });

  it("no line promises a guest something a guest cannot do (no «اسحب», «اكتب», «اضغط الدائرة»)", () => {
    for (const entry of PAGE_HELP) {
      if (!entry.guestNextKey) continue;
      const text = AR[entry.guestNextKey] ?? "";
      for (const verb of ["اسحب", "اكتب", "اضغط الدائرة", "علّم", "غيّر", "ارفع", "صوّت"]) {
        expect(text, `${entry.id}: ${verb}`).not.toContain(verb);
      }
    }
  });
});

describe("helpNextKey: the second line a viewer gets", () => {
  it("a guest gets the read-only line where there is one, everybody else the normal line", () => {
    const tasks = matchHelp("/tasks/x");
    expect(tasks).not.toBeNull();
    if (!tasks) return;
    expect(helpNextKey(tasks, "everyone")).toBe(tasks.guestNextKey);
    expect(helpNextKey(tasks, "staff")).toBe(tasks.nextKey);
    expect(helpNextKey(tasks, "managers")).toBe(tasks.nextKey);
  });

  it("a page without a guest line gives guests the normal line", () => {
    const list = matchHelp("/list");
    expect(list).not.toBeNull();
    if (!list) return;
    if (!list.guestNextKey) expect(helpNextKey(list, "everyone")).toBe(list.nextKey);
  });
});

describe("helpArticleHref: the link to the guide never leads to a 404", () => {
  it("links the article when the viewer may read it, and the guide index when not", () => {
    const tasks = matchHelp("/my-work");
    expect(tasks?.article).toBe("tasks");
    if (!tasks) return;
    expect(helpArticleHref(tasks, "staff")).toBe("/guide/tasks");
    expect(helpArticleHref(tasks, "managers")).toBe("/guide/tasks");
    // tasks is staff-level: a guest is sent to the index (which lists what they can read)
    expect(helpArticleHref(tasks, "everyone")).toBe("/guide");
  });

  it("an unknown viewer level is treated like a guest: only articles for everyone are linked", () => {
    const home = matchHelp("/");
    const members = matchHelp("/members");
    expect(home?.article).toBe("start");
    expect(helpArticleHref(home!)).toBe("/guide/start");
    expect(helpArticleHref(members!)).toBe("/guide");
  });

  it("the people page links the people article to managers only", () => {
    const members = matchHelp("/members");
    expect(members).not.toBeNull();
    if (!members) return;
    expect(helpArticleHref(members, "managers")).toBe("/guide/team");
    expect(helpArticleHref(members, "staff")).toBe("/guide");
    expect(helpArticleHref(members, "everyone")).toBe("/guide");
  });

  it("a page with no article of its own links the guide index", () => {
    const chat = matchHelp("/guide");
    expect(chat).not.toBeNull();
    if (!chat) return;
    expect(helpArticleHref({ ...chat, article: undefined }, "managers")).toBe("/guide");
  });

  it("whatever the page and the viewer, the link is a path the viewer can actually open", () => {
    const readable = (level: "everyone" | "staff" | "managers") =>
      new Set<string>(ARTICLES.filter((a) => (level === "everyone" ? a.audience === "everyone" : level === "staff" ? a.audience !== "managers" : true)).map((a) => a.slug));
    for (const level of ["everyone", "staff", "managers"] as const) {
      for (const entry of PAGE_HELP) {
        const href = helpArticleHref(entry, level);
        expect(href).toMatch(/^\/guide(\/[a-z0-9-]+)?$/);
        const slug = href.split("/")[2];
        if (slug) expect(readable(level).has(slug), `${level}: ${entry.id} → ${href}`).toBe(true);
      }
    }
  });
});


describe("helpWhatKey: the «what this page is» line a viewer gets", () => {
  it("a guest sees the chat's partner-appropriate explanation, and private pages get the internal line", () => {
    const chat = PAGE_HELP.find((h) => h.id === "chat")!;
    const archive = PAGE_HELP.find((h) => h.id === "archive")!;
    expect(helpWhatKey(chat, "everyone")).toBe(chat.whatKey);
    expect(helpWhatKey(chat, "staff")).toBe(chat.whatKey);
    expect(helpWhatKey(archive, "everyone")).toBe(INTERNAL_WHAT_KEY);
    expect(helpWhatKey(archive, "staff")).toBe(archive.whatKey);
  });

  it("every other page keeps its own line, for every viewer", () => {
    for (const help of PAGE_HELP) {
      if (help.guestNextKey === "guide.page.internal.next") continue;
      expect(helpWhatKey(help, "everyone")).toBe(help.whatKey);
      expect(helpWhatKey(help, "staff")).toBe(help.whatKey);
      expect(helpWhatKey(help, "managers")).toBe(help.whatKey);
    }
  });
});
