import type { Prisma } from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import { featureOn } from "@/lib/features";
import { goHref } from "@/lib/space-link";
import { db } from "./db";
import { log } from "./log";
import { pushTo } from "./calls/push";
import { mayHearOfTask } from "./policy/assigned-only";

/**
 * THE BELL ON THE PHONE AND THE LAPTOP (the owner's first feature after the research, 2026-10-26): every notification
 * written here also goes out as a Web Push to the browsers its person allowed, so it reaches them while the site is
 * closed. It rides the calls' ringing base (src/server/calls/push.ts, public/sw.js); the switch «إشعارات على التلفون
 * واللابتوب» (`pushEverything`) in «الميزات» turns it off company by company. Best effort and never in the way: it is
 * sent after the row is written and never fails the request that wrote it.
 */
const pending = new Set<Promise<void>>();

/** Test hook: wait for the pushes sent so far (never call from server code). */
export async function flushPushesForTests(): Promise<void> {
  await Promise.all([...pending]);
}

function pushOut(userIds: readonly string[], note: { type: string; title: string; body?: string | null; linkUrl?: string | null; workspaceId?: string | null }): void {
  const job = (async () => {
    if (userIds.length === 0) return;
    // the switch of each person's company (their ACTIVE membership)
    const rows = await db.organizationMember.findMany({
      where: { userId: { in: [...userIds] }, status: "ACTIVE" },
      select: { userId: true, organization: { select: { settings: true } } },
    });
    const on = [...new Set(rows.filter((r) => featureOn(r.organization.settings, "pushEverything")).map((r) => r.userId))];
    if (on.length === 0) return;
    const target = note.linkUrl ?? "/";
    // a notification of a space opens through /go: the right space first, then the page
    const url = note.workspaceId && !target.startsWith("/go?") ? goHref(note.workspaceId, target) : target;
    await pushTo(on, { kind: "note", title: note.title, body: note.body ?? "", url, tag: `${note.type}:${target}` });
  })().catch((err) => log.warn("push.note_failed", { message: err instanceof Error ? err.message : String(err) }));
  pending.add(job);
  void job.finally(() => pending.delete(job));
}

/**
 * Only people who are IN receive notifications. A suspended or offboarded person gets nothing new
 * (a comment on their old task would otherwise land in their notifications with its text).
 */
async function activeRecipients(userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db.organizationMember.findMany({
    where: { userId: { in: [...userIds] }, status: "ACTIVE" },
    select: { userId: true },
  });
  const active = new Set(rows.map((r) => r.userId));
  return userIds.filter((id) => active.has(id));
}

/**
 * Generic in-app notification writer (bell UI maps type → localized label).
 *
 * `workspaceId`: the space the notification belongs to (a task's, a topic's, a space one was added to). The bell
 * shows the space the person is in (each space is like a separate site); without one it is personal.
 * `organizationId`: the company that wrote it. Without one it is read from the space; a notice that names
 * neither (a ticket with no space, a changed rank) is shown in the bell of the company open at that moment,
 * and the backfill gives the old ones their company.
 */
export async function pushNotification(input: {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  /** When given, the Web Push carries THIS text instead of `body` (the bell keeps `body`): for a body that must not leave the app, e.g. an amount. */
  pushBody?: string | null;
  taskId?: string | null;
  linkUrl?: string | null;
  workspaceId?: string | null;
  organizationId?: string | null;
}): Promise<void> {
  if ((await activeRecipients([input.userId])).length === 0) return;
  await db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      taskId: input.taskId ?? null,
      linkUrl: input.linkUrl ?? null,
      workspaceId: input.workspaceId ?? null,
      organizationId: input.organizationId ?? (await orgOfSpace(input.workspaceId)),
    },
  });
  pushOut([input.userId], input.pushBody === undefined ? input : { ...input, body: input.pushBody });
}

/**
 * The same bell row, written on the CALLER's transaction (the reminder runner: the claim, the re-arming and the notice
 * are one commit, so a reminder that fired always has its notice and never has two). The person must already be known to
 * be ACTIVE and `organizationId` must be given. Returns the Web Push, to be called AFTER the transaction commits.
 */
export async function pushNotificationInTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    taskId?: string | null;
    linkUrl?: string | null;
    workspaceId?: string | null;
    organizationId: string;
  },
): Promise<() => void> {
  await tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      taskId: input.taskId ?? null,
      linkUrl: input.linkUrl ?? null,
      workspaceId: input.workspaceId ?? null,
      organizationId: input.organizationId,
    },
  });
  return () => pushOut([input.userId], input);
}

/** The company a space belongs to (null when there is no space). One small read, and the answer is missed nowhere. */
async function orgOfSpace(workspaceId: string | null | undefined): Promise<string | null> {
  if (!workspaceId) return null;
  const space = await db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
  return space?.organizationId ?? null;
}

/** Pushes the same notification to many users (dedupes the actor). */
export async function pushNotificationToMany(
  userIds: readonly string[],
  input: {
    type: string;
    title: string;
    body?: string | null;
    taskId?: string | null;
    linkUrl?: string | null;
    workspaceId?: string | null;
    organizationId?: string | null;
  },
): Promise<void> {
  const unique = await activeRecipients([...new Set(userIds)]);
  if (unique.length === 0) return;
  const organizationId = input.organizationId ?? (await orgOfSpace(input.workspaceId));
  await db.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      taskId: input.taskId ?? null,
      linkUrl: input.linkUrl ?? null,
      workspaceId: input.workspaceId ?? null,
      organizationId,
    })),
  });
  pushOut(unique, input);
}

/** creates an in-app notification for a task assignment. */
export async function notifyAssignment(input: {
  assigneeId: string;
  taskNumber: number;
  orgPrefix: string;
  taskId: string;
  title: string;
  /** the task's space (null: personal) */
  workspaceId: string | null;
}): Promise<void> {
  // the bell prints the stored title VERBATIM (notification-bell.tsx), so the title is the Arabic
  // phrase and the machine label goes in the body (WP-ARABIC2 (a): nothing English on screen)
  await pushNotification({
    userId: input.assigneeId,
    type: "task_assigned",
    title: AR["notif.type.task_assigned"] ?? "إشعار",
    body: `${input.orgPrefix}-${input.taskNumber} · ${input.title}`,
    taskId: input.taskId,
    linkUrl: `/tasks/${input.taskId}`,
    workspaceId: input.workspaceId,
  });
}

/** Comment posted: notify task assignee + creator (never the author). */
export async function notifyComment(input: {
  taskId: string;
  taskNumber: number;
  orgPrefix: string;
  authorId: string;
  authorName: string;
  body: string;
  watcherIds: readonly string[];
  /** the task's space (null: personal) */
  workspaceId: string | null;
}): Promise<void> {
  const watchers = await mayHearOfTask(input.watcherIds.filter((id) => id !== input.authorId), input.taskId);
  await pushNotificationToMany(watchers, {
    type: "comment",
    title: AR["notif.type.comment"] ?? "إشعار",
    body: `${input.authorName}: ${input.body.slice(0, 140)}`,  // the task label rides in the link
    taskId: input.taskId,
    linkUrl: `/tasks/${input.taskId}`,
    workspaceId: input.workspaceId,
  });
}

/** Someone was added to a workspace / department. */
export async function notifyMembership(input: {
  userIds: readonly string[];
  kind: "workspace" | "department";
  title: string;
  linkUrl: string | null;
  actorId?: string;
  /** the space they were added to (a department's notice is personal) */
  workspaceId?: string | null;
}): Promise<void> {
  await pushNotificationToMany(input.userIds.filter((id) => id !== input.actorId), {
    type: input.kind === "workspace" ? "ws_member_added" : "dept_member_added",
    title: input.title,
    linkUrl: input.linkUrl,
    workspaceId: input.workspaceId ?? null,
  });
}
