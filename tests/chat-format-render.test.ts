import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// the notification and search paths read the database module and the push door: both are replaced here (no database in a unit test)
const pushNotification = vi.fn(async (_input: unknown) => undefined);
vi.mock("@/server/db", () => ({
  db: {
    conversation: { findUnique: async () => ({ spaceId: "s1", orgId: "o1" }) },
    notification: { findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
  },
}));
vi.mock("@/server/notify", () => ({ pushNotification: (input: unknown) => pushNotification(input) }));
vi.mock("@/server/realtime/viewing", () => ({ isViewing: async () => false }));
vi.mock("@/server/policy/conversation", () => ({ canReadConversation: async () => true }));
vi.mock("@/server/chat/hq", () => ({ hqSpaceId: async () => "hq" }));

import { FormattedText } from "@/lib/chat/format/render";
import { notifyMessageToAudience } from "@/server/chat/notify";
import { snippetOf } from "@/server/chat/search";
import { rowPreview } from "@/lib/chat/row-preview";
import type { ChatRowDto } from "@/lib/chat/cache/types";

(globalThis as { React?: typeof React }).React = React;

/** C3b.1 — the parser's tokens drawn as React elements: the markup of every rule, the safety of links, and the text-out paths that must not show a marker. */
const draw = (body: string) => renderToStaticMarkup(React.createElement(FormattedText, { body }));

describe("each marker is its element", () => {
  it("bold, italic, strike, code, quote, block, spoiler", () => {
    const html = draw("**ب** __م__ ~~ش~~ `k` ||س||\n> اقتباس\n```\nكتلة\n```");
    expect(html).toContain("<strong>ب</strong>");
    expect(html).toContain("<em>م</em>");
    expect(html).toContain("<s>ش</s>");
    expect(html).toContain("<code");
    expect(html).toMatch(/<code[^>]*>k<\/code>/);
    expect(html).toContain("<blockquote");
    expect(html).toContain("اقتباس");
    expect(html).toContain("<pre");
    expect(html).toContain("كتلة");
    expect(html).toContain("data-spoiler");
  });

  it("a spoiler is drawn hidden, as a button that says so, and its words are not read aloud while hidden", () => {
    const html = draw("||سر||");
    expect(html).toContain('data-spoiler="hidden"');
    expect(html).toContain('role="button"');
    expect(html).toContain("aria-hidden");
    expect(html).toContain("invisible");
  });

  it("a plain body is ONE paragraph with exactly its text (the markup the bubble always had)", () => {
    expect(draw("مرحبا\nبالجميع")).toMatch(/^<p class="[^"]*whitespace-pre-wrap[^"]*">مرحبا\nبالجميع<\/p>$/);
  });

  it("an empty body draws nothing", () => {
    expect(draw("")).toBe("");
  });
});

describe("links", () => {
  it("an outside link: https only, opens in a new tab with rel=noopener noreferrer", () => {
    const html = draw("[موقعنا](https://example.com/ar) و https://example.org/x");
    expect(html).toContain('href="https://example.com/ar"');
    expect(html).toContain('href="https://example.org/x"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect((html.match(/<a /g) ?? []).length).toBe(2);
  });

  it("an in-app link opens in the app: no new tab", () => {
    const html = draw("[المحادثة](/chat/c1) [المهمة](/tasks/t9)");
    expect(html).toContain('href="/chat/c1"');
    expect(html).toContain('href="/tasks/t9"');
    expect(html).not.toContain("_blank");
  });

  it("javascript: and data: are plain text, never an href", () => {
    for (const body of ["[x](javascript:alert(1))", "[x](data:text/html;base64,AAAA)", "javascript:alert(1)"]) {
      const html = draw(body);
      expect(html, body).not.toContain("<a ");
      expect(html, body).not.toContain("href=");
    }
  });
});

describe("nothing is ever HTML", () => {
  it("<script> and entities are escaped text", () => {
    const html = draw("<script>alert(1)</script> &lt;b&gt; **<img src=x onerror=alert(1)>**");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;lt;b&amp;gt;");
  });

  it("no source file of the formatter or the bubble body writes innerHTML", () => {
    const roots = ["src/lib/chat/format", "src/components/chat/v2/bubble/bubble-body.tsx", "src/components/chat/v2/composer/format-toolbar.tsx"];
    const files: string[] = [];
    const walk = (p: string) => {
      const full = path.join(process.cwd(), p);
      if (statSync(full).isDirectory()) for (const f of readdirSync(full)) walk(path.join(p, f));
      else files.push(full);
    };
    for (const r of roots) walk(r);
    expect(files.length).toBeGreaterThan(4);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/);
  });
});

describe("math markup the assistant printed", () => {
  it("is shown as plain characters without backslashes, and only in text (a code span keeps its backslashes)", () => {
    const html = draw("النتيجة \\( \\frac{3}{4} \\) و `\\frac{1}{2}`");
    expect(html).toContain("النتيجة 3/4 و");
    expect(html).toContain("\\frac{1}{2}</code>");
    expect(html).not.toMatch(/\\\(|\\\)/);
  });
});

describe("the previews strip the markers", () => {
  const row = (preview: string | null, over: Partial<NonNullable<ChatRowDto["lastMessage"]>> = {}): ChatRowDto =>
    ({
      kind: "DM",
      title: "سلمى",
      unread: 0,
      mentionsUnread: 0,
      lastMessage: { kind: "TEXT", preview, mine: false, authorName: "سلمى", at: "2026-11-16T10:00:00.000Z", ...over },
    }) as unknown as ChatRowDto;

  it("the list row shows words, not markers", () => {
    expect(rowPreview(row("**مهم** و ~~القديم~~ و [الدليل](https://example.com)")).text).toBe("مهم و القديم و الدليل");
  });

  it("an unsent draft too", () => {
    expect(rowPreview(row("x"), { draft: "**مسودة**" })).toMatchObject({ tone: "draft", text: "مسودة" });
  });

  it("a spoiler is not read out in the list", () => {
    expect(rowPreview(row("الرمز ||9876||")).text).toBe("الرمز •••");
  });

  it("math markup is dropped in the list", () => {
    expect(rowPreview(row("\\( 2 \\times 3 \\)")).text).toBe("2 × 3");
  });

  it("a system line is a sentence of its own: not formatted", () => {
    expect(rowPreview(row("غيّر العنوان إلى a__b__c", { kind: "SYSTEM" })).text).toBe("غيّر العنوان إلى a__b__c");
  });

  it("the cut is made AFTER the markers are gone", () => {
    const long = `**${"ك".repeat(150)}**`;
    expect(rowPreview(row(long)).text).toBe("ك".repeat(140));
  });
});

describe("search snippets", () => {
  it("show the words, found the way the search found them", () => {
    expect(snippetOf("راجعوا **العرض** قبل الغد", "العرض")).toBe("راجعوا العرض قبل الغد");
    const long = `${"كلمة ".repeat(40)}**الهدف** ${"كلمة ".repeat(40)}`;
    const snippet = snippetOf(long, "الهدف", 60);
    expect(snippet).toContain("الهدف");
    expect(snippet).not.toContain("*");
  });
});

describe("push notifications", () => {
  it("carry the words, not the markers", async () => {
    pushNotification.mockClear();
    await notifyMessageToAudience({
      conversationId: "c1",
      authorId: "u1",
      audienceIds: ["u2"],
      kind: "TOPIC",
      title: "الطلبات",
      preview: "**عاجل** راجعوا ~~القديم~~ ||1234||",
      messageId: "m1",
      mentionedIds: ["u2"],
    });
    expect(pushNotification).toHaveBeenCalledTimes(1);
    const sent = pushNotification.mock.calls[0]?.[0] as { body: string };
    expect(sent.body).toBe("عاجل راجعوا القديم •••");
  });
});

describe("a spoiler really hides (review fixes)", () => {
  it("the whole subtree is invisible while hidden (a link or a mention inside keeps no colour of its own, cannot be focused, is not read out)", () => {
    const html = draw("||اتصل [أحمد](https://example.com)||");
    expect(html).toMatch(/data-spoiler="hidden"[^>]*>\s*<span aria-hidden="true" class="[^"]*\binvisible\b/);
  });

  it("once shown, a spoiler is plain words (no button around a link or a mention inside it)", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/chat/format/render.tsx"), "utf8");
    const shownBranch = source.slice(source.indexOf("if (shown)"), source.indexOf("data-spoiler=\"hidden\""));
    expect(shownBranch).toContain("data-spoiler=\"shown\"");
    expect(shownBranch).not.toContain("role=");
  });

  it("a spoiler inside a link label is plain text (no button inside an anchor)", () => {
    const html = draw("[a ||b|| c](https://example.com)");
    expect(html).not.toContain("data-spoiler");
    expect(html).toContain("a ||b|| c");
  });
});

describe("a preview that was cut by the server (140 characters) never shows a spoiler's words", () => {
  it("the list row closes the spoiler that lost its closing marker", () => {
    const row = { kind: "DM", title: "x", unread: 0, mentionsUnread: 0, lastMessage: { kind: "TEXT", preview: "الرمز ||98765", mine: false, authorName: "x", at: "2026-11-16T10:00:00.000Z" } } as unknown as ChatRowDto;
    expect(rowPreview(row).text).toBe("الرمز •••");
  });

  it("the push does too", async () => {
    pushNotification.mockClear();
    await notifyMessageToAudience({ conversationId: "c1", authorId: "u1", audienceIds: ["u2"], kind: "TOPIC", title: "t", preview: "كلام ||1234 سري", messageId: "m1", mentionedIds: ["u2"] });
    expect((pushNotification.mock.calls[0]?.[0] as { body: string }).body).toBe("كلام •••");
  });
});
