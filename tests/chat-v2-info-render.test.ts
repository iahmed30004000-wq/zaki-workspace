import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { InfoPanel } from "@/components/chat/v2/info/info-panel";
import { peerProfileKey } from "@/lib/chat/v2/info/use-info-data";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import type { ConversationHeaderDto, MemberDto } from "@/server/chat/dto";
import { makeHeader } from "./chat-v2-pane-fixtures.test";
import { classTokens } from "./ui-render";

/**
 * C2.7 — the info panel, drawn on the server: one component (`InfoPanel`) that the computer's side panel, the tablet's sheet and C2.8's phone route all mount.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const noop = () => undefined;
const people = (names: string[]): MemberDto[] => names.map((name, i) => ({ id: `u${i + 1}`, name, online: false }));

function draw(header: ConversationHeaderDto, over: { people?: { members?: MemberDto[]; mentionables?: MemberDto[] } | null; onClose?: () => void; client?: QueryClient } = {}): string {
  const client = over.client ?? new QueryClient();
  return renderToStaticMarkup(
    createElement(
      Translations,
      { initial: "ar" },
      createElement(Queries, { client }, createElement(InfoPanel, { header, people: over.people ?? null, onSearch: noop, onTopic: noop, ...(over.onClose ? { onClose: over.onClose } : {}) })),
    ),
  );
}
const dmHeader = (over: Parameters<typeof makeHeader>[0] = {}) => makeHeader({ kind: "DM", space: null, title: "سلمى", emoji: null, audience: { type: "PAIR", count: 2 }, memberCount: 2, peer: { id: "u2", name: "سلمى", avatarUrl: null }, ...over });

describe("a private chat", () => {
  it("shows the big picture, the title and the buttons «🔍 بحث» and the call button", () => {
    const html = draw(dmHeader());
    expect(html).toContain("data-info-panel");
    expect(html).toContain("data-info-hero");
    expect(html).toContain("سلمى");
    expect(html).toContain('data-info-button="search"');
    expect(html).toContain(AR["chatui.info.search"]!);
    // the call button is the existing one (the menu to start a call, or «انضم للمكالمة»)
    expect(html).toContain(AR["calls.menu_label"]!);
  });

  it("has no call button when the person may not call here", () => {
    expect(draw(dmHeader({ me: { canCall: false } }))).not.toContain(AR["calls.menu_label"]!);
  });

  it("has NO «🔔 الإشعارات» (no per-person mute door), NO audience block and NO moderator button", () => {
    const html = draw(dmHeader({ me: { canModerate: true } }), { people: { members: people(["أحمد", "سلمى"]) } });
    expect(html).not.toContain("🔔");
    expect(html).not.toContain("الإشعارات");
    expect(html).not.toContain("data-info-audience");
    expect(html).not.toContain("data-info-moderator");
  });

  it("the profile lines and «افتح الملف الشخصي» appear only when the existing profile door answered (the job title, the bio, the link to /u/<id>)", () => {
    const client = new QueryClient();
    expect(draw(dmHeader())).not.toContain("data-info-profile");
    client.setQueryData(peerProfileKey("c1", "u2"), { jobTitle: "مسؤولة مبيعات", bio: "بتحب القهوة" });
    const html = draw(dmHeader(), { client });
    expect(html).toContain("مسؤولة مبيعات");
    expect(html).toContain("بتحب القهوة");
    expect(html).toContain(`href="/u/u2"`);
    expect(html).toContain(AR["chatui.info.open_profile"]!);
  });

  it("a profile that came back empty draws no empty lines", () => {
    const client = new QueryClient();
    client.setQueryData(peerProfileKey("c1", "u2"), { jobTitle: null, bio: null });
    const html = draw(dmHeader(), { client });
    expect(html).not.toContain(AR["chatui.info.job"]!);
    expect(html).not.toContain(AR["chatui.info.bio"]!);
    expect(html).toContain(`href="/u/u2"`);
  });
});

describe("a topic", () => {
  it("an open topic: the space and «كل أعضاء المساحة (42)», no names, no moderator button for a member", () => {
    const html = draw(makeHeader(), { people: { members: people(["أحمد"]), mentionables: people(["أحمد", "سلمى"]) } });
    expect(html).toContain("المبيعات");
    expect(html).toContain("كل أعضاء المساحة (42)");
    expect(html).not.toContain("data-info-names");
    expect(html).not.toContain("أحمد");
    expect(html).not.toContain("data-info-moderator");
  });

  it("a topic of a section says «المقطع: …» and lists nobody", () => {
    const client = new QueryClient();
    const html = draw(makeHeader({ teamId: "t1", audience: { type: "TEAM", count: 7 }, memberCount: 7 }), { client, people: { members: people(["أحمد"]), mentionables: people(["أحمد"]) } });
    expect(html).toContain("data-info-audience");
    expect(html).toContain("المقطع:");
    expect(html).not.toContain("data-info-names");
    expect(html).not.toContain("أحمد");
  });

  it("a restricted topic says «🔒 خاص — 3 أشخاص» and, when the door gave the people, lists them", () => {
    const header = makeHeader({ restricted: true, audience: { type: "PEOPLE", count: 3 }, memberCount: 3 });
    const html = draw(header, { people: { members: people(["أحمد", "سلمى", "ليلى"]) } });
    expect(html).toContain("🔒 خاص — 3 أشخاص");
    expect(html).toContain("data-info-names");
    for (const name of ["أحمد", "سلمى", "ليلى"]) expect(html).toContain(name);
  });

  it("P0.4: …and says so WITHOUT any name to a person who was not given the people", () => {
    const header = makeHeader({ restricted: true, audience: { type: "PEOPLE", count: 3 }, memberCount: 3 });
    for (const given of [null, {}, { members: [] as MemberDto[] }, { mentionables: people(["أحمد", "سلمى"]) }]) {
      const html = draw(header, { people: given });
      expect(html).toContain("🔒 خاص — 3 أشخاص");
      expect(html).not.toContain("data-info-names");
      expect(html).not.toContain("أحمد");
      expect(html).not.toContain("سلمى");
    }
  });

  it("the owner's silent reading is said on a private topic (the server's flag), never on an open one", () => {
    expect(draw(makeHeader({ restricted: true, oversightNotice: true }))).toContain(AR["chatp.sheet.oversight"]!);
    expect(draw(makeHeader({ oversightNotice: true }))).not.toContain(AR["chatp.sheet.oversight"]!);
  });

  it("a moderator gets «إعدادات الموضوع», close and archive (the old words for the same actions); a starter topic's settings only", () => {
    const html = draw(makeHeader({ me: { canModerate: true } }));
    expect(html).toContain('data-info-moderator="settings"');
    expect(html).toContain('data-info-moderator="close"');
    expect(html).toContain('data-info-moderator="archive"');
    expect(html).toContain(AR["chatc.topic.settings"]!);
    expect(html).toContain(AR["chatc.topic.close"]!);
    expect(html).toContain(AR["chatc.topic.archive"]!);
    expect(draw(makeHeader({ me: { canModerate: true }, closed: true }))).toContain('data-info-moderator="reopen"');
  });
});

describe("what is not drawn", () => {
  it("none of the six tabs of C3d, and no empty placeholder for them", () => {
    const html = draw(makeHeader({ me: { canModerate: true } }));
    for (const word of ["الوسائط", "الملفات", "الروابط", "الصوتيات", "الشغل", "المثبّتة"]) expect(html).not.toContain(word);
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("data-info-tabs");
  });
});

describe("the frame", () => {
  it("shows its own header with a close button only when it is docked (the sheet has its own title and corner button)", () => {
    expect(draw(makeHeader(), { onClose: noop })).toContain("data-info-close");
    expect(draw(makeHeader())).not.toContain("data-info-close");
  });

  it("uses theme tokens and logical sides only, with 44 px targets for the buttons", () => {
    const html = draw(makeHeader({ me: { canModerate: true } }), { onClose: noop });
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-(?:white|black)\b/);
    const physical = /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(?:-|$)/;
    expect(classTokens(html).filter((t) => physical.test(t))).toEqual([]);
    expect(classTokens(html)).toContain("min-h-11");
  });
});

describe("where the panel is drawn (read from the source: there is no browser here)", () => {
  const host = read("src/components/chat/v2/pane/seams/info-host.tsx");
  const shell = read("src/components/chat/v2/shell/chat-shell.tsx");

  it("the info host draws nothing while `infoOpen` is false, reads only the pane's actions and the header, and toggles nothing itself", () => {
    expect(host).toMatch(/export function InfoHost\(\{ header \}: \{ header: ConversationHeaderDto \}\)/);
    expect(host).toContain("if (!a.infoOpen) return null");
    expect(host).toContain("<InfoPanel");
    expect(host).not.toMatch(/fetch\(/);
  });

  it("from 1024 px the panel is a 360 px column beside the pane (a portal into the shell's slot); below it an overlay sheet from the END side", () => {
    expect(host).toContain("createPortal(");
    expect(host).toContain('side="end"');
    expect(host).toContain("<Sheet ");
    expect(read("src/lib/chat/v2/info/use-wide.ts")).toContain("(min-width: 1024px)");
    expect(read("src/components/chat/v2/info/info-frame.tsx")).toContain("w-[22.5rem]");
    expect(shell).toContain("data-chat-info-slot");
    expect(shell).toContain("InfoSlotContext.Provider");
  });

  it("the search button opens the pane's search, and on the sheet closes the sheet first so the search is not hidden behind it", () => {
    expect(host).toContain("a.openSearch()");
    expect(host).toMatch(/if \(!docked\) a\.closeInfo\(\)/);
  });

  it("a topic change goes through the pane's `call` with the topics door, then the header is asked for again", () => {
    expect(host).toContain("doors.topic(header.id, patch)");
    expect(host).toContain("chatKeys.header(header.id)");
  });

  it("the panel body is ONE component the phone's route can mount (it imports nothing of the pane's provider)", () => {
    const panel = read("src/components/chat/v2/info/info-panel.tsx");
    expect(panel).not.toContain("pane-actions");
    expect(panel).not.toContain("usePaneActions");
    expect(panel).toContain("export function InfoPanel(");
  });

  it("the profile and the section name come from doors that already exist (the profile route, the space's sections); no new route", () => {
    const data = read("src/lib/chat/v2/info/use-info-data.ts");
    expect(data).toContain("/api/users/");
    expect(data).toContain("/teams");
  });

  it("no per-person mute is drawn: no «اكتم الإشعارات», no bell", () => {
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const file of ["src/components/chat/v2/info/info-panel.tsx", "src/components/chat/v2/pane/seams/info-host.tsx", "src/lib/chat/v2/info/info-model.ts"]) {
      expect(code(read(file)), file).not.toMatch(/🔔|اكتم الإشعارات|["'`]mute["'`]|menu\.mute/);
    }
  });
});
