import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(globalThis as { React?: typeof React }).React = React;

import { PinnedBar } from "@/components/chat/v2/pane/pinned-bar";
import { AR } from "@/lib/i18n/dict";
import { FEATURE_DEFAULTS, FEATURE_META } from "@/lib/features";
import { textOf } from "./ui-render";

/** «شكل تيليجرام» (the switch `tgLook`, on by default): the pinned bar counts «رسالة مثبّتة #N» and has a list; the header is a floating glass bar. Off: as it was. */
const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8").replace(/\r\n/g, "\n");
const pins = [
  { id: "m3", authorName: "سارة", preview: "الأحدث" },
  { id: "m2", authorName: "عمر", preview: "الوسط" },
  { id: "m1", authorName: "ليلى", preview: "الأقدم" },
];
const draw = (props: Partial<React.ComponentProps<typeof PinnedBar>>) =>
  renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient(), children: React.createElement(PinnedBar, { pins, onJump: () => undefined, ...props }) }));

describe("the pinned bar", () => {
  it("as it was with the switch off: the label and «i من n», one button, no list", () => {
    const html = draw({ tg: false });
    expect(html).toContain("data-pinned-bar");
    expect(html).not.toContain("data-pinned-tg");
    expect(html).not.toContain("data-pinned-list-open");
    expect(textOf(html)).toContain(AR["chatc.pinbar.label"]);
    expect(textOf(html)).toContain("1 من 3");
  });

  it("Telegram's: «رسالة مثبّتة #N» counted from the oldest (the newest of three is #3), and a button for the list «كل المثبّتات (3)»", () => {
    const html = draw({ tg: true, conversationId: "c1", canUnpinAll: true });
    expect(html).toContain("data-pinned-tg");
    expect(textOf(html)).toContain("رسالة مثبّتة #3");
    expect(textOf(html)).toContain("سارة: الأحدث");
    expect(html).toContain("data-pinned-list-open");
    expect(html).toContain(`aria-label="${AR["chatc.pinbar.all"]!.replace("{n}", "3")}"`);
    expect(textOf(html)).not.toContain("1 من 3");
  });

  it("a single pin is #1 and still has the list; nothing pinned draws nothing", () => {
    expect(textOf(draw({ tg: true, pins: [pins[2]!] }))).toContain("رسالة مثبّتة #1");
    expect(draw({ tg: true, pins: [] })).toBe("");
  });
});

describe("the list, «إلغاء تثبيت الكل» and the glass header", () => {
  it("the unpin-all button exists only for whoever may pin, and it calls the DELETE door of the conversation, then asks the header again", () => {
    const bar = SRC("components/chat/v2/pane/pinned-bar.tsx");
    expect(bar).toMatch(/canUnpinAll \? \(\s*<button[^>]*data-pins-unpin-all/);
    expect(bar).toContain("apiDelete(`/api/chat/conversations/${encodeURIComponent(conversationId)}/pins`)");
    expect(bar).toContain("chatKeys.header(conversationId)");
    expect(bar).toContain("window.confirm(ct(\"chatc.pinbar.unpin_all_confirm\"");
  });

  it("the pane gives the bar the switch and who may pin (a private chat: its people; a topic: the moderators)", () => {
    expect(SRC("components/chat/v2/pane/conversation-pane.tsx")).toContain('tg={header.tgLook !== false} conversationId={header.id} canUnpinAll={header.kind === "DM" || header.me.canModerate}');
  });

  it("the header is a floating rounded glass bar with the switch on, and the old one with it off", () => {
    const head = SRC("components/chat/v2/pane/pane-header.tsx");
    expect(head).toContain('{...(header.tgLook !== false ? { "data-tg-glass": "" } : {})}');
    expect(head).toContain("rounded-2xl");
    expect(head).toContain("backdrop-blur-md");
    // the old class string is still there for the switch off
    expect(head).toContain('"flex min-h-14 items-center gap-2 border-b border-border bg-surface px-2 pt-[env(safe-area-inset-top)] md:px-3 md:pt-0"');
  });

  it("the switch is on by default, in the chat group, needs the new chat screen, and has its words with the ⚠️ and the 🔧", () => {
    expect(FEATURE_DEFAULTS.tgLook).toBe(true);
    expect(FEATURE_META.tgLook).toEqual({ group: "chat", dependsOn: ["chatLayoutV2"] });
    expect(AR["features.tgLook.hint"]).toContain("⚠️");
    expect(AR["features.tgLook.hint"]).toContain("🔧");
  });
});

describe("the rank tag next to a member's name", () => {
  it("owner and space admin and the assistant wear a tag; everybody else none", async () => {
    const { memberTagKeyOf } = await import("@/lib/chat/v2/info/info-model");
    expect(memberTagKeyOf("OWNER")).toBe("chatinfo.tag.owner");
    expect(memberTagKeyOf("ADMIN")).toBe("chatinfo.tag.admin");
    expect(memberTagKeyOf("AI")).toBe("chatinfo.tag.bot");
    for (const role of ["MEMBER", "LEAD", "GUEST", "", undefined]) expect(memberTagKeyOf(role as string | undefined), String(role)).toBeNull();
    for (const key of ["chatinfo.tag.owner", "chatinfo.tag.admin", "chatinfo.tag.bot"]) expect(AR[key], key).toBeTruthy();
  });

  it("the members tab draws it only with the switch (header `tgLook`)", () => {
    const tabs = SRC("components/chat/v2/info/info-tabs.tsx");
    expect(tabs).toContain("tags={header.tgLook !== false}");
    expect(tabs).toContain("tags && memberTagKeyOf(m.role)");
    expect(tabs).toContain("data-member-tag={m.role}");
  });
});
