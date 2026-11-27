import { db } from "@/server/db";
import { ForbiddenError, type OrgAccessContext } from "@/server/auth";
import type { ArchiveItemDto, ArchivePageDto, ArchiveType } from "@/server/chat/dto";
import { logChat } from "@/server/chat/moderation";
import { attachmentView } from "@/server/chat/attachments";
import { holdsArchiveView } from "./archive-access";

/**
 * The archive: the OWNER's record of what happened — deleted messages (with the text that was
 * deleted and who deleted it), edits (the version before each edit), moderation acts, and closed
 * topics. Nobody else reads it: `canArchive` is OWNER only.
 *
 * Pagination uses one total order across all four event streams: event time descending, id
 * descending, then kind ascending. Every source applies that composite boundary in SQL. Reading
 * the archive is itself an audited act.
 */

export const archiveQuerySchema = {
  type: ["deleted", "edited", "moderation", "closed"] as ArchiveType[],
};

const PAGE = 40;

export interface ArchiveFilterOptions {
  people: Array<{ id: string; name: string }>;
  spaces: Array<{ id: string; name: string }>;
}

export async function readArchiveFilterOptions(ctx: OrgAccessContext): Promise<ArchiveFilterOptions> {
  if (!(await holdsArchiveView(ctx))) throw new ForbiddenError("chat.e.archive_denied");
  const [members, spaces] = await Promise.all([
    db.organizationMember.findMany({
      where: { organizationId: ctx.orgId, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    db.workspace.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const uniquePeople = new Map(members.map(({ user }) => [user.id, user.name]));
  return { people: [...uniquePeople].map(([id, name]) => ({ id, name })), spaces };
}

export async function readArchive(
  ctx: OrgAccessContext,
  opts: { type?: ArchiveType; spaceId?: string; personId?: string; from?: string; to?: string; cursor?: string; limit?: number } = {},
): Promise<ArchivePageDto> {
  if (!(await holdsArchiveView(ctx))) throw new ForbiddenError("chat.e.archive_denied");

  const limit = Math.min(Math.max(opts.limit ?? PAGE, 1), 100);
  const cursor = parseCursor(opts.cursor);
  const from = opts.from ? new Date(`${opts.from}T00:00:00.000Z`) : undefined;
  const to = opts.to ? new Date(`${opts.to}T23:59:59.999Z`) : undefined;
  const eventRange = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;

  const wantDeleted = !opts.type || opts.type === "deleted";
  const wantEdited = !opts.type || opts.type === "edited";
  const wantModeration = !opts.type || opts.type === "moderation";
  const wantClosed = !opts.type || opts.type === "closed";

  const items: ArchiveItemDto[] = [];

  if (wantDeleted) {
    const rows = await db.chatMessage.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: { not: null, ...(eventRange ?? {}) },
        ...(opts.personId ? { authorId: opts.personId } : {}),
        ...(opts.spaceId ? { conversation: { spaceId: opts.spaceId } } : {}),
        ...(cursor ? { OR: cursorWhere(cursor, "deleted", "deletedAt") } : {}),
      },
      orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        body: true,
        authorId: true,
        conversationId: true,
        deletedAt: true,
        author: { select: { name: true } },
        deletedBy: { select: { name: true } },
        conversation: { select: { spaceId: true, space: { select: { name: true } } } },
      },
    });
    for (const r of rows.slice(0, limit)) {
      items.push({
        type: "deleted",
        id: r.id,
        conversationId: r.conversationId,
        spaceId: r.conversation.spaceId,
        spaceName: r.conversation.space?.name ?? null,
        messageId: r.id,
        body: r.body, // the OWNER sees what was deleted
        authorId: r.authorId,
        authorName: r.author.name,
        at: r.deletedAt!.toISOString(),
        deletedByName: r.deletedBy?.name ?? null,
        deletedAt: r.deletedAt!.toISOString(),
      });
    }
  }

  if (wantEdited) {
    const rows = await db.chatMessage.findMany({
      where: {
        orgId: ctx.orgId,
        editedAt: { not: null, ...(eventRange ?? {}) },
        ...(opts.personId ? { authorId: opts.personId } : {}),
        deletedAt: null,
        ...(opts.spaceId ? { conversation: { spaceId: opts.spaceId } } : {}),
        ...(cursor ? { OR: cursorWhere(cursor, "edited", "editedAt") } : {}),
      },
      orderBy: [{ editedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        body: true,
        authorId: true,
        conversationId: true,
        editedAt: true,
        author: { select: { name: true } },
        conversation: { select: { spaceId: true, space: { select: { name: true } } } },
        revisions: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
        replacedFiles: { orderBy: [{ replacedAt: "desc" }, { position: "asc" }], take: 20, include: { file: { select: { id: true, name: true, mimeType: true, size: true } } } },
      },
    });
    for (const r of rows.slice(0, limit)) {
      items.push({
        type: "edited",
        id: r.id,
        conversationId: r.conversationId,
        spaceId: r.conversation.spaceId,
        spaceName: r.conversation.space?.name ?? null,
        messageId: r.id,
        body: r.body,
        previousBody: r.revisions[0]?.body ?? null,
        ...(r.replacedFiles.length ? { oldFiles: r.replacedFiles.map((f) => attachmentView(f)) } : {}),
        authorId: r.authorId,
        authorName: r.author.name,
        at: r.editedAt!.toISOString(),
      });
    }
  }

  if (wantModeration) {
    const rows = await db.auditLog.findMany({
      where: {
        orgId: ctx.orgId,
        action: { startsWith: "chat." },
        ...(opts.spaceId ? { workspaceId: opts.spaceId } : {}),
        ...((opts.personId || cursor) ? { AND: [
          ...(opts.personId ? [{ OR: [{ actorId: opts.personId }, { target: opts.personId }] }] : []),
          ...(cursor ? [{ OR: cursorWhere(cursor, "moderation", "createdAt") }] : []),
        ] } : {}),
        ...(eventRange ? { createdAt: eventRange } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => !!v))];
    const targetIds = [...new Set(rows.map((r) => r.target).filter((v): v is string => !!v))];
    const users = await db.user.findMany({ where: { id: { in: [...new Set([...actorIds, ...targetIds])] } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const spaceIds = [...new Set(rows.map((r) => r.workspaceId).filter((v): v is string => !!v))];
    const spaces = await db.workspace.findMany({ where: { id: { in: spaceIds }, organizationId: ctx.orgId }, select: { id: true, name: true } });
    const spaceNameOf = new Map(spaces.map((space) => [space.id, space.name]));
    for (const r of rows.slice(0, limit)) {
      items.push({
        type: "moderation",
        id: r.id,
        conversationId: r.conversationId,
        spaceId: r.workspaceId,
        spaceName: r.workspaceId ? (spaceNameOf.get(r.workspaceId) ?? null) : null,
        action: r.action,
        actorName: r.actorId ? (nameOf.get(r.actorId) ?? "") : "",
        targetName: r.target ? (nameOf.get(r.target) ?? "") : null,
        meta: (r.meta as Record<string, unknown> | null) ?? null,
        at: r.createdAt.toISOString(),
      });
    }
  }

  if (wantClosed && !opts.personId) {
    const rows = await db.conversation.findMany({
      where: {
        orgId: ctx.orgId,
        kind: "TOPIC",
        closedAt: { not: null, ...(eventRange ?? {}) },
        ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
        ...(cursor ? { OR: cursorWhere(cursor, "closed", "closedAt") } : {}),
      },
      orderBy: [{ closedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, title: true, spaceId: true, closedAt: true, space: { select: { name: true } } },
    });
    for (const r of rows.slice(0, limit)) {
      items.push({
        type: "closed",
        id: r.id,
        conversationId: r.id,
        spaceId: r.spaceId,
        spaceName: r.space?.name ?? null,
        title: r.title,
        at: r.closedAt!.toISOString(),
      });
    }
  }

  // newest first across the four sources
  items.sort(compareArchiveItems);
  const page = items.slice(0, limit);
  const last = page[page.length - 1];

  await logChat({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    action: "chat.archive_read",
    spaceId: opts.spaceId ?? null,
    meta: { type: opts.type ?? "all" },
  });

  return {
    items: page,
    nextCursor: last ? encodeCursor(last) : null,
  };
}

type Cursor = { kind: ArchiveType; id: string; at: Date };

function compareArchiveItems(a: ArchiveItemDto, b: ArchiveItemDto): number {
  const byId = a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
  return (b.at ?? "").localeCompare(a.at ?? "") || byId || a.type.localeCompare(b.type);
}

function encodeCursor(item: ArchiveItemDto): string {
  return `${item.at}|${item.id}|${item.type}`;
}

function cursorWhere(cursor: Cursor, kind: ArchiveType, field: "deletedAt" | "editedAt" | "createdAt" | "closedAt") {
  return [
    { [field]: { lt: cursor.at } },
    { [field]: cursor.at, id: { lt: cursor.id } },
    ...(kind > cursor.kind ? [{ [field]: cursor.at, id: cursor.id }] : []),
  ];
}

function parseCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  const parts = cursor.split("|");
  if (parts.length !== 3) return null;
  const [at, id, kind] = parts;
  if (!at || !id || !kind) return null;
  const date = new Date(at);
  if (!["deleted", "edited", "moderation", "closed"].includes(kind) || !Number.isFinite(date.getTime())) return null;
  return { kind: kind as ArchiveType, id, at: date };
}
