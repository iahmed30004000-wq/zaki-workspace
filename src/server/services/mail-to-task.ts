import { isIP } from "node:net";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, ValidationError, audit } from "@/server/auth";
import { decryptSecrets, encryptSecrets, encryptionKeyConfigured } from "@/server/crypto";
import { log } from "@/server/log";
import { AR } from "@/lib/i18n/dict";
import { isPrivateAddress } from "@/server/net-guard";
import type { Actor } from "@/server/policy/actor";
import { notifyAssignment } from "@/server/notify";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { dispatchEvent } from "@/server/services/n8n";
import { judgeAssignment } from "@/server/services/task-assign";
import { createTask, type ActorContext } from "@/server/services/tasks";
import { bodyToText } from "@/server/mail-task/body";
import { createMailSource, mailErrorKey, mailErrorName, type InboxMail, type MailAccount, type MailBoxInfo, type MailSource } from "@/server/mail-task/source";
import { MAIL_LIMITS, buildDescription, normalizeAddress, parseAllowList, messageKey, senderAllowed, titleFromSubject, validFolder, validHost, cleanLine } from "@/lib/mail-to-task";

/**
 * «بريد يصير مهمة» — the company's mailbox is read by the app and each new mail becomes ONE task.
 *
 *  - WHO: the OWNER alone (403 `mail.owner_only` for anybody else, an ADMIN included). The switch `emailToTask` in «الميزات» is OFF
 *    until the owner turns it on; off, nothing here runs, its routes answer «not found» (except taking the mailbox out), and what it
 *    stored stays.
 *  - THE PASSWORD (an app password) is typed by the owner into the card, never by anybody else, never in a file. It is encrypted at rest
 *    with `ENCRYPTION_KEY` (src/server/crypto.ts), read in ONE function (`readPassword`), and never selected, returned, logged,
 *    audited or put in an error. Without `ENCRYPTION_KEY` the card refuses to save. The screen is only ever told «محفوظة».
 *  - WHAT IS READ (src/server/mail-task/source.ts): the subject, the sender, the Message-ID and ONE text part of the body, capped. No
 *    attachment is ever downloaded; the mail is never deleted, moved or answered; it is marked read only when the owner chose that.
 *  - WHAT IS KEPT: the task (title = subject cut to 200, description = «من: <sender>» and a plain-text excerpt of about 1500
 *    characters), made through `createTask` so the rules, the rank judge and the bell apply as for a hand-made task, and a row in
 *    `MailTaskSeen` (the Message-ID) so a mail never makes two tasks. Nothing of the mail goes to any model.
 *  - WHEN: the job runner (src/server/jobs/mail-to-task.ts) every 5 minutes per mailbox, at most 20 mails a run. The FIRST run only notes
 *    where the mailbox ends (mail that was already there is not turned into tasks); after that only newer UNSEEN mail counts.
 *  - FAILURE: a run that fails is logged by the error's NAME and a dictionary key only, never the server's words; after 5 failed runs
 *    in a row the reading stops («تعطّل») until the owner saves the card again.
 *
 *  ⚠️ The app reads a company mailbox and keeps each mail's subject and a short excerpt. 🔧 Turn it off in «الميزات» and take the
 *  mailbox out of the card: the password is deleted.
 */

const DEFAULT_PORT = 993;

export interface MailTaskConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  folder: string;
  workspaceId: string;
  projectId: string;
  assigneeId: string | null;
  allowList: string[];
  markSeen: boolean;
}

export interface MailTaskInput extends MailTaskConfig {
  /** Typed by the owner. Absent or empty on a save that keeps the saved one. Never returned. */
  password?: string | undefined;
}

export type MailTaskState = "none" | "off" | "starting" | "running" | "disabled";

export interface MailTaskStatusDTO {
  switchOn: boolean;
  /** `ENCRYPTION_KEY` is set (without it nothing is saved). */
  keyConfigured: boolean;
  /** A password is saved. It is never sent, only this. */
  passwordSaved: boolean;
  config: MailTaskConfig | null;
  state: MailTaskState;
  failures: number;
  lastRunAt: Date | null;
  lastOkAt: Date | null;
  lastErrorKey: string | null;
  createdCount: number;
  skippedCount: number;
  /** Where the tasks can go and who they can go to (the owner sees every space). */
  spaces: { id: string; name: string; projects: { id: string; name: string }[] }[];
  people: { id: string; name: string }[];
}

function assertOwner(actor: Pick<Actor, "isOwner">): void {
  if (!actor.isOwner) throw new ForbiddenError("mail.owner_only");
}

function refuse(path: string, key: string): never {
  throw new ValidationError([{ path, message: key }]);
}

/** The columns a read may take: NOT the cipher. */
const PUBLIC_COLUMNS = {
  host: true,
  port: true,
  secure: true,
  username: true,
  folder: true,
  workspaceId: true,
  projectId: true,
  assigneeId: true,
  allowList: true,
  markSeen: true,
  lastUid: true,
  uidValidity: true,
  failures: true,
  disabledAt: true,
  lastRunAt: true,
  lastOkAt: true,
  lastErrorKey: true,
  createdCount: true,
  skippedCount: true,
} as const;

/** The password as plain text, for the connection ONLY. Null: none saved, or it can no longer be read (the owner types it again). */
async function readPassword(orgId: string): Promise<string | null> {
  const row = await db.mailInbox.findUnique({ where: { orgId }, select: { passwordEnc: true } });
  if (!row) return null;
  const plain = decryptSecrets<{ password?: unknown }>(row.passwordEnc);
  return plain && typeof plain.password === "string" && plain.password.length > 0 ? plain.password : null;
}

// ---------------------------------------------------------------------------
// the card
// ---------------------------------------------------------------------------

export async function getMailTaskStatus(actor: Actor): Promise<MailTaskStatusDTO> {
  assertOwner(actor);
  const [switchOn, row, spaces, members] = await Promise.all([
    isFeatureOn(actor.orgId, "emailToTask"),
    db.mailInbox.findUnique({ where: { orgId: actor.orgId }, select: PUBLIC_COLUMNS }),
    db.workspace.findMany({
      where: { organizationId: actor.orgId, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, projects: { where: { status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, select: { id: true, name: true } } },
    }),
    db.organizationMember.findMany({
      where: { organizationId: actor.orgId, status: "ACTIVE", role: { not: "GUEST" } },
      select: { user: { select: { id: true, name: true } } },
    }),
  ]);
  const state: MailTaskState = !row ? "none" : !switchOn ? "off" : row.disabledAt ? "disabled" : row.lastUid === null ? "starting" : "running";
  return {
    switchOn,
    keyConfigured: encryptionKeyConfigured(),
    passwordSaved: row !== null,
    config: row
      ? {
          host: row.host,
          port: row.port,
          secure: row.secure,
          username: row.username,
          folder: row.folder,
          workspaceId: row.workspaceId,
          projectId: row.projectId,
          assigneeId: row.assigneeId,
          allowList: row.allowList,
          markSeen: row.markSeen,
        }
      : null,
    state,
    failures: row?.failures ?? 0,
    lastRunAt: row?.lastRunAt ?? null,
    lastOkAt: row?.lastOkAt ?? null,
    lastErrorKey: row?.lastErrorKey ?? null,
    createdCount: row?.createdCount ?? 0,
    skippedCount: row?.skippedCount ?? 0,
    spaces: spaces.map((s) => ({ id: s.id, name: s.name, projects: s.projects })),
    people: members.map((m) => ({ id: m.user.id, name: m.user.name })).sort((a, b) => a.name.localeCompare(b.name, "ar")),
  };
}

/** Checks what the owner typed (shape, host, folder, list) and returns it cleaned. Throws `ValidationError` with a dictionary key. */
function cleanInput(input: MailTaskInput): MailTaskConfig {
  const host = input.host.trim().toLowerCase();
  if (!validHost(host)) refuse("host", "mail.err.host_invalid");
  // an address typed in as a number is judged here; a NAME is judged when the connection is made (it is resolved then)
  if (isIP(host) !== 0 && isPrivateAddress(host)) refuse("host", "mail.err.private_host");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) refuse("port", "mail.err.port_invalid");
  const username = cleanLine(input.username, MAIL_LIMITS.field);
  if (username === "") refuse("username", "mail.err.username_required");
  const folder = input.folder.trim() === "" ? "INBOX" : input.folder.trim();
  if (!validFolder(folder)) refuse("folder", "mail.err.folder_invalid");
  const parsed = parseAllowList(input.allowList);
  if (parsed.bad.length > 0) refuse("allowList", "mail.err.allow_invalid");
  if (parsed.list.length > MAIL_LIMITS.allowList) refuse("allowList", "mail.err.allow_many");
  return {
    host,
    port: input.port || DEFAULT_PORT,
    secure: input.secure,
    username,
    folder,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    assigneeId: input.assigneeId,
    allowList: parsed.list,
    markSeen: input.markSeen,
  };
}

function cleanPassword(password: string | undefined): string | null {
  if (password === undefined || password === "") return null;
  if (password.length > MAIL_LIMITS.password) refuse("password", "mail.err.password_invalid");
  return password;
}

/** Where the tasks go must exist in this company and still take tasks; the person must be able to receive one. */
async function assertDestination(actor: Actor, c: MailTaskConfig): Promise<void> {
  const project = await db.project.findFirst({
    where: { id: c.projectId, workspaceId: c.workspaceId, status: { not: "ARCHIVED" }, workspace: { organizationId: actor.orgId, archivedAt: null } },
    select: { id: true },
  });
  if (!project) refuse("projectId", "mail.err.project_missing");
  const board = await db.board.findFirst({ where: { projectId: c.projectId, archived: false }, select: { columns: { select: { id: true }, take: 1 } } });
  if (!board || board.columns.length === 0) refuse("projectId", "mail.err.no_board");
  if (c.assigneeId) {
    try {
      await judgeAssignment(db, { userId: actor.userId, orgId: actor.orgId }, c.assigneeId, c.workspaceId);
    } catch (err) {
      if (err instanceof ForbiddenError) refuse("assigneeId", "mail.err.assignee_invalid");
      throw err;
    }
  }
}

export async function saveMailTaskConfig(actor: Actor, input: MailTaskInput): Promise<void> {
  assertOwner(actor);
  await assertFeatureOn(actor.orgId, "emailToTask");
  // the password is stored encrypted or not at all: no key, no save (a key derived from AUTH_SECRET rotates with the sessions)
  if (!encryptionKeyConfigured()) refuse("password", "mail.err.no_key");
  const config = cleanInput(input);
  const password = cleanPassword(input.password);
  await assertDestination(actor, config);
  const existing = await db.mailInbox.findUnique({ where: { orgId: actor.orgId }, select: { host: true, port: true, secure: true, username: true, folder: true } });
  if (!existing && password === null) refuse("password", "mail.err.password_required");
  // another server, account or folder is another mailbox: the next run starts over by noting where it ends
  const sameBox =
    existing !== null &&
    existing.host === config.host &&
    existing.port === config.port &&
    existing.secure === config.secure &&
    existing.username === config.username &&
    existing.folder === config.folder;
  const fields = {
    ...config,
    failures: 0,
    disabledAt: null,
    lastErrorKey: null,
    updatedById: actor.userId,
    ...(sameBox ? {} : { lastUid: null, uidValidity: null, lastRunAt: null }),
  };
  await db.mailInbox.upsert({
    where: { orgId: actor.orgId },
    create: { orgId: actor.orgId, ...fields, passwordEnc: encryptSecrets({ password }) },
    update: { ...fields, ...(password !== null ? { passwordEnc: encryptSecrets({ password }) } : {}) },
  });
  // the audit row says THAT it changed, nothing of what was typed
  await audit("mail_inbox.saved", { actorId: actor.userId, orgId: actor.orgId, target: actor.orgId });
}

/** Takes the mailbox out: the password is deleted with it. Allowed while the switch is off too, so a credential can always be removed. */
export async function removeMailTaskConfig(actor: Actor): Promise<void> {
  assertOwner(actor);
  await db.mailInbox.deleteMany({ where: { orgId: actor.orgId } });
  await audit("mail_inbox.removed", { actorId: actor.userId, orgId: actor.orgId, target: actor.orgId });
}

export type MailTestResult = { ok: true; count: number } | { ok: false; reasonKey: string };

/**
 * «افحص الاتصال»: connects with what is on the card (the typed password, else the saved one), opens the folder, counts it, closes.
 * A failure answers a dictionary key, never the server's own words. Nothing is saved or changed.
 */
export async function testMailConnection(actor: Actor, input: MailTaskInput): Promise<MailTestResult> {
  assertOwner(actor);
  await assertFeatureOn(actor.orgId, "emailToTask");
  const host = input.host.trim().toLowerCase();
  if (!validHost(host)) refuse("host", "mail.err.host_invalid");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) refuse("port", "mail.err.port_invalid");
  const username = cleanLine(input.username, MAIL_LIMITS.field);
  if (username === "") refuse("username", "mail.err.username_required");
  const folder = input.folder.trim() === "" ? "INBOX" : input.folder.trim();
  if (!validFolder(folder)) refuse("folder", "mail.err.folder_invalid");
  const password = cleanPassword(input.password) ?? (await readPassword(actor.orgId));
  if (password === null) refuse("password", "mail.err.password_required");
  const source = createMailSource({ host, port: input.port, secure: input.secure, username, password, folder, markSeen: false });
  try {
    const info = await source.open();
    return { ok: true, count: info.exists };
  } catch (err) {
    const key = mailErrorKey(err);
    log.warn("mail_task.test_failed", { org: actor.orgId, key, name: mailErrorName(err) });
    return { ok: false, reasonKey: key };
  } finally {
    await source.close();
  }
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

export interface PollResult {
  status: "idle" | "baseline" | "ok" | "failed";
  created: number;
  skipped: number;
  duplicates: number;
  errorKey: string | null;
}

const IDLE: PollResult = { status: "idle", created: 0, skipped: 0, duplicates: 0, errorKey: null };

/** A failed run: counted, remembered by its KEY, and at the fifth in a row the reading stops. */
async function recordFailure(orgId: string, key: string, name: string, now: Date): Promise<PollResult> {
  const row = await db.mailInbox.update({ where: { orgId }, data: { failures: { increment: 1 }, lastErrorKey: key }, select: { failures: true } });
  const stopped = row.failures >= MAIL_LIMITS.maxFailures;
  if (stopped) await db.mailInbox.update({ where: { orgId }, data: { disabledAt: now } });
  log.warn("mail_task.run_failed", { org: orgId, key, name, failures: row.failures, stopped });
  return { ...IDLE, status: "failed", errorKey: key };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

type InboxRow = Prisma.MailInboxGetPayload<{ select: typeof PUBLIC_COLUMNS }> & { orgId: string };

/** The primary owner (the one who made the company): the tasks are made on his behalf, through the same door as his own. */
async function ownerActor(orgId: string): Promise<ActorContext | null> {
  const owner = await db.organizationMember.findFirst({
    where: { organizationId: orgId, role: "OWNER", status: "ACTIVE" },
    orderBy: [{ primaryOwner: "desc" }, { createdAt: "asc" }],
    select: { userId: true },
  });
  return owner ? { userId: owner.userId, orgId } : null;
}

type Outcome = "created" | "skipped" | "duplicate";

async function handleMail(row: InboxRow, actor: ActorContext, info: MailBoxInfo, mail: InboxMail): Promise<Outcome> {
  const sender = normalizeAddress(mail.from);
  // a sender outside the owner's list is skipped (counted), never a task
  if (!senderAllowed(sender, row.allowList)) return "skipped";

  // claim the Message-ID first: a second run (or a second process) that meets the same mail finds it taken
  const key = messageKey(mail.messageId, info.uidValidity, mail.uid);
  let claim: { id: string };
  try {
    claim = await db.mailTaskSeen.create({ data: { orgId: row.orgId, messageId: key }, select: { id: true } });
  } catch (err) {
    if (isUniqueViolation(err)) return "duplicate";
    throw err;
  }
  try {
    const text = await bodyToText(mail.bodyType, mail.body);
    const board = await db.board.findFirst({ where: { projectId: row.projectId, archived: false }, orderBy: { createdAt: "asc" }, select: { id: true, columns: { orderBy: { position: "asc" }, take: 1, select: { id: true } } } });
    if (!board || board.columns.length === 0) throw new ForbiddenError("mail.err.no_board");
    const task = await createTask(actor, {
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      boardId: board.id,
      columnId: board.columns[0]!.id,
      title: titleFromSubject(mail.subject, AR["mail.no_subject"] ?? "—"),
      description: buildDescription(AR["mail.from_label"] ?? "من", sender, text),
      assigneeId: row.assigneeId,
    });
    await db.mailTaskSeen.update({ where: { id: claim.id }, data: { taskId: task.id } });
    await afterTask(row, actor, task);
    return "created";
  } catch (err) {
    // no task was made: free the Message-ID so the next run tries again
    await db.mailTaskSeen.delete({ where: { id: claim.id } }).catch(() => undefined);
    throw err;
  }
}

/** After the commit: the audit row, the n8n event, the assignee's bell. A failure here never undoes the task. */
async function afterTask(row: InboxRow, actor: ActorContext, task: { id: string; number: number; title: string; assigneeId: string | null }): Promise<void> {
  try {
    await audit("task.created", { actorId: actor.userId, orgId: actor.orgId, target: task.id, meta: { source: "mail" } });
    await dispatchEvent(actor.orgId, "task.created", { taskId: task.id, number: task.number, title: task.title });
    if (task.assigneeId && task.assigneeId !== actor.userId) {
      const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { keyPrefix: true } });
      await notifyAssignment({ assigneeId: task.assigneeId, taskNumber: task.number, orgPrefix: org?.keyPrefix ?? "", taskId: task.id, title: task.title, workspaceId: row.workspaceId });
    }
  } catch (err) {
    log.warn("mail_task.after_failed", { org: actor.orgId, name: mailErrorName(err) });
  }
}

/**
 * One run of ONE company's mailbox. Never throws: a failure is recorded on the row (a key) and returned.
 * Idempotent: the Message-ID table and the stored UID mean a mail is turned into a task once, however often this is called.
 */
export async function pollMailbox(orgId: string, now: Date = new Date()): Promise<PollResult> {
  const row = await db.mailInbox.findUnique({ where: { orgId }, select: { ...PUBLIC_COLUMNS, orgId: true } });
  if (!row || row.disabledAt) return IDLE;
  if (!(await isFeatureOn(orgId, "emailToTask"))) return IDLE;

  const password = await readPassword(orgId);
  if (password === null) return recordFailure(orgId, "mail.err.password_unreadable", "NoPassword", now);
  const actor = await ownerActor(orgId);
  if (!actor) return recordFailure(orgId, "mail.err.no_owner", "NoOwner", now);

  const account: MailAccount = { host: row.host, port: row.port, secure: row.secure, username: row.username, password, folder: row.folder, markSeen: row.markSeen };
  const source: MailSource = createMailSource(account);
  const result: PollResult = { ...IDLE, status: "ok" };
  try {
    const info = await source.open();

    // the first run, or a mailbox whose numbering was reset: only note where it ends (what was already there is not turned into tasks)
    if (row.lastUid === null || row.uidValidity !== info.uidValidity) {
      await db.mailInbox.update({
        where: { orgId },
        data: { lastUid: Math.max(0, info.uidNext - 1), uidValidity: info.uidValidity, failures: 0, lastErrorKey: null, lastOkAt: now },
      });
      return { ...result, status: "baseline" };
    }

    const uids = await source.listUnseen(row.lastUid, MAIL_LIMITS.perRun);
    for (const uid of uids) {
      const mail = await source.fetch(uid);
      let outcome: Outcome | null = null;
      if (mail) outcome = await handleMail(row, actor, info, mail);
      // marked read only when the owner chose it, and only a mail that has its task (never one that was skipped)
      if (mail && row.markSeen && (outcome === "created" || outcome === "duplicate")) await source.markSeen(uid);
      if (outcome === "created") result.created += 1;
      else if (outcome === "skipped") result.skipped += 1;
      else if (outcome === "duplicate") result.duplicates += 1;
      // progress is stored mail by mail: a failure on the next one does not lose this one
      await db.mailInbox.update({ where: { orgId }, data: { lastUid: uid } });
    }
    await db.mailInbox.update({
      where: { orgId },
      data: { failures: 0, lastErrorKey: null, lastOkAt: now, createdCount: { increment: result.created }, skippedCount: { increment: result.skipped } },
    });
    return result;
  } catch (err) {
    // what this run did before it failed still counts
    if (result.created > 0 || result.skipped > 0) {
      await db.mailInbox.update({ where: { orgId }, data: { createdCount: { increment: result.created }, skippedCount: { increment: result.skipped } } }).catch(() => undefined);
    }
    const failed = await recordFailure(orgId, mailErrorKey(err), mailErrorName(err), now);
    return { ...failed, created: result.created, skipped: result.skipped, duplicates: result.duplicates };
  } finally {
    await source.close();
  }
}

export interface MailTasksRun {
  /** Mailboxes that were due and looked at. */
  inboxes: number;
  created: number;
  skipped: number;
  failed: number;
}

/**
 * The job: every mailbox that is due (not stopped, not run in the last 5 minutes) while the company's switch is on. The run is claimed
 * with one UPDATE, so two processes never read the same mailbox at once.
 */
export async function runMailToTask(now: Date = new Date()): Promise<MailTasksRun> {
  const out: MailTasksRun = { inboxes: 0, created: 0, skipped: 0, failed: 0 };
  const rows = await db.mailInbox.findMany({ where: { disabledAt: null }, select: { orgId: true } });
  const dueBefore = new Date(now.getTime() - MAIL_LIMITS.everyMinutes * 60_000);
  for (const { orgId } of rows) {
    if (!(await isFeatureOn(orgId, "emailToTask"))) continue;
    const claimed = await db.mailInbox.updateMany({
      where: { orgId, disabledAt: null, OR: [{ lastRunAt: null }, { lastRunAt: { lte: dueBefore } }] },
      data: { lastRunAt: now },
    });
    if (claimed.count === 0) continue;
    out.inboxes += 1;
    try {
      const r = await pollMailbox(orgId, now);
      out.created += r.created;
      out.skipped += r.skipped;
      if (r.status === "failed") out.failed += 1;
    } catch (err) {
      out.failed += 1;
      log.error("mail_task.poll_crashed", { org: orgId, name: mailErrorName(err) });
    }
  }
  return out;
}
