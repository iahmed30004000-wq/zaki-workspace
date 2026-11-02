import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// the window calls useQuery and reads the dictionary, like the people dock: no router of its own
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

(globalThis as { React?: typeof React }).React = React;

import { QuickChat, type QuickChatPeopleDto } from "@/components/shell/quick-chat";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

/**
 * The floating quick chat (the owner's ask, 2026-10-30): «اريد على خانة اليسار تحت يكون في خيار اسمه
 * الدردشة … وبس تضغط على عضو تفتح خانة الدردشة وتكون خانة عائمة». These pin what the corner promises:
 * one round button, the WHOLE company behind it, a colleague of another space marked instead of a
 * dead button, and the colours of the theme — never another palette and never another library.
 */

const PEOPLE: QuickChatPeopleDto = {
  people: [
    { userId: "u1", role: "MEMBER", inSpace: true, online: true, user: { id: "u1", name: "سلمى عبيد", jobTitle: "محاسبة", avatarUrl: null } },
    { userId: "u2", role: "MEMBER", inSpace: true, online: false, user: { id: "u2", name: "ليان مراد", jobTitle: null, avatarUrl: null } },
    { userId: "u3", role: "ADMIN", inSpace: false, online: true, user: { id: "u3", name: "أحمد زكي", jobTitle: "مدير", avatarUrl: null } },
  ],
};

function html(data: QuickChatPeopleDto | null, props: { enabled?: boolean; defaultOpen?: boolean } = {}): string {
  const client = new QueryClient();
  if (data) client.setQueryData(["quick-chat-people"], data);
  return renderToStaticMarkup(
    createElement(
      Translations,
      { initial: "ar" },
      createElement(Queries, { client }, createElement(QuickChat, { enabled: props.enabled ?? true, defaultOpen: props.defaultOpen ?? false })),
    ),
  );
}

describe("the floating quick chat", () => {
  it("closed, it is one round button in the corner that names itself in Arabic", () => {
    const out = html(PEOPLE);
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain(`aria-label="${AR["quickChat.open"]}"`);
    // the panel is not in the HTML until it is opened
    expect(out).not.toContain(AR["quickChat.search"]!);
    // it sits above the phone's bar, in the PHYSICAL left corner the owner asked for («اليسار تحت»): in an
    // RTL screen that is `end`, and `start` would put it on the right. The call's mini window uses the same.
    expect(out).toContain("bottom-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))]");
    expect(out).toContain("end-3");
    expect(out).not.toMatch(/\bstart-3\b/);
    expect(out).toContain("items-end");
  });

  it("open, it lists the whole company — the online first as they came — with the other space marked", () => {
    const out = html(PEOPLE, { defaultOpen: true });
    expect(out).toContain(AR["quickChat.title"]!);
    expect(out).toContain("سلمى عبيد");
    expect(out).toContain("ليان مراد");
    // a colleague of another space is still listed, marked, so the button never only refuses
    expect(out).toContain("أحمد زكي");
    expect(out).toContain(AR["quickChat.other_space_badge"]!);
    // the online dot and the accent are the theme's tokens, never a palette colour
    expect(out).toContain("bg-ok");
    expect(out).toContain("bg-accent");
    expect(out).not.toMatch(/\b(?:indigo|violet|purple|zinc|neutral)-\d{2,3}\b/);
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // a person with no job title still reads as a colleague
    expect(out).toContain(AR["shell.dock.no_title"]!);
  });

  it("draws nothing at all when the company's switch is off or the person is a guest", () => {
    expect(html(PEOPLE, { enabled: false })).toBe("");
  });

  it("speaks to the same doors as the chat: the company directory, the DM, and the conversation's messages", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "src/components/shell/quick-chat.tsx"), "utf8");
    expect(source).toContain('"/api/chat/directory?scope=company"');
    expect(source).toContain('"/api/chat/dm"');
    expect(source).toContain("/api/chat/conversations/${vars.id}/messages");
    expect(source).toContain("refetchInterval: 4_000");
    // no new dependency: the movement is CSS
    expect(source).not.toMatch(/framer-motion|@radix-ui/);
  });

  it("is mounted by the shell, behind its switch, never for a guest and never over the chat page itself", () => {
    const shell = readFileSync(path.resolve(__dirname, "..", "src/components/app-shell.tsx"), "utf8");
    expect(shell).toMatch(/<QuickChat enabled=\{!isGuest && quickChat && place\?\.key !== "chat"\} \/>/);
    const layout = readFileSync(path.resolve(__dirname, "..", "src/app/(app)/layout.tsx"), "utf8");
    expect(layout).toContain("quickChat={on.quickChat}");
  });

  it("every line the window says exists in Arabic", () => {
    for (const key of [
      "quickChat.open",
      "quickChat.close",
      "quickChat.title",
      "quickChat.subtitle",
      "quickChat.search",
      "quickChat.empty",
      "quickChat.no_result",
      "quickChat.other_space",
      "quickChat.other_space_badge",
      "quickChat.back",
      "quickChat.open_full",
      "quickChat.profile",
      "quickChat.loading",
      "quickChat.no_messages",
      "quickChat.deleted",
      "quickChat.messages",
      "quickChat.placeholder",
      "quickChat.send",
      "quickChat.failed",
      "quickChat.open_failed",
      "quickChat.online",
      "quickChat.offline",
    ]) {
      expect(AR[key], key).toMatch(/[\u0600-\u06FF]/);
    }
  });
});

describe("the private chat's own buttons (the owner, 2026-11-02)", () => {
  const src = readFileSync(path.resolve(__dirname, "../src/components/shell/quick-chat.tsx"), "utf8");

  it("the head of an open private chat has a call, the whole conversation and the person's page, beside the name", () => {
    const head = src.slice(src.indexOf("{peer ? ("), src.indexOf("quickChat.close"));
    expect(head).toContain("<CallButton compact");
    expect(head).toContain("/chat/${encodeURIComponent(conversationId)}");
    expect(head).toContain("/u/${encodeURIComponent(peer.userId)}");
  });

  it("the call asks the same questions the chat page asks: calls switched off or no right to call hides it", () => {
    expect(src).toContain("conversationQuery.data.calls !== false");
    expect(src).toContain("conversationQuery.data.me.canCall !== false");
  });
});

