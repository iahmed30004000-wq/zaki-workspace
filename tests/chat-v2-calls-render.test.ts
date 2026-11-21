import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { CallButton } from "@/components/calls/call-button";
import type { CallView } from "@/components/calls/call-api";
import { CallRingCard } from "@/components/calls/call-ring";
import { MeetingButton } from "@/components/calls/meeting-button";
import { CallBarView } from "@/components/chat/v2/pane/call-bar";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens } from "./ui-render";

/**
 * C2.9 — the call entry points on the new look: the bar of a live call (under the header), the ring (the incoming-call card on every page), «مكالمة» in
 * the header and the info panel, and «اجتماع جديد». LOOKS ONLY: what each one asks of the server, when it rings and what it opens are the old code, pinned
 * by the call-* tests and by the source checks below. The same components serve the old screen, the quick chat and the assistant's call.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const noop = () => undefined;
const draw = (node: ReactElement): string => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, node)));

const VIEW: CallView = {
  id: "call1",
  title: null,
  conversationId: "c1",
  conversationTitle: "مبيعات الشام",
  spaceId: null,
  video: true,
  kind: "TOPIC",
  rangCount: 0,
  startedByMe: false,
  answered: false,
  endedHow: null,
  startedAt: "2026-11-19T10:00:00.000Z",
  endedAt: null,
  startedBy: { id: "u2", name: "سلمى", avatarUrl: null },
  path: "/calls/call1",
  people: [],
  can: { invite: true, end: false },
};

describe("the bar of a live call", () => {
  it("keeps its words and is ONE button; a solid `ok` strip with a pulsing phone and a chevron at the end, 44 px high", () => {
    const html = draw(createElement(CallBarView, { onJoin: noop }));
    expect(html).toContain("data-call-bar");
    expect(html).toContain(AR["chatui.pane.call_bar"]!);
    expect(html.match(/<button/g)).toHaveLength(1);
    const tokens = classTokens(html);
    expect(tokens).toEqual(expect.arrayContaining(["bg-ok", "text-ok-fg", "min-h-11", "w-full", "animate-pulse", "motion-reduce:animate-none"]));
    expect(html).toContain("lucide-phone-call");
    expect(html).toContain("lucide-chevron-left");
  });

  it("shows up to three of the people in the call, and how many are in (the Telegram video-chat bar), still ONE button", () => {
    const people = [1, 2, 3, 4].map((n) => ({ userId: `u${n}`, name: `شخص${n}`, avatarUrl: null }));
    const html = draw(createElement(CallBarView, { onJoin: noop, people, count: 4 }));
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("4 بالمكالمة");
    expect(html.match(/data-call-face/g)).toHaveLength(3);
    const two = draw(createElement(CallBarView, { onJoin: noop, people: people.slice(0, 2), count: 2 }));
    expect(two).toContain("اتنين بالمكالمة");
    expect(two.match(/data-call-face/g)).toHaveLength(2);
    // nobody connected yet: the old words alone, no faces
    const none = draw(createElement(CallBarView, { onJoin: noop, people: [], count: 0 }));
    expect(none).not.toContain("data-call-face");
    expect(none).toContain(AR["chatui.pane.call_bar"]!);
  });

  it("is hidden for a person who is already inside the call, and the header's button no longer repeats it", () => {
    const bar = read("src/components/chat/v2/pane/call-bar.tsx");
    expect(bar).toContain("insideCall(going.id,");
    const button = read("src/components/calls/call-button.tsx");
    expect(button).toContain("joinInBar");
    expect(read("src/components/chat/v2/pane/pane-header.tsx")).toMatch(/<CallButton[^>]*joinInBar/);
  });
});

describe("the ring (the incoming-call card)", () => {
  const card = () => draw(createElement(CallRingCard, { view: VIEW, onDecline: noop, onAnswer: noop }));

  it("says who is calling, what kind of call and where; «رفض» and «ردّ» are the two buttons, 44 px each", () => {
    const html = card();
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("سلمى عم يرنّ عليك");
    expect(html).toContain(AR["calls.video"]!);
    expect(html).toContain("بـ«مبيعات الشام»");
    expect(html).toContain(AR["calls.ring.decline"]!);
    expect(html).toContain(AR["calls.ring.answer"]!);
    expect(html.match(/<button/g)).toHaveLength(2);
    expect((html.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("is a flat floating card on the tokens: the one soft shadow, under the notch, fading up in 120 ms and still under reduced motion", () => {
    const tokens = classTokens(card());
    expect(tokens).toEqual(expect.arrayContaining(["shadow-card", "bg-surface-1", "rounded-2xl", "animate-fade-up", "motion-reduce:animate-none", "top-[calc(0.75rem+env(safe-area-inset-top))]"]));
    expect(tokens).not.toContain("shadow-lg");
  });

  it("a PRIVATE call's card is a full-screen overlay on a phone with two big buttons, and the compact banner from `md` up", () => {
    const html = draw(createElement(CallRingCard, { view: { ...VIEW, kind: "DM", conversationTitle: null }, onDecline: noop, onAnswer: noop }));
    const tokens = classTokens(html);
    expect(tokens).toEqual(expect.arrayContaining(["inset-0", "z-[70]", "bg-surface-1", "min-h-14", "md:inset-auto", "md:rounded-2xl", "md:shadow-card", "md:min-h-11", "md:top-[calc(0.75rem+env(safe-area-inset-top))]"]));
    expect(html).toContain('role="alertdialog"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain(AR["calls.ring.decline"]!);
    expect(html).toContain(AR["calls.ring.answer"]!);
    // the notch and the home bar are respected
    expect(html).toContain("env(safe-area-inset-bottom)");
  });

  it("a topic's or a meeting's ring stays the compact banner on every width", () => {
    const tokens = classTokens(card());
    expect(tokens).not.toContain("z-[70]");
    expect(tokens).not.toContain("min-h-14");
  });

  it("«رفض» is the button set's danger variant and «ردّ» is the green `ok` pair; a voice call says so", () => {
    const html = card();
    expect(html).toMatch(/<button[^>]*class="[^"]*bg-danger text-danger-fg[^"]*"[^>]*>[^]*?رفض/);
    expect(html).toMatch(/<button[^>]*class="[^"]*bg-ok[^"]*text-ok-fg[^"]*"[^>]*>[^]*?ردّ/);
    const voice = draw(createElement(CallRingCard, { view: { ...VIEW, video: false, conversationTitle: null, title: "اجتماع الصباح" }, onDecline: noop, onAnswer: noop }));
    expect(voice).toContain(AR["calls.audio"]!);
    expect(voice).toContain("بـ«اجتماع الصباح»");
  });

  it("the ring's own logic is the old code: the same live event, the same API read, thirty seconds, the ring tone, «ردّ» opens the call's page", () => {
    const src = read("src/components/calls/call-ring.tsx");
    expect(src).toContain('event.kind !== "call.ring"');
    expect(src).toContain("`/api/calls/${encodeURIComponent(event.callId)}`");
    expect(src).toContain("export const RING_FOR_MS = 30_000;");
    expect(src).toContain("const tone = startRing();");
    expect(src).toContain("router.push(`/calls/${encodeURIComponent(id)}`);");
    expect(src).toContain("void ensurePush(true);");
    expect(src).toContain("call?.prefetch(view.id);");
  });

  it("«رفض» tells the server (the caller hears it); the card also closes when the call changes under it (answered elsewhere, ended)", () => {
    const src = read("src/components/calls/call-ring.tsx");
    expect(src).toContain("/decline");
    expect(src).toContain('event.kind === "call.changed"');
    expect(src).toContain("ringIsOver(");
  });
});

describe("«مكالمة» in a header and in the info panel", () => {
  const button = (props: Record<string, unknown> = {}) => draw(createElement(CallButton as FunctionComponent<Record<string, unknown>>, { conversationId: "c1", isDm: true, canStart: true, ...props }));

  it("in a header: a flat 44 px icon among the other header icons (a lucide phone, never the emoji), with the word from `sm`", () => {
    const html = button();
    expect(html).toContain(AR["calls.menu_label"]!);
    expect(html).toContain("lucide-phone");
    expect(html).not.toContain("📞");
    expect(html).not.toContain("🎥");
    const tokens = classTokens(html);
    expect(tokens).toEqual(expect.arrayContaining(["min-h-11", "min-w-11", "rounded-lg", "text-fg", "hover:bg-surface-2"]));
    expect(tokens).not.toContain("border");
    expect(html).toContain(AR["calls.button"]!);
  });

  it("`outlined` (the info panel's) is the bordered pill its neighbours are", () => {
    expect(classTokens(button({ outlined: true }))).toEqual(expect.arrayContaining(["border", "border-border", "px-4"]));
    expect(read("src/components/chat/v2/info/info-panel.tsx")).toMatch(/<CallButton[^>]*canStart outlined \/>/);
  });

  it("the compact icon of the quick chat is unchanged in size", () => {
    expect(classTokens(button({ compact: true }))).toEqual(expect.arrayContaining(["size-8", "rounded-full"]));
  });

  it("nobody who may not start a call sees the button; what it asks of the server is the old code", () => {
    expect(button({ canStart: false })).toBe("");
    const src = read("src/components/calls/call-button.tsx");
    expect(src).toContain("callApi<{ id: string }>(base, { video, ring: isDm || ring })");
    expect(src).toContain("router.push(`/calls/${encodeURIComponent(out.id)}`);");
    expect(src).toContain('event.kind === "call.changed" && event.conversationId === conversationId');
    expect(src).toContain("void ensurePush(true);");
  });

  it("«رنّ على الكل» is OFF by default for a topic or a group (a private call always rings): a call there does not wake the whole space", () => {
    const src = read("src/components/calls/call-button.tsx");
    expect(src).toContain("const [ring, setRing] = React.useState(false);");
    expect(src).not.toContain("React.useState(true)");
    expect(src).toContain("ring: isDm || ring");
  });

  it("the header mounts the same button (and the assistant's call for the owner's own chat): no second call button", () => {
    const header = read("src/components/chat/v2/pane/pane-header.tsx");
    expect(header).toContain("<CallButton conversationId={header.id}");
    expect(header).toContain("<AssistantCallButton />");
    expect(read("src/components/shell/quick-chat.tsx")).toContain("<CallButton compact");
  });
});

describe("«اجتماع جديد»", () => {
  it("is the button set's tonal button with a lucide video icon, 44 px, the same words", () => {
    const html = draw(createElement(MeetingButton));
    expect(html).toContain(AR["calls.meeting_new"]!);
    expect(html).toContain("lucide-video");
    expect(html).not.toContain("🎥");
    expect(classTokens(html)).toEqual(expect.arrayContaining(["bg-accent/[0.08]", "text-accent", "min-h-11"]));
  });

  it("creates the meeting as before (one call to /api/calls with a video call, then its page)", () => {
    const src = read("src/components/calls/meeting-button.tsx");
    expect(src).toContain('callApi<{ path: string }>("/api/calls", { title: title.trim() || null, video: true })');
    expect(src).toContain("router.push(out.path);");
  });
});

describe("the call entry points use the tokens and logical sides only", () => {
  const FILES = ["src/components/calls/call-button.tsx", "src/components/calls/call-ring.tsx", "src/components/calls/meeting-button.tsx", "src/components/chat/v2/pane/call-bar.tsx", "src/components/site-guide/assistant-call-button.tsx"];

  it("no raw palette colour, no hex, no physical side, no text under 12 px", () => {
    for (const file of FILES) {
      const src = read(file);
      const strings = [...src.matchAll(/"([^"\n]*)"|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? "");
      for (const text of strings) {
        expect(text, `${file}: ${text}`).not.toMatch(PALETTE_COLOUR);
        expect(text, `${file}: ${text}`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(text, `${file}: ${text}`).not.toMatch(/text-\[(?:9|10|11)(?:\.\d+)?px\]/);
        for (const token of text.split(/\s+/)) expect(token.replace(/^[\w-]+:/, ""), `${file}: ${token}`).not.toMatch(PHYSICAL_UTILITY);
      }
    }
  });

  it("the Arabic of the screens stays in the dictionary (no Arabic letter in a class or an emoji in a label)", () => {
    for (const file of ["src/components/calls/call-button.tsx", "src/components/calls/meeting-button.tsx", "src/components/chat/v2/pane/call-bar.tsx"]) expect(read(file)).not.toMatch(/>\s*[📞🎥]\s*</u);
  });
});
