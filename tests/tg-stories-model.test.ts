import { describe, expect, it } from "vitest";
import { barFill, hasUnseen, keyMoveOf, kindOfPick, pickProblem, releaseOf, ringsOf, startIndexOf, stepViewer, storyLengthMs } from "@/lib/chat/v2/stories/model";
import { storyImageSize } from "@/lib/chat/v2/stories/prepare";
import { STORY_IMAGE_MAX_BYTES, STORY_TTL_MS, STORY_VIDEO_MAX_BYTES, STORY_VIDEO_MAX_MS, type StoriesFeedDto, type StoryDto, type StoryPersonDto } from "@/lib/chat/v2/stories/types";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { CHAT_LIMITS } from "@/server/files/sniff";

const NOW = Date.parse("2026-11-27T12:00:00.000Z");

function story(id: string, minutesAgo: number, seen = false, over: Partial<StoryDto> = {}): StoryDto {
  const at = NOW - minutesAgo * 60_000;
  return { id, kind: "IMAGE", url: `/api/stories/${id}/media`, caption: "", createdAt: new Date(at).toISOString(), expiresAt: new Date(at + STORY_TTL_MS).toISOString(), seen, ...over };
}
const person = (userId: string, stories: StoryDto[], mine = false): StoryPersonDto => ({ userId, name: userId, avatarUrl: null, mine, stories });
const feed = (people: StoryPersonDto[]): StoriesFeedDto => ({ me: { userId: "me", name: "me", avatarUrl: null }, people });

describe("the limits", () => {
  it("are the chat's own upload ceilings, a day and a minute", () => {
    expect(STORY_IMAGE_MAX_BYTES).toBe(CHAT_LIMITS.IMAGE);
    expect(STORY_VIDEO_MAX_BYTES).toBe(CHAT_LIMITS.VIDEO);
    expect(STORY_TTL_MS).toBe(86_400_000);
    expect(STORY_VIDEO_MAX_MS).toBe(60_000);
  });
});

describe("the row of rings", () => {
  it("keeps mine apart, puts the unseen first, and the newest first inside each group", () => {
    const rings = ringsOf(
      feed([
        person("seen-new", [story("a", 1, true)]),
        person("unseen-old", [story("b", 600)]),
        person("me", [story("m", 5, true)], true),
        person("unseen-new", [story("c", 900, true), story("d", 10)]),
        person("seen-old", [story("e", 300, true)]),
      ]),
      NOW,
    );
    expect(rings.mine?.userId).toBe("me");
    expect(rings.others.map((p) => p.userId)).toEqual(["unseen-new", "unseen-old", "seen-new", "seen-old"]);
  });

  it("turns a ring grey as soon as its stories were opened on this screen, and moves it behind the unseen", () => {
    const people = [person("a", [story("1", 1)]), person("b", [story("2", 50)])];
    expect(ringsOf(feed(people), NOW).others.map((p) => p.userId)).toEqual(["a", "b"]);
    const seen = new Set(["1"]);
    expect(hasUnseen(people[0]!, seen)).toBe(false);
    expect(ringsOf(feed(people), NOW, seen).others.map((p) => p.userId)).toEqual(["b", "a"]);
  });

  it("drops a story whose 24 hours ended while the answer sat on the screen, and the person with nothing left", () => {
    const rings = ringsOf(feed([person("a", [story("old", 24 * 60 + 1), story("new", 3)]), person("b", [story("gone", 24 * 60)]), person("me", [story("mine-old", 25 * 60)], true)]), NOW);
    expect(rings.mine).toBeNull();
    expect(rings.others).toHaveLength(1);
    expect(rings.others[0]!.stories.map((s) => s.id)).toEqual(["new"]);
    expect(ringsOf(undefined, NOW)).toEqual({ mine: null, others: [] });
  });
});

describe("walking through the viewer", () => {
  const people = [person("a", [story("a1", 3, true), story("a2", 2)]), person("b", [story("b1", 5), story("b2", 4)])];

  it("starts at the first story not seen yet, else at the first", () => {
    expect(startIndexOf(people[0]!)).toBe(1);
    expect(startIndexOf(person("x", [story("1", 1, true)]))).toBe(0);
  });

  it("goes on through a person, then to the next person, then closes", () => {
    expect(stepViewer(people, { person: 0, story: 0 }, "next")).toEqual({ person: 0, story: 1 });
    expect(stepViewer(people, { person: 0, story: 1 }, "next")).toEqual({ person: 1, story: 0 });
    expect(stepViewer(people, { person: 1, story: 1 }, "next")).toBeNull();
    expect(stepViewer(people, { person: 1, story: 0 }, "nextPerson")).toBeNull();
    expect(stepViewer(people, { person: 0, story: 0 }, "nextPerson")).toEqual({ person: 1, story: 0 });
  });

  it("goes back inside a person, then to the person before at their last story; at the very first it stays", () => {
    expect(stepViewer(people, { person: 1, story: 1 }, "prev")).toEqual({ person: 1, story: 0 });
    expect(stepViewer(people, { person: 1, story: 0 }, "prev")).toEqual({ person: 0, story: 1 });
    expect(stepViewer(people, { person: 0, story: 0 }, "prev")).toEqual({ person: 0, story: 0 });
    expect(stepViewer(people, { person: 1, story: 1 }, "prevPerson")).toEqual({ person: 0, story: 1 });
  });
});

describe("the finger on a story, right to left", () => {
  const lift = (over: Partial<Parameters<typeof releaseOf>[0]>) => releaseOf({ dx: 0, dy: 0, heldMs: 60, x: 100, width: 390, rtl: true, ...over });

  it("a short tap goes on, and back in the third at the reading start (the right)", () => {
    expect(lift({ x: 40 })).toBe("next");
    expect(lift({ x: 200 })).toBe("next");
    expect(lift({ x: 300 })).toBe("prev");
    expect(lift({ x: 40, rtl: false })).toBe("prev");
  });

  it("a finger that was held was a pause: it only goes on", () => {
    expect(lift({ heldMs: TG_MOTION.storyHoldMs })).toBe("resume");
    expect(lift({ heldMs: 4000, x: 350 })).toBe("resume");
    // a small slide is neither a tap nor a swipe
    expect(lift({ dx: 30 })).toBe("resume");
  });

  it("a sideways swipe changes the person (rightwards is the next one), a drag down closes", () => {
    expect(lift({ dx: TG_MOTION.storySwipePx })).toBe("nextPerson");
    expect(lift({ dx: -120 })).toBe("prevPerson");
    expect(lift({ dx: -120, rtl: false })).toBe("nextPerson");
    expect(lift({ dy: TG_MOTION.storyClosePx, dx: 20 })).toBe("close");
    expect(lift({ dy: -200 })).toBe("resume");
  });

  it("on a computer the left arrow goes on, the right one back, the space bar pauses", () => {
    expect(keyMoveOf("ArrowLeft", true)).toBe("next");
    expect(keyMoveOf("ArrowRight", true)).toBe("prev");
    expect(keyMoveOf(" ", true)).toBe("pause");
    expect(keyMoveOf("a", true)).toBeNull();
  });
});

describe("the clock and the bars", () => {
  it("a picture has its fixed time; a video its own length, never past a minute", () => {
    expect(storyLengthMs({ kind: "IMAGE" })).toBe(TG_MOTION.storyImageMs);
    expect(storyLengthMs({ kind: "VIDEO", durationMs: 12_000 })).toBe(12_000);
    expect(storyLengthMs({ kind: "VIDEO", durationMs: 12_000 }, 9)).toBe(9000);
    // a recorder's file often says «infinite»: the stored length stands in, and with neither the cap
    expect(storyLengthMs({ kind: "VIDEO", durationMs: 12_000 }, Infinity)).toBe(12_000);
    expect(storyLengthMs({ kind: "VIDEO" }, Infinity)).toBe(STORY_VIDEO_MAX_MS);
    expect(storyLengthMs({ kind: "VIDEO" }, 600)).toBe(STORY_VIDEO_MAX_MS);
  });

  it("fills the bars before the current one, none after it, and the current one by its share", () => {
    expect([0, 1, 2].map((i) => barFill(i, 1, 0.25))).toEqual([1, 0.25, 0]);
    expect(barFill(1, 1, 7)).toBe(1);
  });
});

describe("what may be picked", () => {
  it("a picture or a video, inside the ceilings, a video of a minute at most", () => {
    expect(kindOfPick("image/jpeg")).toBe("IMAGE");
    expect(kindOfPick("video/quicktime")).toBe("VIDEO");
    expect(kindOfPick("image/svg+xml")).toBeNull();
    expect(kindOfPick("audio/mpeg")).toBeNull();
    expect(pickProblem({ type: "application/pdf", size: 10 })).toBe("stories.unsupported");
    expect(pickProblem({ type: "image/png", size: STORY_IMAGE_MAX_BYTES + 1 })).toBe("stories.too_large");
    expect(pickProblem({ type: "video/mp4", size: STORY_VIDEO_MAX_BYTES + 1 })).toBe("stories.too_large");
    expect(pickProblem({ type: "video/mp4", size: 10 }, 75_000)).toBe("stories.video_long");
    expect(pickProblem({ type: "video/mp4", size: 10 }, 60_400)).toBeNull();
    expect(pickProblem({ type: "video/webm", size: 10 }, undefined)).toBeNull();
  });

  it("a picture is drawn again no bigger than 1920 on its longest side, and never enlarged", () => {
    expect(storyImageSize(4000, 3000)).toEqual({ width: 1920, height: 1440 });
    expect(storyImageSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(storyImageSize(1080, 2400)).toEqual({ width: 864, height: 1920 });
  });
});
