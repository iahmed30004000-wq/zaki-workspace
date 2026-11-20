import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/share",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { SharePickerView, ShareEmpty } from "@/components/pwa/share-picker";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { appendSharedText, firstParam, safeShareUrl, sharedTextFrom, SHARE_TEXT_MAX } from "@/lib/pwa/share";
import { canShareTo, shareTargetsOf, spaceTargetsOf } from "@/lib/pwa/share-targets";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("the words of a share", () => {
  it("title, text and address in that order, each only when it adds something", () => {
    expect(sharedTextFrom({ title: "عنوان", text: "كلام", url: "https://example.com/a" })).toBe("عنوان\nكلام\nhttps://example.com/a");
    // Android's share sheet puts the address in the text too
    expect(sharedTextFrom({ title: "مقال", text: "مقال https://example.com/a", url: "https://example.com/a" })).toBe("مقال https://example.com/a");
    expect(sharedTextFrom({ title: "نفس الكلام", text: "نفس الكلام", url: "" })).toBe("نفس الكلام");
    expect(sharedTextFrom({ title: "سطر", text: "سطر وكمان" })).toBe("سطر وكمان");
  });

  it("nothing at all shares as an empty string, whitespace and nulls included", () => {
    expect(sharedTextFrom({})).toBe("");
    expect(sharedTextFrom({ title: "  ", text: null, url: undefined })).toBe("");
  });

  it("an address is kept only when it is http or https: javascript:, data:, a bare word and junk are dropped", () => {
    expect(safeShareUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeShareUrl("http://example.com")).toBe("http://example.com/");
    for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "example.com", "intent://x#Intent;end", "", "  "]) expect(safeShareUrl(bad), bad).toBe("");
    expect(sharedTextFrom({ url: "javascript:alert(1)" })).toBe("");
  });

  it("control characters are removed (a tab and a newline stay) and the length is the composer draft's", () => {
    expect(sharedTextFrom({ text: "a\u0000b\u0007c\td\ne" })).toBe("abc\td\ne");
    expect(sharedTextFrom({ text: "x".repeat(SHARE_TEXT_MAX + 500) })).toHaveLength(SHARE_TEXT_MAX);
  });

  it("a repeated parameter counts by its first value", () => {
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam("a")).toBe("a");
    expect(firstParam(undefined)).toBeNull();
    expect(firstParam([])).toBeNull();
  });

  it("is added AFTER what the person had already typed in that conversation, never over it, and never twice", () => {
    expect(appendSharedText("", "الكلام")).toBe("الكلام");
    expect(appendSharedText(null, "الكلام")).toBe("الكلام");
    expect(appendSharedText("كنت عم أكتب   ", "الكلام")).toBe("كنت عم أكتب\nالكلام");
    expect(appendSharedText("كنت عم أكتب\nالكلام", "الكلام")).toBe("كنت عم أكتب\nالكلام");
    expect(appendSharedText("مسودة", "")).toBe("مسودة");
    expect(appendSharedText("y".repeat(SHARE_TEXT_MAX - 5), "z".repeat(50))).toHaveLength(SHARE_TEXT_MAX);
  });
});

const row = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto =>
  ({ id, kind: "DM", title: id, emoji: null, space: null, lastMessage: null, unread: 0, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, markedUnread: false, restricted: false, ...over }) as ChatRowDto;
const shape = { scope: "all", spaceId: null } as const;

describe("which conversations «ابعت لـ…» offers", () => {
  const rows = [
    row("أحمد"),
    row("فريق المبيعات", { kind: "GROUP" }),
    row("إعلانات", { kind: "TOPIC", closed: true }),
    row("نقاش", { kind: "TOPIC" }),
    row("النظام", { kind: "DM", system: true }),
    row("مساحة المبيعات", { kind: "SPACE" }),
    row("قديمة", { archivedByMe: true }),
  ];

  it("a private chat, a group, a topic and a space (which opens its topics); not a closed topic, a system chat or an archived one", () => {
    expect(shareTargetsOf(rows, shape, "").map((r) => r.id)).toEqual(["أحمد", "فريق المبيعات", "نقاش", "مساحة المبيعات"]);
    expect(canShareTo({ kind: "TOPIC", closed: true, system: false })).toBe(false);
  });

  it("the typed words narrow it, spelling-tolerant («احمد» finds «أحمد»)", () => {
    expect(shareTargetsOf(rows, shape, "احمد").map((r) => r.id)).toEqual(["أحمد"]);
    expect(shareTargetsOf(rows, shape, "zzz")).toEqual([]);
  });

  it("the topics of one space never include the space itself", () => {
    expect(spaceTargetsOf([row("موضوع 1", { kind: "TOPIC" }), row("المساحة", { kind: "SPACE" }), row("موضوع مقفل", { kind: "TOPIC", closed: true })], "").map((r) => r.id)).toEqual(["موضوع 1"]);
  });
});

const noop = () => undefined;
const view = (over: Partial<React.ComponentProps<typeof SharePickerView>> = {}) =>
  renderToStaticMarkup(
    React.createElement(SharePickerView, { text: "https://example.com/a\nاقرا هاد", rows: [], state: "ready", query: "", onQuery: noop, onPick: noop, onRetry: noop, space: null, onBack: noop, ...over }),
  );

describe("the page", () => {
  it("shows «ابعت لـ…», the words that will wait in the composer, and says it never sends by itself", () => {
    const html = view({ rows: [row("أحمد"), row("نقاش", { kind: "TOPIC", emoji: "💬", space: { id: "s", name: "المبيعات" } })] });
    expect(html).toContain("ابعت لـ…");
    expect(html).toContain("اقرا هاد");
    expect(html).toContain("ما بينبعت لحاله");
    expect(html).toContain("أحمد");
    expect(html).toContain("المبيعات");
    expect(html).toContain('data-share-row="DM"');
    expect(html).toContain('data-share-row="TOPIC"');
  });

  it("a space row says it opens its topics; inside a space the heading is its name and there is a way back", () => {
    expect(view({ rows: [row("المبيعات", { kind: "SPACE" })] })).toContain("مواضيع هالمساحة");
    const inside = view({ rows: [row("موضوع", { kind: "TOPIC" })], space: { name: "المبيعات" } });
    expect(inside).toContain("<h1");
    expect(inside).toContain("المبيعات");
    expect(inside).toContain("رجوع للمحادثات");
  });

  it("loading, failing and an empty list each say so; an empty search says nothing matched", () => {
    expect(view({ state: "loading" })).toContain("عم نجيب المحادثات");
    const failed = view({ state: "error" });
    expect(failed).toContain("ما قدرنا نجيب المحادثات");
    expect(failed).toContain("جرّب مرة تانية");
    expect(view()).toContain("ما في محادثات تبعت إلها");
    expect(view({ query: "xyz" })).toContain("ما لقينا محادثة بهالاسم");
  });

  it("the words are shown as TEXT: a shared string that looks like markup is escaped", () => {
    const html = view({ text: '<img src=x onerror="alert(1)"> <script>alert(2)</script>' });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
  });

  it("with nothing to share it says so and points at the chat", () => {
    const html = renderToStaticMarkup(React.createElement(ShareEmpty));
    expect(html).toContain("ما في شي للمشاركة");
    expect(html).toContain('href="/chat"');
  });
});

describe("it NEVER sends by itself", () => {
  it("the picker and the page only write a draft and navigate: no message post, no outbox, no optimistic send, no fetch", () => {
    for (const file of ["src/components/pwa/share-picker.tsx", "src/app/share/page.tsx", "src/lib/pwa/share.ts", "src/lib/pwa/share-targets.ts"]) {
      const text = read(file);
      expect(text, file).not.toMatch(/postChatMessage|startOptimisticSend|Outbox|\/messages|\bfetch\(|sendMessage|XMLHttpRequest|sendBeacon/);
    }
    const picker = read("src/components/pwa/share-picker.tsx");
    expect(picker).toContain("saveComposerDraft(");
    expect(picker).toContain("router.push(chatHref.conversation(");
  });

  it("the page needs a signed-in person and reads only title, text and url from the address", () => {
    const page = read("src/app/share/page.tsx");
    expect(page).toContain("await pageActor()");
    expect(page).toContain('searchParams["title"]');
    expect(page).toContain('searchParams["text"]');
    expect(page).toContain('searchParams["url"]');
    expect(page).toContain('dynamic = "force-dynamic"');
  });
});
