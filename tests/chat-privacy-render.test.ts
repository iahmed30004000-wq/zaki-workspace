/**
 * P0.4 — say who can see it (docs/restructure/P0-privacy.md). Four states of a conversation — open topic, restricted topic,
 * a «مقطع»'s topic, a DM — each says so in its head, its row and its sheet, in Arabic with Western digits; the sheet is honest
 * about silent oversight; the old banner is reworded.
 */
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatHome } from "@/components/chat/home/chat-home";
import { PrivacyBody } from "@/components/chat/conversation/privacy-sheet";
import { ConversationHeader } from "@/components/chat/conversation/conversation-header";
import { privacyLabel, privacyState, visibleToLine } from "@/lib/chat/privacy";
import { AR } from "@/lib/i18n/dict";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => "/chat" }));

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `شخص${i + 1}`, online: false }));

describe("the four states", () => {
  it("are told apart from what the conversation already carries", () => {
    expect(privacyState({ kind: "TOPIC" })).toBe("open");
    expect(privacyState({ kind: "TOPIC", restricted: true })).toBe("restricted");
    expect(privacyState({ kind: "TOPIC", teamId: "x" })).toBe("team");
    expect(privacyState({ kind: "TOPIC", restricted: true, teamId: "x" })).toBe("restricted");
    expect(privacyState({ kind: "DM" })).toBe("dm");
    expect(privacyState({ kind: "GROUP" })).toBe("dm");
  });

  it("say it in the head: «🔒 خاص · 4 أشخاص», nothing for an open topic", () => {
    expect(privacyLabel("restricted", 4)).toBe("🔒 خاص · 4 أشخاص");
    expect(privacyLabel("restricted", 2)).toBe("🔒 خاص · شخصان");
    expect(privacyLabel("restricted", 11)).toBe("🔒 خاص · 11 شخصًا");
    expect(privacyLabel("team", 7)).toBe("👥 للمقطع · 7 أشخاص");
    expect(privacyLabel("dm", 2)).toBe("🔒 بينكم بس");
    expect(privacyLabel("open", 30)).toBeNull();
  });

  it("the header shows the label as a button that opens the sheet, and nothing when there is none", () => {
    const base = { conversationId: "c", title: "T", subtitle: "مساحة", call: null, searching: false, onSearch: () => undefined, canSet: false, onSettings: () => undefined, onBack: () => undefined };
    const withLabel = renderToStaticMarkup(createElement(ConversationHeader, { ...base, privacy: { label: "🔒 خاص · 4 أشخاص", onOpen: () => undefined } }));
    expect(withLabel).toMatch(/<button[^>]*data-privacy[^>]*>[^<]*🔒 خاص · 4 أشخاص/);
    expect(withLabel).toContain("مساحة");
    expect(renderToStaticMarkup(createElement(ConversationHeader, base))).not.toContain("data-privacy");
  });
});

describe("the sheet", () => {
  it("names every person of a restricted topic, and says honestly that the owner may read in oversight", () => {
    const html = renderToStaticMarkup(createElement(PrivacyBody, { state: "restricted", members: people(4), oversightNotice: true }));
    for (let i = 1; i <= 4; i++) expect(html).toContain(`شخص${i}`);
    expect(html).toContain("والمالك بصفة رقابة");
  });

  it("leaves the oversight line out when nobody holds oversight", () => {
    const html = renderToStaticMarkup(createElement(PrivacyBody, { state: "restricted", members: people(3), oversightNotice: false }));
    expect(html).not.toContain("رقابة");
  });

  it("says what each other state means", () => {
    expect(renderToStaticMarkup(createElement(PrivacyBody, { state: "dm", members: people(2), oversightNotice: true }))).toContain(AR["chatp.sheet.dm"]!);
    expect(renderToStaticMarkup(createElement(PrivacyBody, { state: "team", members: people(5), oversightNotice: false }))).toContain(AR["chatp.sheet.team"]!);
    expect(renderToStaticMarkup(createElement(PrivacyBody, { state: "open", members: [], oversightNotice: false }))).toContain(AR["chatp.sheet.open"]!);
  });
});

describe("the row of a topic in the list", () => {
  const topic = (over: Record<string, unknown>) => ({ id: "t", title: "موضوع", emoji: "💬", topicType: "DISCUSSION" as const, unread: 0, mentions: 0, closed: false, restricted: false, teamId: null, pinned: false, archived: false, canPost: true, ...over });
  const space = (topics: unknown[]) => ({ id: "s", name: "مساحة", emoji: "🌿", kind: "STANDARD", hasExternal: false, canModerate: false, canCreateTopic: false, sections: [{ id: "x", name: "التصميم" }], unread: 0, topics });
  const row = (over: Record<string, unknown>) => renderToStaticMarkup(createElement(ChatHome, { guest: false, home: { canOversee: false, spaces: [space([topic(over)])] as never, dms: [] } }));

  it("a restricted topic has a lock, a «مقطع» topic has the people icon, an open topic neither", () => {
    expect(row({ restricted: true })).toContain(`aria-label="${AR["chath.restricted"]}"`);
    expect(row({ teamId: "x" })).toContain(`aria-label="${AR["chath.team_topic"]}"`);
    const open = row({});
    expect(open).not.toContain(`aria-label="${AR["chath.restricted"]}"`);
    expect(open).not.toContain(`aria-label="${AR["chath.team_topic"]}"`);
  });
});

describe("before saving a topic's settings: «رح يشوفه: …»", () => {
  it("lists the people, or the space, or the «مقطع»", () => {
    expect(visibleToLine({ audience: "people", names: ["أحمد", "سارة"] })).toBe("رح يشوفه: أحمد، سارة");
    expect(visibleToLine({ audience: "space", spaceName: "المبيعات" })).toBe("رح يشوفه: كل أعضاء مساحة المبيعات");
    expect(visibleToLine({ audience: "section", sectionName: "التصميم" })).toBe("رح يشوفه: أعضاء مقطع التصميم");
    expect(visibleToLine({ audience: "people", names: [] })).toBe("ما حدا رح يشوفه: اختار ناس.");
  });
});

describe("the banner", () => {
  it("tells the person reading in oversight that the owners of the talk will not know", () => {
    expect(AR["chatc.oversight_banner"]).toBe("أنت عم تقرأ هالموضوع بصفة رقابة — أصحابه ما بيعرفوا إنك قرأت");
  });
});
