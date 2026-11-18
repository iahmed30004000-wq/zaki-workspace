import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatHome } from "@/components/chat/home/chat-home";
import { filterTopics } from "@/components/chat/home/space-topics";
import { RowMenu, rowMenuOffers } from "@/components/chat/home/row-menu";

// the dialogs open the new chat inside the app (router.push): rendered on its own, the page has no app router
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => "/chat" }));

describe("chat home audience sections", () => {
  const topic = (id: string, title: string, teamId: string | null = null) => ({ id, title, emoji: "💬", topicType: "DISCUSSION" as const, unread: 0, mentions: 0, closed: false, restricted: false, teamId, pinned: false, archived: false, canPost: true, lastMessage: null });
  const space = (over: Record<string, unknown> = {}) => ({ id: "s", name: "مساحة", emoji: "🌿", kind: "STANDARD", hasExternal: true, canModerate: false, canCreateTopic: false, sections: [], unread: 0, topics: [topic("t", "عام")], ...over });

  it("shows the space you are in with its topics to guests, without a private section", () => {
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: true, home: { canOversee: false, spaces: [space()], dms: [] } }));
    expect(html).toContain("<bdi>مساحة</bdi>");
    expect(html).toContain("عام");
    expect(html).not.toContain("خاص");
    expect(html).not.toContain("موضوع جديد"); // only the space's ADMIN and the OWNER open topics
  });

  it("groups the topics like a forum group: the space's own first, then each «مقطع» under its name", () => {
    const home = space({
      canCreateTopic: true,
      sections: [{ id: "x", name: "التصميم" }, { id: "y", name: "الشحن" }],
      topics: [topic("t1", "عام"), topic("t2", "شغل التصميم", "x")],
    });
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: false, home: { canOversee: false, spaces: [home], dms: [] } }));
    expect(html.indexOf("عام")).toBeLessThan(html.indexOf("مقطع التصميم"));
    expect(html.indexOf("مقطع التصميم")).toBeLessThan(html.indexOf("شغل التصميم"));
    expect(html).toContain("مقطع الشحن");
    expect(html).toContain("ما في مواضيع بهالمقطع لسا.");
    expect(html).toMatch(/<button[^>]*>موضوع جديد<\/button>/);
  });
  it("«رسالة جديدة» is a button that opens the people picker, not a link the page ignores", () => {
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: false, home: { canOversee: false, spaces: [], dms: [] } }));
    expect(html).toMatch(/<button[^>]*>رسالة جديدة<\/button>/);
    expect(html).not.toContain("new=dm");
  });
  it("«افتح مساحة» never links to the missing /workspaces page, and waits for the server's answer", () => {
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: false, home: { canOversee: false, spaces: [], dms: [] } }));
    expect(html).not.toContain("href=\"/workspaces\"");
    // before /api/workspaces says the person may open a space, there is no button at all
    expect(html).not.toContain("افتح مساحة");
  });
  it("shows the owner oversight switch", () => {
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: false, home: { canOversee: true, spaces: [], dms: [] } }));
    expect(html).toContain("كل الشركة");
    expect(html).toContain("محادثاتي");
  });

  it("marks a pinned topic, folds the archived ones under «المؤرشفة», and shows the filters", () => {
    const home = space({
      topics: [{ ...topic("p", "مثبت هون"), pinned: true }, topic("t", "عام"), { ...topic("a", "قديم"), archived: true }],
    });
    const html = renderToStaticMarkup(createElement(ChatHome, { guest: false, home: { canOversee: false, spaces: [home], dms: [] } }));
    expect(html).toContain("📌");
    expect(html).toContain("المؤرشفة (1)");
    expect(html.indexOf("المؤرشفة (1)")).toBeLessThan(html.indexOf("قديم"));
    expect(html).toContain("غير المقروء");
  });
});

describe("the topic filters", () => {
  const t = (id: string, over: Record<string, unknown> = {}) => ({ id, title: id, emoji: null, topicType: "DISCUSSION" as const, unread: 0, mentions: 0, closed: false, restricted: false, teamId: null, pinned: false, archived: false, canPost: true, lastMessage: null, ...over });
  const all = [t("a", { unread: 2 }), t("b", { mentions: 1, unread: 1 }), t("c", { topicType: "TASKS", teamId: "x" }), t("d")];
  const ids = (f: Parameters<typeof filterTopics>[1]) => filterTopics(all, f).map((x) => x.id);

  it("unread, mentioning me, one kind, one «مقطع» or the space's own", () => {
    expect(ids({ show: "all", kind: "", section: "" })).toEqual(["a", "b", "c", "d"]);
    expect(ids({ show: "unread", kind: "", section: "" })).toEqual(["a", "b"]);
    expect(ids({ show: "mentions", kind: "", section: "" })).toEqual(["b"]);
    expect(ids({ show: "all", kind: "TASKS", section: "" })).toEqual(["c"]);
    expect(ids({ show: "all", kind: "", section: "x" })).toEqual(["c"]);
    expect(ids({ show: "all", kind: "", section: "space" })).toEqual(["a", "b", "d"]);
  });
});

describe("the old «⋯» after C2.2 split its logic into pieces (the new list's menu is built from the same ones)", () => {
  it("the same items for the same people: managers pin, archive and delete an empty topic; the owner's purge replaces the plain delete; a system topic is never archived or purged", () => {
    expect(rowMenuOffers({ kind: "topic", canModerate: true })).toEqual({ manage: true, purge: false, pin: true, archive: true, delete: true, any: true });
    expect(rowMenuOffers({ kind: "topic", canModerate: true, canPurge: true })).toEqual({ manage: true, purge: true, pin: true, archive: true, delete: false, any: true });
    expect(rowMenuOffers({ kind: "topic", canModerate: true, archived: true })).toMatchObject({ pin: false, archive: true });
    expect(rowMenuOffers({ kind: "topic", canModerate: true, canPurge: true, system: true })).toMatchObject({ archive: false, purge: false, delete: false, pin: true });
    expect(rowMenuOffers({ kind: "dm", canModerate: true })).toMatchObject({ manage: false, any: false });
    expect(rowMenuOffers({ kind: "dm", canPurge: true })).toMatchObject({ manage: false, purge: true, any: true });
    expect(rowMenuOffers({ kind: "topic" })).toMatchObject({ any: false });
  });

  it("draws the same button for somebody who has an item, and nothing for somebody who has none", () => {
    const shown = renderToStaticMarkup(createElement(RowMenu, { id: "t1", title: "عام", kind: "topic", canModerate: true, onChanged: () => undefined }));
    expect(shown).toContain('aria-label="خيارات «عام»"');
    expect(shown).toContain("size-11");
    expect(renderToStaticMarkup(createElement(RowMenu, { id: "t1", title: "عام", kind: "topic", onChanged: () => undefined }))).toBe("");
  });
});
