import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { isSpaceOnly, mayMeet } from "@/server/policy/space-only";
import { assertFeatureOn } from "@/server/services/features";
import { discardStoredBytes, ingest, openStored } from "@/server/services/files";
import { sniffChatMedia } from "@/server/files/sniff";
import type { ReceivedUpload } from "@/server/files/upload-stream";
import {
  STORY_CAPTION_MAX,
  STORY_IMAGE_MAX_BYTES,
  STORY_MAX_PER_DAY,
  STORY_TTL_MS,
  STORY_VIDEO_MAX_BYTES,
  STORY_VIDEO_MAX_MS,
  STORY_VIDEO_SLACK_MS,
  type StoriesFeedDto,
  type StoryDto,
  type StoryKind,
  type StoryPersonDto,
  type StoryViewerDto,
} from "@/lib/chat/v2/stories/types";

/**
 * «القصص» on the server. A story is a `Story` row over a `StoredFile` of purpose "STORY" (the bytes go through the same sniffer, ceilings and
 * storage as a chat attachment).
 *
 * WHO MAY SEE A STORY — judged on EVERY read, never stored (`storyAuthors` is the one place):
 *  - the viewer and the author are ACTIVE people of the SAME company, and neither is an external partner (GUEST);
 *  - when one of the two works only in its spaces (`OrganizationMember.spaceOnly`), the two may meet (src/server/policy/space-only.ts);
 *  - the story is not deleted, and its 24 hours are not over — except to its author, who may still open the file of an expired one.
 * The owner has no extra door: he sees what the rule above gives him, and opening a story is a view like anybody's.
 * Everything refused is «not found»: an id says nothing about a story the person may not see.
 *
 * The file has ONE address, `GET /api/stories/<id>/media` (`openStoryMedia`); the library's file routes refuse the purpose (`assertMayReadFile`).
 * NOTHING IS HARD-DELETED: expiry and «حذف» only take a story out of the view; the row and the bytes stay, like a deleted chat message's.
 */
export const STORY_PURPOSE = "STORY" as const;

const notFound = () => new NotFoundError("stories.not_found");

/** The door of every story route: the company's switch, and never an external partner. */
export async function assertStoriesDoor(actor: Actor): Promise<void> {
  await assertFeatureOn(actor.orgId, "stories");
  if (actor.role === "GUEST") throw notFound();
}

type AuthorFacts = { name: string; avatarUrl: string | null };

/**
 * THE RULE: which of these people may this viewer see stories of (and, the rule being the same both ways, be seen by)? Only ACTIVE
 * non-guest people of the company; where either side is limited to its spaces, only those the two may meet. The viewer passes for himself.
 */
export async function storyPeople(orgId: string, viewerId: string, userIds: readonly string[]): Promise<Map<string, AuthorFacts>> {
  const ids = [...new Set(userIds)];
  const out = new Map<string, AuthorFacts>();
  if (ids.length === 0) return out;
  const [rows, viewerLimited] = await Promise.all([
    db.organizationMember.findMany({
      where: { organizationId: orgId, userId: { in: ids }, status: "ACTIVE", role: { not: "GUEST" } },
      select: { userId: true, spaceOnly: true, user: { select: { name: true, avatarUrl: true } } },
    }),
    isSpaceOnly(viewerId, orgId),
  ]);
  for (const row of rows) {
    if (row.userId !== viewerId && (viewerLimited || row.spaceOnly) && !(await mayMeet(orgId, viewerId, row.userId))) continue;
    out.set(row.userId, { name: row.user.name, avatarUrl: row.user.avatarUrl });
  }
  return out;
}

const mediaUrl = (id: string) => `/api/stories/${encodeURIComponent(id)}/media`;

/** Everything this person may watch now, grouped by who posted it (oldest first inside a person). The ORDER of the people is the screen's (`ringsOf`). */
export async function storiesFeed(actor: Actor, now: Date = new Date()): Promise<StoriesFeedDto> {
  await assertStoriesDoor(actor);
  const [rows, me] = await Promise.all([
    db.story.findMany({
      where: { orgId: actor.orgId, deletedAt: null, expiresAt: { gt: now } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, authorId: true, kind: true, caption: true, durationMs: true, createdAt: true, expiresAt: true, views: { where: { viewerId: actor.userId }, select: { id: true } } },
    }),
    db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true, avatarUrl: true } }),
  ]);
  const people = await storyPeople(actor.orgId, actor.userId, rows.map((r) => r.authorId));
  const mineViews = await viewCounts(actor, rows.filter((r) => r.authorId === actor.userId).map((r) => r.id));
  const byAuthor = new Map<string, StoryPersonDto>();
  for (const row of rows) {
    const author = people.get(row.authorId);
    if (!author) continue;
    const mine = row.authorId === actor.userId;
    let person = byAuthor.get(row.authorId);
    if (!person) {
      person = { userId: row.authorId, name: author.name, avatarUrl: author.avatarUrl, mine, stories: [] };
      byAuthor.set(row.authorId, person);
    }
    const story: StoryDto = {
      id: row.id,
      kind: row.kind as StoryKind,
      url: mediaUrl(row.id),
      caption: row.caption,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      ...(row.durationMs !== null ? { durationMs: row.durationMs } : {}),
      seen: mine || row.views.length > 0,
      ...(mine ? { views: mineViews.get(row.id) ?? 0 } : {}),
    };
    person.stories.push(story);
  }
  return { me: { userId: actor.userId, name: me.name, avatarUrl: me.avatarUrl }, people: [...byAuthor.values()] };
}

/** The view count of my own stories: the very people `storyViewers` would list (the number and the list never disagree). */
async function viewCounts(actor: Actor, storyIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (storyIds.length === 0) return out;
  const views = await db.storyView.findMany({ where: { storyId: { in: storyIds } }, select: { storyId: true, viewerId: true } });
  const allowed = await storyPeople(actor.orgId, actor.userId, views.map((v) => v.viewerId));
  for (const v of views) if (allowed.has(v.viewerId)) out.set(v.storyId, (out.get(v.storyId) ?? 0) + 1);
  return out;
}

/**
 * The one story this person may open now, or «not found»: of their company, not deleted, its author somebody they may see; and its day not
 * over, unless it is their own (`ownAfterExpiry`).
 */
async function storyFor(actor: Actor, storyId: string, now: Date, ownAfterExpiry: boolean) {
  const story = await db.story.findFirst({ where: { id: storyId, orgId: actor.orgId, deletedAt: null }, select: { id: true, authorId: true, fileId: true, expiresAt: true } });
  if (!story) throw notFound();
  const mine = story.authorId === actor.userId;
  if (story.expiresAt.getTime() <= now.getTime() && !(mine && ownAfterExpiry)) throw notFound();
  if (!(await storyPeople(actor.orgId, actor.userId, [story.authorId])).has(story.authorId)) throw notFound();
  return { ...story, mine };
}

/** The bytes of a story, for the story's own route. */
export async function openStoryMedia(actor: Actor, storyId: string, now: Date = new Date()) {
  await assertStoriesDoor(actor);
  const story = await storyFor(actor, storyId, now, true);
  return openStored(actor.orgId, story.fileId);
}

/** «شافها»: one row per person and story, the first time. My own opening is not a view. */
export async function markStoryViewed(actor: Actor, storyId: string, now: Date = new Date()): Promise<void> {
  await assertStoriesDoor(actor);
  const story = await storyFor(actor, storyId, now, false);
  if (story.mine) return;
  await db.storyView.createMany({ data: [{ storyId: story.id, viewerId: actor.userId, viewedAt: now }], skipDuplicates: true });
}

/** Who saw it: its author's alone (anybody else, the owner included, is refused). Somebody the author may no longer meet is not named. */
export async function storyViewers(actor: Actor, storyId: string, now: Date = new Date()): Promise<StoryViewerDto[]> {
  await assertStoriesDoor(actor);
  const story = await storyFor(actor, storyId, now, true);
  if (!story.mine) throw new ForbiddenError("stories.not_author");
  const views = await db.storyView.findMany({ where: { storyId: story.id }, orderBy: [{ viewedAt: "desc" }, { id: "desc" }], select: { viewerId: true, viewedAt: true } });
  const allowed = await storyPeople(actor.orgId, actor.userId, views.map((v) => v.viewerId));
  return views.flatMap((v) => {
    const person = allowed.get(v.viewerId);
    return person ? [{ userId: v.viewerId, name: person.name, avatarUrl: person.avatarUrl, viewedAt: v.viewedAt.toISOString() }] : [];
  });
}

/** «حذف»: the author takes their own story back. It leaves every view at once; the row and the file stay. */
export async function deleteStory(actor: Actor, storyId: string, now: Date = new Date()): Promise<void> {
  await assertStoriesDoor(actor);
  const story = await storyFor(actor, storyId, now, true);
  if (!story.mine) throw new ForbiddenError("stories.not_author");
  await db.story.updateMany({ where: { id: story.id, deletedAt: null }, data: { deletedAt: now } });
}

export interface NewStory {
  upload: ReceivedUpload;
  caption?: string;
  /** a video's length as the browser measured it */
  durationMs?: number;
}

/** The kind and the stored mime, judged by the bytes: a picture or a video, nothing else. */
function sniffStory(upload: ReceivedUpload): { kind: StoryKind; mime: string } {
  // «FILE» refines nothing: the bytes alone say what it is (and the SVG and HEIC refusals of the chat hold here too)
  const sniffed = sniffChatMedia(upload.prefix, "FILE", upload.name);
  if (!sniffed.ok) throw new ForbiddenError(sniffed.key === "chat.f.heic" ? "chat.f.heic" : "stories.unsupported");
  if (sniffed.kind !== "IMAGE" && sniffed.kind !== "VIDEO") throw new ForbiddenError("stories.unsupported");
  return { kind: sniffed.kind, mime: sniffed.mime };
}

const postedSince = (client: Prisma.TransactionClient | typeof db, authorId: string, now: Date) =>
  client.story.count({ where: { authorId, createdAt: { gt: new Date(now.getTime() - STORY_TTL_MS) } } });

export async function createStory(actor: Actor, input: NewStory, now: Date = new Date()): Promise<{ id: string; expiresAt: string }> {
  await assertStoriesDoor(actor);
  const caption = (input.caption ?? "").trim();
  if ([...caption].length > STORY_CAPTION_MAX) throw new ValidationError([{ path: "caption", message: "stories.caption_long" }]);
  if (input.upload.size === 0) throw new ForbiddenError("files.empty");
  const { kind, mime } = sniffStory(input.upload);
  const limit = kind === "IMAGE" ? STORY_IMAGE_MAX_BYTES : STORY_VIDEO_MAX_BYTES;
  if (input.upload.size > limit) throw new ForbiddenError("stories.too_large");
  const measured = typeof input.durationMs === "number" && Number.isFinite(input.durationMs) && input.durationMs > 0 ? Math.round(input.durationMs) : null;
  if (kind === "VIDEO" && measured !== null && measured > STORY_VIDEO_MAX_MS + STORY_VIDEO_SLACK_MS) throw new ForbiddenError("stories.video_long");
  // asked before the bytes are kept (a refused post writes nothing) and again under the lock (two posts at once cannot pass the limit together)
  if ((await postedSince(db, actor.userId, now)) >= STORY_MAX_PER_DAY) throw new ForbiddenError("stories.too_many");

  const made = await ingest(
    { orgId: actor.orgId, orgRole: actor.role, userId: actor.userId },
    { name: input.upload.name, path: input.upload.path, size: input.upload.size, prefix: input.upload.prefix },
    undefined,
    STORY_PURPOSE,
    undefined,
    { sniffedMime: mime, maxBytes: limit, checksum: await checksumOf(input.upload.path) },
  );
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`story:${actor.userId}`}))`;
      if ((await postedSince(tx, actor.userId, now)) >= STORY_MAX_PER_DAY) throw new ForbiddenError("stories.too_many");
      const expiresAt = new Date(now.getTime() + STORY_TTL_MS);
      const story = await tx.story.create({
        data: { orgId: actor.orgId, authorId: actor.userId, fileId: made.id, kind, caption, durationMs: kind === "VIDEO" && measured !== null ? Math.min(measured, STORY_VIDEO_MAX_MS) : null, createdAt: now, expiresAt },
        select: { id: true },
      });
      return { id: story.id, expiresAt: expiresAt.toISOString() };
    });
  } catch (err) {
    // the file never became a story: it is an upload nobody claimed, and goes as the chat's unclaimed ones do
    const orphan = await db.storedFile.findUnique({ where: { id: made.id }, select: { path: true, meta: true } }).catch(() => null);
    if (orphan) await discardStoredBytes(actor.orgId, orphan);
    await db.storedFile.deleteMany({ where: { id: made.id } }).catch(() => undefined);
    throw err;
  }
}

async function checksumOf(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex").slice(0, 32);
}
