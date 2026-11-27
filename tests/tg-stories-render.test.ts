import * as React from "react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

(globalThis as { React?: typeof React }).React = React;

import { StoriesRow } from "@/components/chat/v2/stories/stories-row";
import { StoryCameraFab } from "@/components/chat/v2/stories/story-camera-fab";
import { ringsOf } from "@/lib/chat/v2/stories/model";
import type { StoriesFeedDto, StoryDto, StoryPersonDto } from "@/lib/chat/v2/stories/types";
import { FEATURES, FEATURE_DEFAULTS, FEATURE_META, featureOn, featuresOff } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { classTokens, render, textOf } from "./ui-render";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const later = new Date(Date.now() + 3_600_000).toISOString();
const story = (id: string, seen: boolean): StoryDto => ({ id, kind: "IMAGE", url: `/api/stories/${id}/media`, caption: "", createdAt: new Date().toISOString(), expiresAt: later, seen });
const person = (userId: string, name: string, stories: StoryDto[], mine = false): StoryPersonDto => ({ userId, name, avatarUrl: null, mine, stories });
const ME = { userId: "me", name: "أحمد", avatarUrl: null };

const row = (people: StoryPersonDto[], extra: Record<string, unknown> = {}) => {
  const feed: StoriesFeedDto = { me: ME, people };
  return render(React.createElement(StoriesRow, { me: ME, rings: ringsOf(feed, Date.now()), seen: new Set<string>(), onOpen: () => undefined, onAdd: () => undefined, ...extra }));
};

describe("the three switches", () => {
  it("are on by default, in the chat group, each under the switch it needs, and off by their own key alone", () => {
    for (const key of ["stories", "storyCamera", "videoNotes"] as const) {
      expect(FEATURES).toContain(key);
      expect(FEATURE_DEFAULTS[key], key).toBe(true);
      expect(featureOn({}, key), key).toBe(true);
      expect(featuresOff({ features: { [key]: false } }), key).toContain(key);
      expect(AR[`features.${key}.name`], key).toBeTruthy();
      expect(AR[`features.${key}.hint`], key).toBeTruthy();
    }
    expect(FEATURE_META.stories).toEqual({ group: "chat", dependsOn: ["chatLayoutV2"] });
    expect(FEATURE_META.storyCamera).toEqual({ group: "chat", dependsOn: ["stories"] });
    expect(FEATURE_META.videoNotes).toEqual({ group: "chat", dependsOn: ["chatLayoutV2", "voiceNotes"] });
    for (const key of ["stories", "videoNotes"]) expect(AR[`features.${key}.hint`], key).toMatch(/⚠️[\s\S]*🔧/);
  });
});

describe("the row of rings", () => {
  it("draws «قصتك» first, then the unseen, then the seen, each ring saying which it is", () => {
    const html = row([person("b", "ليلى", [story("2", true)]), person("a", "سامر", [story("1", false)])]);
    expect(html).toContain("data-stories-row");
    expect(html.indexOf("data-story-add")).toBeLessThan(html.indexOf('data-story-person="a"'));
    expect(html.indexOf('data-story-person="a"')).toBeLessThan(html.indexOf('data-story-person="b"'));
    expect([...html.matchAll(/data-story-ring="(\w+)"/g)].map((m) => m[1])).toEqual(["none", "unseen", "seen"]);
    expect(textOf(html)).toContain("قصتك");
    expect(html).toContain(AR["tgstories.row.open_unseen"]!.replace("{name}", "سامر"));
  });

  it("with a story of my own: my ring opens it and a separate «+» adds another", () => {
    const html = row([person("me", "أحمد", [story("m", true)], true)]);
    expect(html).toContain("data-story-mine");
    expect(html).toContain("data-story-add");
    expect(html.match(/data-story-ring/g)).toHaveLength(1);
  });

  it("uses theme colours only and Arabic words only", () => {
    const html = row([person("a", "سامر", [story("1", false)])]);
    expect(classTokens(html).filter((c) => /-(?:red|blue|gray|white|black)\b/.test(c))).toEqual([]);
    expect(textOf(html)).not.toMatch(/[A-Za-z]{2,}/);
  });
});

describe("the phone's camera button", () => {
  it("is a button of its own, for a phone's width only", () => {
    const html = render(React.createElement(StoryCameraFab, { onPick: () => undefined }));
    expect(html).toContain("data-story-camera");
    expect(html).toContain(`aria-label="${AR["tgstories.camera"]}"`);
    expect(classTokens(html)).toEqual(expect.arrayContaining(["md:hidden", "absolute", "size-11"]));
  });

  it("stands above the pencil and above Telegram's tab bar, leaves with it on scroll, and the rows keep room to be scrolled clear", () => {
    const css = read("src/components/chat/v2/stories/stories.css");
    const pencil = read("src/components/chat/v2/list/new-message-fab.tsx");
    const phone = read("src/app/tg-phone.css");
    // the pencil: 56 px tall, 1rem from the bottom (5rem under the floating bar)
    expect(pencil).toContain("bottom-[calc(1rem+env(safe-area-inset-bottom))]");
    expect(phone).toMatch(/\[data-tg-phone\]\[data-tg-bar\] \[data-chat-fab\] \{\s*bottom: calc\(5rem \+ env\(safe-area-inset-bottom\)\);/);
    const bottoms = [...css.matchAll(/\[data-story-camera\] \{\s*bottom: calc\(([\d.]+)rem/g)].map((m) => Number(m[1]));
    expect(bottoms).toHaveLength(2);
    expect(bottoms[0]!).toBeGreaterThanOrEqual(1 + 3.5);
    expect(bottoms[1]!).toBeGreaterThanOrEqual(5 + 3.5);
    expect(css).toMatch(/\[data-tg-scrolled\] \[data-story-camera\]/);
    expect(css).toMatch(/\[data-chat-rows\] \{\s*padding-bottom: 8\.5rem/);
    // nothing moves for somebody who asked for less movement
    expect(css.indexOf("animation: zk-story-in")).toBeGreaterThan(css.indexOf("prefers-reduced-motion: no-preference"));
  });
});

describe("where stories reach the screen", () => {
  const layout = read("src/app/(app)/chat/layout.tsx");
  const column = read("src/components/chat/v2/list/chat-list-column.tsx");

  it("the layout never offers them to an external partner, and the camera is a part of them", () => {
    expect(layout).toContain('const stories = !actor.isExternal && (await isFeatureOn(actor.orgId, "stories"));');
    expect(layout).toContain('const storyCamera = stories && (await isFeatureOn(actor.orgId, "storyCamera"));');
    expect(column).toContain("useStories({ enabled: storiesOn === true && !guest");
  });

  it("the viewer is drawn outside the folder-swipe box (a swipe between people must not turn the folder under it)", () => {
    const box = column.indexOf('<div data-folder-swipe=""');
    expect(box).toBeGreaterThan(0);
    expect(column.indexOf("{stories.overlays}")).toBeGreaterThan(column.indexOf("<WorkspaceCreateModal open={creatingSpace}"));
    expect(column.slice(column.indexOf("<WorkspaceCreateModal open={creatingSpace}"), column.indexOf("{stories.overlays}"))).toContain("</div>");
  });

  it("every story route asks the one service, which holds the rule", () => {
    const dir = path.resolve(__dirname, "../src/app/api/stories");
    const routes = (readdirSync(dir, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, "/")).filter((f) => f.endsWith("route.ts"));
    expect(routes.sort()).toEqual(["[id]/media/route.ts", "[id]/route.ts", "[id]/view/route.ts", "[id]/viewers/route.ts", "route.ts"]);
    for (const file of routes) {
      const src = read(`src/app/api/stories/${file}`);
      expect(src, file).toContain('from "@/server/services/stories"');
      expect(src, file).not.toContain('from "@/server/db"');
    }
    expect(read("src/server/services/files.ts")).toContain('if (f.purpose === "STORY") throw new NotFoundError("files.not_found");');
  });

  it("every line the server can refuse with is in the dictionary", () => {
    const service = read("src/server/services/stories.ts");
    const keys = [...service.matchAll(/"((?:stories|chat\.f)\.[a-z_.]+)"/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(4);
    for (const key of keys) expect(AR[key], key).toBeTruthy();
  });

  it("every word of the screens is in the dictionary", () => {
    const files = ["stories-row", "story-camera-fab", "story-compose", "story-viewer"].map((f) => `src/components/chat/v2/stories/${f}.tsx`);
    const missing: string[] = [];
    for (const file of [...files, "src/components/chat/v2/composer/video-note-overlay.tsx", "src/components/chat/v2/bubble/video-note-bubble.tsx", "src/components/chat/v2/composer/composer-surface.tsx"]) {
      for (const m of read(file).matchAll(/"(tgstories\.[a-z_.]+)"/g)) if (!AR[m[1]!] && !AR[`${m[1]}.one`]) missing.push(`${file} ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
