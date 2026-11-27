/**
 * «القصص» — what the server and the screen both know: the limits and the shapes of `GET /api/stories`. Pure.
 *
 * The two size ceilings are the chat's own upload ceilings (`CHAT_LIMITS` in src/server/files/sniff.ts, which a browser cannot import);
 * `tests/tg-stories-model.test.ts` holds the two pairs equal.
 */
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;
export const STORY_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const STORY_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
/** a «short» video: longer is refused at the pick, and the viewer never plays past it */
export const STORY_VIDEO_MAX_MS = 60_000;
/** a recorder or a camera rounds up: a video this much over the cap is still taken */
export const STORY_VIDEO_SLACK_MS = 1000;
export const STORY_CAPTION_MAX = 200;
/** how many stories one person may post in any 24 hours (a deleted one counts: deleting is not a way around the limit) */
export const STORY_MAX_PER_DAY = 30;

export type StoryKind = "IMAGE" | "VIDEO";

export interface StoryDto {
  id: string;
  kind: StoryKind;
  /** the story's own door (`/api/stories/<id>/media`): the only address its file has */
  url: string;
  caption: string;
  createdAt: string;
  expiresAt: string;
  durationMs?: number;
  /** this viewer opened it (their own stories are always seen) */
  seen: boolean;
  /** how many people saw it: on the viewer's OWN stories only */
  views?: number;
}

export interface StoryPersonDto {
  userId: string;
  name: string;
  avatarUrl: string | null;
  mine: boolean;
  /** oldest first: the order they are watched in */
  stories: StoryDto[];
}

export interface StoriesFeedDto {
  me: { userId: string; name: string; avatarUrl: string | null };
  /** only people with at least one story this viewer may see now */
  people: StoryPersonDto[];
}

export interface StoryViewerDto {
  userId: string;
  name: string;
  avatarUrl: string | null;
  viewedAt: string;
}
