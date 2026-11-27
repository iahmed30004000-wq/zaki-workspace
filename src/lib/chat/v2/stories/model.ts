import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { STORY_IMAGE_MAX_BYTES, STORY_VIDEO_MAX_BYTES, STORY_VIDEO_MAX_MS, STORY_VIDEO_SLACK_MS, type StoriesFeedDto, type StoryDto, type StoryKind, type StoryPersonDto } from "./types";

/**
 * «القصص» — what the row of rings and the full-screen viewer decide, with no browser in it (`tests/tg-stories-model.test.ts`).
 */

/** A story whose day ended while the answer sat on the screen is gone, whatever the cache still holds. */
function livePerson(person: StoryPersonDto, now: number): StoryPersonDto | null {
  const stories = person.stories.filter((s) => Date.parse(s.expiresAt) > now);
  if (stories.length === 0) return null;
  return stories.length === person.stories.length ? person : { ...person, stories };
}

export const hasUnseen = (person: StoryPersonDto, seen: ReadonlySet<string> = NONE): boolean => person.stories.some((s) => !s.seen && !seen.has(s.id));
const NONE: ReadonlySet<string> = new Set();
const newest = (person: StoryPersonDto): number => Math.max(...person.stories.map((s) => Date.parse(s.createdAt)));

export interface Rings {
  /** my own stories, or null when I have none up */
  mine: StoryPersonDto | null;
  /** everybody else: the ones with something unseen first, then the rest; inside each, the newest first */
  others: StoryPersonDto[];
}

/** The row's order. `seen`: the stories opened on this screen since the answer came (the ring turns grey at once). */
export function ringsOf(feed: StoriesFeedDto | undefined, now: number, seen: ReadonlySet<string> = NONE): Rings {
  const people = (feed?.people ?? []).flatMap((p) => livePerson(p, now) ?? []);
  const others = people
    .filter((p) => !p.mine)
    .map((person) => ({ person, unseen: hasUnseen(person, seen), at: newest(person) }))
    .sort((a, b) => Number(b.unseen) - Number(a.unseen) || b.at - a.at || a.person.userId.localeCompare(b.person.userId))
    .map((entry) => entry.person);
  return { mine: people.find((p) => p.mine) ?? null, others };
}

/** Where a person's stories start: the first one not seen yet, else the first. */
export function startIndexOf(person: StoryPersonDto, seen: ReadonlySet<string> = NONE): number {
  const at = person.stories.findIndex((s) => !s.seen && !seen.has(s.id));
  return at < 0 ? 0 : at;
}

export interface ViewerPlace {
  person: number;
  story: number;
}
export type ViewerMove = "next" | "prev" | "nextPerson" | "prevPerson";

/**
 * One step of the viewer, or null when it closes. «next» past a person's last story is the next person; past the last person the viewer
 * closes. «prev» before a person's first story is the previous person's LAST; before the very first it stays (the story starts again).
 */
export function stepViewer(people: readonly StoryPersonDto[], at: ViewerPlace, move: ViewerMove, seen: ReadonlySet<string> = NONE): ViewerPlace | null {
  const here = people[at.person];
  if (!here) return null;
  if (move === "next" && at.story + 1 < here.stories.length) return { person: at.person, story: at.story + 1 };
  if (move === "prev" && at.story > 0) return { person: at.person, story: at.story - 1 };
  if (move === "next" || move === "nextPerson") {
    const next = people[at.person + 1];
    return next ? { person: at.person + 1, story: startIndexOf(next, seen) } : null;
  }
  const before = people[at.person - 1];
  if (!before) return { person: at.person, story: 0 };
  return { person: at.person - 1, story: move === "prev" ? before.stories.length - 1 : startIndexOf(before, seen) };
}

export type ViewerGesture = ViewerMove | "close" | "resume";

/**
 * What a finger lifting off the viewer means. A drag down closes; a sideways swipe goes to another person; a finger held still was a
 * pause (it only goes on); a short tap goes on, or back when it lands in the third at the reading start. In right-to-left that third is
 * the right one, «forward» is to the left, and a swipe that moves the finger rightwards brings the next person (as the app's pages turn).
 */
export function releaseOf(input: { dx: number; dy: number; heldMs: number; x: number; width: number; rtl: boolean }): ViewerGesture {
  const { dx, dy, heldMs, x, width, rtl } = input;
  if (dy >= TG_MOTION.storyClosePx && dy > Math.abs(dx)) return "close";
  if (Math.abs(dx) >= TG_MOTION.storySwipePx && Math.abs(dx) > Math.abs(dy)) return (dx > 0) === rtl ? "nextPerson" : "prevPerson";
  if (heldMs >= TG_MOTION.storyHoldMs || Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) return "resume";
  const fromStart = rtl ? width - x : x;
  return fromStart < width / 3 ? "prev" : "next";
}
const TAP_SLOP_PX = 12;

/** The keys of a computer: the arrow that points «forward» is the left one in right-to-left. */
export function keyMoveOf(key: string, rtl: boolean): ViewerMove | "pause" | null {
  if (key === " ") return "pause";
  if (key === "ArrowLeft") return rtl ? "next" : "prev";
  if (key === "ArrowRight") return rtl ? "prev" : "next";
  return null;
}

/** How long a story plays: a picture its fixed time; a video its own length (the player's, else the one stored), never past the cap. */
export function storyLengthMs(story: Pick<StoryDto, "kind" | "durationMs">, playerSeconds?: number): number {
  if (story.kind === "IMAGE") return TG_MOTION.storyImageMs;
  const own = playerSeconds !== undefined && Number.isFinite(playerSeconds) && playerSeconds > 0 ? playerSeconds * 1000 : story.durationMs;
  return Math.min(STORY_VIDEO_MAX_MS, own && own > 0 ? own : STORY_VIDEO_MAX_MS);
}

/** The fill of segment `index` of the bars (0..1) while story `current` is `share` of the way through. */
export function barFill(index: number, current: number, share: number): number {
  if (index < current) return 1;
  if (index > current) return 0;
  return Math.max(0, Math.min(1, share));
}

export type PickProblem = "stories.unsupported" | "stories.too_large" | "stories.video_long";

export function kindOfPick(type: string): StoryKind | null {
  if (/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(type)) return "IMAGE";
  // the server takes MP4 (QuickTime phones included) and WebM; the bytes decide there
  if (/^video\/(mp4|webm|quicktime|x-m4v)$/i.test(type)) return "VIDEO";
  return null;
}

/** What is wrong with a picked file before a byte goes up (the server judges again). `durationMs`: a video's, when the browser could read it. */
export function pickProblem(file: { type: string; size: number }, durationMs?: number): PickProblem | null {
  const kind = kindOfPick(file.type);
  if (!kind) return "stories.unsupported";
  if (kind === "VIDEO" && durationMs !== undefined && Number.isFinite(durationMs) && durationMs > STORY_VIDEO_MAX_MS + STORY_VIDEO_SLACK_MS) return "stories.video_long";
  if (file.size > (kind === "IMAGE" ? STORY_IMAGE_MAX_BYTES : STORY_VIDEO_MAX_BYTES)) return "stories.too_large";
  return null;
}
