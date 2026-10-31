import { z } from "zod";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { assertFeatureOn } from "@/server/services/features";
import { pushNotification } from "@/server/notify";
import { canWriteInWorkspace, isSpaceManager } from "@/server/workspace-role";
import { AR } from "@/lib/i18n/dict";
import { LIMITS, cleanContent, excerptOf, mentionedIds } from "@/lib/docs/markup";
import { changedDocFields, decideDocSave, shouldSnapshot, type DocSnapshot } from "@/lib/docs/versions";
import type { DocItem, DocList, DocListItem, DocPerson, DocRevisionFull, DocRevisionItem, DocRevisionsView } from "@/lib/docs/shared";

/**
 * «المستندات» — the text documents of a space. ONE place decides who may do what with them:
 *
 *  - a person outside the space gets «not found» for its documents, never «forbidden» (the space is invisible to them);
 *  - the people in the space read and write; the OWNER reads everywhere, silently (no row, no trace, no «seen»);
 *  - an external partner (a guest of the space) reads ONLY a document marked «مشاركة مع الشركاء», never writes, never sees
 *    the history, the staff names or the people an @name can point at; a document that is not shared does not exist for them;
 *  - the document's author, a manager of the space and the owner mark a document shared or take it off, and delete it;
 *  - nothing is ever hard-deleted: «حذف» sets `archivedAt`, and only the OWNER still reads it;
 *  - every query carries the company AND the space, and the feature's switch (`spaceDocs`) is read on every call.
 *
 * ⚠️ There is no live co-editing: the last save wins, and a save made from an older version is refused with 409 so the
 *    person can choose (src/components/documents/conflict-banner.tsx). Nothing is overwritten silently.
 */

// ---------- who is asking, about which space ----------

export interface DocScope {
  actor: Actor;
  spaceId: string;
  /** Changes words: a writer of the space; never an external partner. */
  canWrite: boolean;
  owner: boolean;
  external: boolean;
  /** Moderates the space (its ADMIN, an org ADMIN in it, the OWNER). */
  manager: boolean;
}

export async function docScope(actor: Actor, spaceId: string): Promise<DocScope> {
  await assertFeatureOn(actor.orgId, "spaceDocs");
  const reachable = await accessibleWorkspaceIds(actor.userId);
  if (!reachable.includes(spaceId)) throw new NotFoundError("docs.not_found");
  const [space, row] = await Promise.all([
    db.workspace.findFirst({ where: { id: spaceId, organizationId: actor.orgId }, select: { id: true } }),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: spaceId, userId: actor.userId } }, select: { role: true } }),
  ]);
  if (!space) throw new NotFoundError("docs.not_found");
  return {
    actor,
    spaceId,
    canWrite: !actor.isExternal && canWriteInWorkspace(actor.role, row?.role),
    owner: actor.isOwner,
    external: actor.isExternal,
    manager: isSpaceManager(actor.role, row?.role),
  };
}

function assertWrite(scope: DocScope): void {
  if (!scope.canWrite) throw new ForbiddenError("docs.readonly");
}

// ---------- shapes ----------

const SELECT = {
  id: true,
  orgId: true,
  workspaceId: true,
  createdById: true,
  lastEditorId: true,
  title: true,
  content: true,
  version: true,
  sharedWithPartners: true,
  mentions: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  lastEditor: { select: { name: true } },
} as const;

type Row = {
  id: string;
  orgId: string;
  workspaceId: string;
  createdById: string;
  lastEditorId: string | null;
  title: string;
  content: string;
  version: number;
  sharedWithPartners: boolean;
  mentions: string[];
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { name: string };
  lastEditor: { name: string } | null;
};

function canManageDoc(scope: DocScope, row: Pick<Row, "createdById">): boolean {
  return !scope.external && (scope.manager || row.createdById === scope.actor.userId);
}

/** The space's own staff an @name can point at: ACTIVE, in the space, not an external partner. */
export async function peopleOf(orgId: string, spaceId: string): Promise<DocPerson[]> {
  const rows = await db.workspaceMember.findMany({
    where: {
      workspaceId: spaceId,
      role: { not: "GUEST" },
      user: { memberships: { some: { organizationId: orgId, status: "ACTIVE", role: { not: "GUEST" } } } },
    },
    select: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return rows.map((r) => ({ id: r.user.id, name: r.user.name }));
}

async function toItem(scope: DocScope, row: Row): Promise<DocItem> {
  return {
    id: row.id,
    spaceId: row.workspaceId,
    title: row.title,
    content: row.content,
    version: row.version,
    sharedWithPartners: row.sharedWithPartners,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    authorName: scope.external ? null : row.createdBy.name,
    lastEditorName: scope.external ? null : (row.lastEditor?.name ?? null),
    archived: row.archivedAt !== null,
    internal: !scope.external,
    canWrite: scope.canWrite && row.archivedAt === null,
    canManage: canManageDoc(scope, row),
    people: scope.canWrite ? await peopleOf(scope.actor.orgId, row.workspaceId) : [],
  };
}

// ---------- what a request may carry ----------

export const createDocSchema = z.object({
  spaceId: z.string().min(1).max(64),
  title: z.string().trim().min(1, "docs.e.title").max(LIMITS.title, "docs.e.title"),
  content: z.string().max(LIMITS.content, "docs.e.too_long").optional(),
});
export type CreateDocInput = z.infer<typeof createDocSchema>;

export const saveDocSchema = z
  .object({
    /** The version the editor started from: a document that moved on answers 409 with the document as it is now. */
    version: z.number().int().min(1),
    title: z.string().trim().min(1, "docs.e.title").max(LIMITS.title, "docs.e.title"),
    content: z.string().max(LIMITS.content, "docs.e.too_long"),
  })
  .partial({ title: true, content: true });
export type SaveDocInput = z.infer<typeof saveDocSchema>;

export const restoreDocSchema = z.object({
  /** The version to bring back. */
  version: z.number().int().min(1),
  /** The version the person was looking at (the same 409 as a save when the document has moved on since). */
  baseVersion: z.number().int().min(1).optional(),
});

export const shareDocSchema = z.object({ shared: z.boolean() });

/** The document moved on since the editor started: the answer is 409, carrying the document as it is now. */
export class DocConflictError extends Error {
  constructor(
    readonly current: { title: string; content: string; version: number; updatedAt: string; lastEditorName: string | null },
  ) {
    super("docs.conflict");
    this.name = "DocConflictError";
  }
}

// ---------- reading ----------

/** The documents of a space the person reads, the freshest first. An external partner reads only the shared ones. */
export async function listDocuments(actor: Actor, spaceId: string): Promise<DocList> {
  const scope = await docScope(actor, spaceId);
  const rows = await db.document.findMany({
    where: { orgId: actor.orgId, workspaceId: spaceId, archivedAt: null, ...(scope.external ? { sharedWithPartners: true } : {}) },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 200,
    select: SELECT,
  });
  const documents: DocListItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    excerpt: excerptOf(r.content, 140),
    version: r.version,
    sharedWithPartners: r.sharedWithPartners,
    updatedAt: r.updatedAt.toISOString(),
    authorName: scope.external ? null : r.createdBy.name,
  }));
  return { documents, canCreate: scope.canWrite, spaceId };
}

/**
 * A document the person may open: its space is theirs, an external partner needs it shared, an archived one is the owner's.
 * Anything else is «not found», so a guessed id says nothing.
 */
export async function loadDocument(actor: Actor, id: string): Promise<{ scope: DocScope; row: Row }> {
  await assertFeatureOn(actor.orgId, "spaceDocs");
  const row = await db.document.findFirst({ where: { id, orgId: actor.orgId }, select: SELECT });
  if (!row) throw new NotFoundError("docs.not_found");
  const scope = await docScope(actor, row.workspaceId);
  if (row.archivedAt && !scope.owner) throw new NotFoundError("docs.not_found");
  if (scope.external && !row.sharedWithPartners) throw new NotFoundError("docs.not_found");
  return { scope, row };
}

export async function readDocument(actor: Actor, id: string): Promise<DocItem> {
  const { scope, row } = await loadDocument(actor, id);
  return toItem(scope, row);
}

// ---------- writing ----------

/** The people the text names who were not named before, and are told once. Best effort: it never undoes the save. */
async function tellMentioned(actor: Actor, row: Pick<Row, "id" | "orgId" | "workspaceId" | "title">, userIds: readonly string[]): Promise<void> {
  const ids = userIds.filter((id) => id !== actor.userId);
  if (ids.length === 0) return;
  const me = await db.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  await Promise.all(
    ids.map((userId) =>
      pushNotification({
        userId,
        type: "doc_mention",
        title: AR["notif.type.doc_mention"] ?? "",
        // the bell (behind the sign-in) says which document and who; the Web Push line is generic and carries neither
        body: me ? `${me.name} · ${row.title}` : row.title,
        pushBody: AR["docs.note.push"] ?? "",
        linkUrl: `/documents/${row.id}`,
        workspaceId: row.workspaceId,
        organizationId: row.orgId,
      }).catch(() => undefined),
    ),
  );
}

export async function createDocument(actor: Actor, input: CreateDocInput): Promise<DocItem> {
  const scope = await docScope(actor, input.spaceId);
  assertWrite(scope);
  const content = cleanContent(input.content ?? "");
  const people = await peopleOf(actor.orgId, input.spaceId);
  const mentions = mentionedIds(content, people);
  const row = await db.document.create({
    data: { orgId: actor.orgId, workspaceId: input.spaceId, createdById: actor.userId, lastEditorId: actor.userId, title: input.title, content, mentions },
    select: SELECT,
  });
  await tellMentioned(actor, row, mentions);
  return toItem(scope, row);
}

/**
 * ONE place writes a document's words, so every save is versioned the same way: the row is locked, the editor's starting
 * version is compared with the document's (409 if it moved on), the snapshot of what is being replaced is appended to
 * `DocumentRevision` when it is worth keeping (src/lib/docs/versions.ts), and the document moves to the next version, all in
 * one transaction. A save that changes nothing writes nothing.
 */
async function writeVersion(
  actor: Actor,
  id: string,
  spaceId: string,
  patch: Partial<DocSnapshot>,
  opts: { baseVersion?: number | null; cause: "EDIT" | "RESTORE" },
): Promise<{ row: Row; applied: boolean; newlyMentioned: string[] }> {
  const people = await peopleOf(actor.orgId, spaceId);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${id} AND "orgId" = ${actor.orgId} FOR UPDATE`;
    const fresh = await tx.document.findFirst({ where: { id, orgId: actor.orgId }, select: SELECT });
    if (!fresh || fresh.archivedAt) throw new NotFoundError("docs.not_found");
    const changed = changedDocFields(fresh, patch);
    const decision = decideDocSave({ baseVersion: opts.baseVersion, currentVersion: fresh.version, changed });
    if (decision.kind === "conflict") {
      throw new DocConflictError({
        title: fresh.title,
        content: fresh.content,
        version: fresh.version,
        updatedAt: fresh.updatedAt.toISOString(),
        lastEditorName: fresh.lastEditor?.name ?? null,
      });
    }
    if (decision.kind === "noop") return { row: fresh, applied: false, newlyMentioned: [] };

    const now = new Date();
    if (shouldSnapshot({ lastEditorId: fresh.lastEditorId, editorId: actor.userId, lastSavedAt: fresh.updatedAt, now, cause: opts.cause })) {
      await tx.documentRevision.create({
        // `editorId`: who WROTE the text being kept (the history reads «النسخة 4، كتبها فلان»); `cause`: what replaced it
        data: { documentId: id, version: fresh.version, title: fresh.title, content: fresh.content, editorId: fresh.lastEditorId ?? fresh.createdById, cause: opts.cause },
      });
    }
    const title = patch.title ?? fresh.title;
    const content = patch.content ?? fresh.content;
    const mentions = mentionedIds(content, people);
    const row = await tx.document.update({
      where: { id },
      data: { title, content, mentions, lastEditorId: actor.userId, version: { increment: 1 } },
      select: SELECT,
    });
    // a restore tells nobody: the names it brings back were named before
    const newlyMentioned = opts.cause === "RESTORE" ? [] : mentions.filter((m) => !fresh.mentions.includes(m));
    return { row, applied: true, newlyMentioned };
  });
}

export async function saveDocument(actor: Actor, id: string, input: SaveDocInput): Promise<DocItem> {
  const { scope, row: current } = await loadDocument(actor, id);
  assertWrite(scope);
  const patch: Partial<DocSnapshot> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.content !== undefined) patch.content = cleanContent(input.content);
  const saved = await writeVersion(actor, id, current.workspaceId, patch, { baseVersion: input.version, cause: "EDIT" });
  if (saved.newlyMentioned.length > 0) await tellMentioned(actor, saved.row, saved.newlyMentioned);
  return toItem(scope, saved.row);
}

/** «استرجاع»: an older version comes back as a NEW version; the one it replaces is kept in the history. Nothing is rewritten. */
export async function restoreDocument(actor: Actor, id: string, input: z.infer<typeof restoreDocSchema>): Promise<DocItem> {
  const { scope, row: current } = await loadDocument(actor, id);
  assertWrite(scope);
  const old = await db.documentRevision.findUnique({ where: { documentId_version: { documentId: id, version: input.version } } });
  if (!old) throw new NotFoundError("docs.revision_not_found");
  const saved = await writeVersion(actor, id, current.workspaceId, { title: old.title, content: old.content }, { baseVersion: input.baseVersion, cause: "RESTORE" });
  return toItem(scope, saved.row);
}

/** «مشاركة مع الشركاء»: an external partner reads the document while this is on. Not a new version: it is a setting. */
export async function shareDocument(actor: Actor, id: string, shared: boolean): Promise<DocItem> {
  const { scope, row } = await loadDocument(actor, id);
  if (row.archivedAt) throw new NotFoundError("docs.not_found");
  if (!canManageDoc(scope, row)) throw new ForbiddenError("docs.manage_denied");
  const updated = row.sharedWithPartners === shared ? row : await db.document.update({ where: { id }, data: { sharedWithPartners: shared }, select: SELECT });
  return toItem(scope, updated);
}

/** «حذف»: the document goes out of sight; the OWNER still reads it. Nothing is removed. */
export async function archiveDocument(actor: Actor, id: string): Promise<void> {
  const { scope, row } = await loadDocument(actor, id);
  if (!canManageDoc(scope, row)) throw new ForbiddenError("docs.manage_denied");
  if (row.archivedAt) return;
  await db.document.update({ where: { id }, data: { archivedAt: new Date() } });
}

// ---------- history ----------

/** The history is the team's: an external partner never reads it (404, as for any area that does not exist for them). */
async function loadForHistory(actor: Actor, id: string): Promise<Row> {
  const { scope, row } = await loadDocument(actor, id);
  if (scope.external) throw new NotFoundError("docs.not_found");
  return row;
}

export async function listDocRevisions(actor: Actor, id: string): Promise<DocRevisionsView> {
  const row = await loadForHistory(actor, id);
  const rows = await db.documentRevision.findMany({
    where: { documentId: row.id },
    orderBy: { version: "desc" },
    take: 200,
    select: { version: true, title: true, content: true, cause: true, createdAt: true, editor: { select: { name: true } } },
  });
  const revisions: DocRevisionItem[] = rows.map((r) => ({
    version: r.version,
    title: r.title,
    size: r.content.length,
    cause: r.cause === "RESTORE" ? "RESTORE" : "EDIT",
    editorName: r.editor.name,
    createdAt: r.createdAt.toISOString(),
  }));
  return { currentVersion: row.version, revisions };
}

export async function readDocRevision(actor: Actor, id: string, version: number): Promise<DocRevisionFull> {
  const row = await loadForHistory(actor, id);
  const r = await db.documentRevision.findUnique({
    where: { documentId_version: { documentId: row.id, version } },
    select: { version: true, title: true, content: true, cause: true, createdAt: true, editor: { select: { name: true } } },
  });
  if (!r) throw new NotFoundError("docs.revision_not_found");
  return {
    version: r.version,
    title: r.title,
    content: r.content,
    size: r.content.length,
    cause: r.cause === "RESTORE" ? "RESTORE" : "EDIT",
    editorName: r.editor.name,
    createdAt: r.createdAt.toISOString(),
  };
}
