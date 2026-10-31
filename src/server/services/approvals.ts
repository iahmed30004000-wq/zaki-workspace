import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { canReadConversation } from "@/server/policy/conversation";
import { canWriteInWorkspace, isSpaceManager } from "@/server/workspace-role";
import { PENDING_PATH } from "@/server/services/files";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { isRewardCurrency, REWARD_MAX_MINOR } from "@/lib/rewards";
import { validateSchema, type Answers } from "@/lib/approvals/forms";
import {
  APPROVAL_LIMITS,
  chainProblem,
  isApprovalStatus,
  outcomeOf,
  readHistory,
  reasonProblem,
  tidyReason,
  type ApprovalStatus,
  type Decision,
  type LinkKind,
  type RevisionSnapshot,
} from "@/lib/approvals/shared";
import type { ApprovalDetail, AttachmentView, LinkView, ListItem, PersonRef, StepView } from "@/lib/approvals/view";
import { approvalsGate, ineligible, mayRead, notFound, spaceViewer, type SpaceViewer } from "./approval-access";
import { namesOf, notifyApproval } from "./approval-notify";

/**
 * «طلبات الموافقة» — ask, decide, send back, resubmit, cancel, read.
 *
 * AN APPROVAL ONLY RECORDS A DECISION. Nothing here moves money: an optional amount is a note in integer minor units, kept
 * on the request and shown only to people who work in the space. Nothing is ever deleted: a cancelled request is a status,
 * a request sent back and resubmitted is a new `version` whose earlier steps, files and content stay readable.
 *
 * EXACTLY ONCE. A decision locks the request's row, then changes the step with a conditional UPDATE from PENDING and the
 * request with one from PENDING at that step. Two decisions at the same moment (approve and reject from two tabs) take the
 * lock one after the other: the first wins, the second is refused with `ApprovalConflictError` (409).
 *
 * THE CHAIN. One approver or up to three, in order. Only the first is told at the start; the next is told when the one
 * before approves; a rejection ends the request; «اطلب تعديل» sends it back to the requester. The requester never approves their
 * own request. Anybody else who works in the space may be asked, whatever their rank.
 */

export class ApprovalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalConflictError";
  }
}

export const EVENTS = {
  requested: "approval.requested",
  approved: "approval.step_approved",
  completed: "approval.approved",
  rejected: "approval.rejected",
  changes: "approval.changes_requested",
  resubmitted: "approval.resubmitted",
  cancelled: "approval.cancelled",
} as const;

type Tx = Prisma.TransactionClient;
type Who = Pick<Actor, "userId" | "orgId" | "role" | "isOwner" | "isExternal">;

// ───────────────────────────────────────────────────── input ─────────────────────────────────────────────────────

export interface ContentInput {
  title: string;
  details?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  link?: { kind: LinkKind; id: string } | null;
  fileIds?: readonly string[];
}

export interface CreateInput extends ContentInput {
  workspaceId: string;
  approverIds: readonly string[];
}

/** What a form hands to the creation: the version of the template it was filled from and the checked answers. */
export interface FormSource {
  formId: string;
  answers: Record<string, string | number | boolean>;
}

interface Content {
  title: string;
  details: string;
  amountMinor: number | null;
  currency: string | null;
  link: { kind: LinkKind; id: string } | null;
}

const bad = (path: string, message: string) => new ValidationError([{ path, message }]);

function contentOf(input: ContentInput): Content {
  const title = (input.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) throw bad("title", "approvals.e.title_required");
  if (title.length > APPROVAL_LIMITS.title) throw bad("title", "approvals.e.title_long");
  const details = (input.details ?? "").replace(/\r\n?/g, "\n").trim();
  if (details.length > APPROVAL_LIMITS.details) throw bad("details", "approvals.e.details_long");
  const hasAmount = input.amountMinor != null;
  const hasCurrency = input.currency != null && input.currency !== "";
  if (hasAmount !== hasCurrency) throw bad(hasAmount ? "currency" : "amount", hasAmount ? "approvals.e.currency_invalid" : "approvals.e.amount_invalid");
  let amountMinor: number | null = null;
  let currency: string | null = null;
  if (hasAmount && hasCurrency) {
    const minor = input.amountMinor as number;
    if (!Number.isInteger(minor) || minor <= 0 || minor > REWARD_MAX_MINOR) throw bad("amount", "approvals.e.amount_invalid");
    if (!isRewardCurrency(input.currency)) throw bad("currency", "approvals.e.currency_invalid");
    amountMinor = minor;
    currency = input.currency as string;
  }
  return { title, details, amountMinor, currency, link: input.link ?? null };
}

async function assertChain(who: Who, workspaceId: string, approverIds: readonly string[]): Promise<void> {
  const problem = chainProblem(approverIds, who.userId);
  if (problem) throw bad("approverIds", problem);
  if ((await ineligible(who.orgId, workspaceId, approverIds)).length > 0) throw bad("approverIds", "approvals.e.approver_invalid");
}

/** The thing the request is about: in THIS space, and one the requester may open themselves. */
async function assertLink(who: Who, workspaceId: string, link: { kind: LinkKind; id: string } | null): Promise<void> {
  if (!link) return;
  const invalid = bad("link", "approvals.e.link_invalid");
  if (link.kind === "TASK") {
    const scope = await loadWorkScope(who.userId);
    const task = await db.task.findFirst({ where: { id: link.id, orgId: who.orgId, workspaceId, AND: [taskVisibleWhere(scope)] }, select: { id: true } });
    if (!task) throw invalid;
  } else if (link.kind === "CARD") {
    const card = await db.card.findFirst({ where: { id: link.id, orgId: who.orgId, workspaceId, archivedAt: null }, select: { id: true } });
    if (!card) throw invalid;
  } else {
    const message = await db.chatMessage.findFirst({
      where: { id: link.id, orgId: who.orgId, deletedAt: null, conversation: { orgId: who.orgId, spaceId: workspaceId } },
      select: { conversationId: true },
    });
    if (!message || !(await canReadConversation(who.userId, message.conversationId))) throw invalid;
  }
}

/**
 * The files of a version. A file is accepted when it is a fresh chat upload of the requester (uploaded through the one upload
 * route, so already sniffed and size-limited; nobody's message holds it and no other request does), or one this very request
 * already holds (kept across versions). Returns the ids, each once.
 */
async function assertFiles(tx: Tx, who: Who, requestId: string | null, fileIds: readonly string[] | undefined): Promise<string[]> {
  const ids = [...new Set(fileIds ?? [])];
  if (ids.length === 0) return [];
  if (ids.length > APPROVAL_LIMITS.attachments) throw bad("fileIds", "approvals.e.files_many");
  const rows = await tx.storedFile.findMany({
    where: { id: { in: ids }, orgId: who.orgId, deletedAt: null, path: { not: PENDING_PATH } },
    select: { id: true, uploaderId: true, purpose: true, chatLinks: { select: { id: true } } },
  });
  if (rows.length !== ids.length) throw bad("fileIds", "approvals.e.file_invalid");
  const held = await tx.approvalAttachment.findMany({ where: { fileId: { in: ids } }, select: { fileId: true, requestId: true } });
  for (const file of rows) {
    const links = held.filter((h) => h.fileId === file.id);
    const mine = requestId !== null && links.some((h) => h.requestId === requestId);
    if (mine) continue;
    const fresh = file.purpose === "CHAT" && file.uploaderId === who.userId && file.chatLinks.length === 0 && links.length === 0;
    if (!fresh) throw bad("fileIds", "approvals.e.file_invalid");
  }
  return ids;
}

// ───────────────────────────────────────────────────── create ─────────────────────────────────────────────────────

/** A person's own gate for a space: the switch, not a guest, working in it. 404 for a space they cannot see. */
async function workingIn(who: Who, workspaceId: string): Promise<SpaceViewer> {
  await approvalsGate(who);
  const viewer = await spaceViewer(who, workspaceId);
  if (!viewer.sees) throw notFound();
  return viewer;
}

/**
 * «طلب موافقة»: the request, its chain (the first approver is told now) and its files, in one transaction, audited.
 * `form` is set by the forms service: the request then remembers the template version and the answers.
 */
export async function createApproval(actor: Who, input: CreateInput, form?: FormSource): Promise<{ id: string }> {
  const viewer = await workingIn(actor, input.workspaceId);
  if (viewer.archived) throw new ForbiddenError("approvals.e.space_archived");
  const content = contentOf(input);
  await assertChain(actor, input.workspaceId, input.approverIds);
  await assertLink(actor, input.workspaceId, content.link);
  const now = new Date();
  const created = await db.$transaction(async (tx) => {
    const fileIds = await assertFiles(tx, actor, null, input.fileIds);
    const request = await tx.approvalRequest.create({
      data: {
        orgId: actor.orgId,
        workspaceId: input.workspaceId,
        requesterId: actor.userId,
        title: content.title,
        details: content.details,
        amountMinor: content.amountMinor,
        currency: content.currency,
        linkKind: content.link?.kind ?? null,
        linkId: content.link?.id ?? null,
        formId: form?.formId ?? null,
        answers: form ? (form.answers as Prisma.InputJsonValue) : Prisma.JsonNull,
        status: "PENDING",
        version: 1,
        currentStep: 1,
      },
      select: { id: true },
    });
    await tx.approvalStep.createMany({
      data: input.approverIds.map((approverId, i) => ({ requestId: request.id, version: 1, position: i + 1, approverId, notifiedAt: i === 0 ? now : null })),
    });
    if (fileIds.length > 0) {
      await tx.approvalAttachment.createMany({ data: fileIds.map((fileId) => ({ requestId: request.id, fileId, version: 1, addedById: actor.userId })) });
    }
    await tx.auditLog.create({
      data: {
        action: EVENTS.requested,
        actorId: actor.userId,
        orgId: actor.orgId,
        target: request.id,
        workspaceId: input.workspaceId,
        // the amount itself is not copied into the log: only whether there is one
        meta: { version: 1, approverIds: [...input.approverIds], hasAmount: content.amountMinor !== null, files: fileIds.length, formId: form?.formId ?? null },
      },
    });
    return request;
  });
  const names = await namesOf([actor.userId]);
  await notifyApproval("requested", {
    orgId: actor.orgId,
    workspaceId: input.workspaceId,
    requestId: created.id,
    title: content.title,
    userIds: [input.approverIds[0]!],
    actorName: names.get(actor.userId) ?? null,
    titleKey: "approvals.note.requested",
  });
  return { id: created.id };
}

// ───────────────────────────────────────────────────── locking helper ─────────────────────────────────────────────────────

interface Locked {
  id: string;
  orgId: string;
  workspaceId: string;
  requesterId: string;
  title: string;
  details: string;
  amountMinor: number | null;
  currency: string | null;
  status: string;
  version: number;
  currentStep: number;
  linkKind: string | null;
  linkId: string | null;
  formId: string | null;
  answers: Prisma.JsonValue | null;
  history: Prisma.JsonValue;
  createdAt: Date;
}

/** The request row, locked for the rest of the transaction (decisions on one request are taken one after the other). */
async function lockedRequest(tx: Tx, orgId: string, id: string): Promise<Locked> {
  await tx.$queryRaw`SELECT "id" FROM "ApprovalRequest" WHERE "id" = ${id} AND "orgId" = ${orgId} FOR UPDATE`;
  const request = await tx.approvalRequest.findFirst({ where: { id, orgId } });
  if (!request) throw notFound();
  return request;
}

async function everyApprover(tx: Tx, requestId: string): Promise<string[]> {
  const rows = await tx.approvalStep.findMany({ where: { requestId }, select: { approverId: true } });
  return rows.map((r) => r.approverId);
}

// ───────────────────────────────────────────────────── decide ─────────────────────────────────────────────────────

export interface DecideInput {
  decision: Decision;
  reason?: string | null;
}

/**
 * «وافق» / «ارفض» / «اطلب تعديل». Only the named approver whose turn it is. A rejection and a request for changes need a
 * written reason. The owner reading silently decides nothing unless he is that approver.
 */
export async function decideApproval(actor: Who, id: string, input: DecideInput): Promise<{ id: string; status: ApprovalStatus; currentStep: number }> {
  await approvalsGate(actor);
  const problem = reasonProblem(input.decision, input.reason);
  if (problem) throw bad("reason", problem);
  const reason = tidyReason(input.reason ?? "") || null;

  const done = await db.$transaction(async (tx) => {
    const request = await lockedRequest(tx, actor.orgId, id);
    const viewer = await spaceViewer(actor, request.workspaceId);
    const steps = await tx.approvalStep.findMany({ where: { requestId: id, version: request.version }, orderBy: { position: "asc" } });
    const mine = steps.find((s) => s.approverId === actor.userId);
    if (!viewer.sees) throw notFound();
    if (!mine) {
      // somebody who may read it but was not asked: refused; somebody who may not read it: not found
      const readable = mayRead(viewer, actor.userId, request, await everyApprover(tx, id));
      throw readable ? new ForbiddenError("approvals.e.not_approver") : notFound();
    }
    if (request.status !== "PENDING") throw new ApprovalConflictError("approvals.e.not_pending");
    if (mine.status !== "PENDING") throw new ApprovalConflictError("approvals.e.already_decided");
    if (mine.position !== request.currentStep) throw new ForbiddenError("approvals.e.not_your_turn");

    const out = outcomeOf(input.decision, mine.position, steps.length);
    const now = new Date();
    // exactly once: the step must still be PENDING and the request still PENDING at this step
    const stepWon = await tx.approvalStep.updateMany({
      where: { id: mine.id, status: "PENDING" },
      data: { status: out.step, reason, decidedAt: now },
    });
    if (stepWon.count !== 1) throw new ApprovalConflictError("approvals.e.already_decided");
    const requestWon = await tx.approvalRequest.updateMany({
      where: { id, status: "PENDING", currentStep: mine.position, version: request.version },
      data: {
        status: out.request,
        currentStep: out.next ?? request.currentStep,
        decidedAt: out.request === "APPROVED" || out.request === "REJECTED" ? now : null,
      },
    });
    if (requestWon.count !== 1) throw new ApprovalConflictError("approvals.e.not_pending");
    if (out.skipAfter !== null) {
      await tx.approvalStep.updateMany({
        where: { requestId: id, version: request.version, position: { gt: out.skipAfter }, status: "PENDING" },
        data: { status: "SKIPPED" },
      });
    }
    if (out.next !== null) {
      await tx.approvalStep.updateMany({ where: { requestId: id, version: request.version, position: out.next }, data: { notifiedAt: now } });
    }
    const action = out.request === "APPROVED" ? EVENTS.completed : out.request === "REJECTED" ? EVENTS.rejected : out.request === "CHANGES_REQUESTED" ? EVENTS.changes : EVENTS.approved;
    await tx.auditLog.create({
      data: {
        action,
        actorId: actor.userId,
        orgId: actor.orgId,
        target: id,
        workspaceId: request.workspaceId,
        meta: { version: request.version, position: mine.position, decision: input.decision, reason },
      },
    });
    const earlier = steps.filter((s) => s.notifiedAt !== null && s.approverId !== actor.userId && s.position !== out.next).map((s) => s.approverId);
    const nextApprover = out.next !== null ? steps.find((s) => s.position === out.next)?.approverId ?? null : null;
    return { request, out, earlier, nextApprover };
  });

  const { request, out } = done;
  const names = await namesOf([actor.userId]);
  const base = { orgId: actor.orgId, workspaceId: request.workspaceId, requestId: id, title: request.title, actorName: names.get(actor.userId) ?? null };
  if (out.request === "CHANGES_REQUESTED") {
    await notifyApproval("changes", { ...base, userIds: [request.requesterId], titleKey: "approvals.note.changes" });
    await notifyApproval("decided", { ...base, userIds: done.earlier.filter((u) => u !== request.requesterId), titleKey: "approvals.note.sent_back" });
  } else {
    const key = out.request === "APPROVED" ? "approvals.note.approved" : out.request === "REJECTED" ? "approvals.note.rejected" : "approvals.note.step";
    await notifyApproval("decided", { ...base, userIds: [request.requesterId, ...done.earlier.filter((u) => u !== request.requesterId)], titleKey: key });
    if (done.nextApprover) await notifyApproval("requested", { ...base, userIds: [done.nextApprover], titleKey: "approvals.note.requested" });
  }
  return { id, status: out.request, currentStep: out.next ?? request.currentStep };
}

// ───────────────────────────────────────────────────── cancel ─────────────────────────────────────────────────────

/** «ألغِ الطلب»: the requester, while it is being decided or sent back. A status, never a deletion; audited; the people told are told. */
export async function cancelApproval(actor: Who, id: string): Promise<{ id: string; status: "CANCELLED" }> {
  await approvalsGate(actor);
  const done = await db.$transaction(async (tx) => {
    const request = await lockedRequest(tx, actor.orgId, id);
    const viewer = await spaceViewer(actor, request.workspaceId);
    if (!viewer.sees) throw notFound();
    if (request.requesterId !== actor.userId) {
      const readable = mayRead(viewer, actor.userId, request, await everyApprover(tx, id));
      throw readable ? new ForbiddenError("approvals.e.requester_only") : notFound();
    }
    if (request.status !== "PENDING" && request.status !== "CHANGES_REQUESTED") throw new ApprovalConflictError("approvals.e.not_cancellable");
    const now = new Date();
    const won = await tx.approvalRequest.updateMany({
      where: { id, status: { in: ["PENDING", "CHANGES_REQUESTED"] }, version: request.version },
      data: { status: "CANCELLED", decidedAt: now },
    });
    if (won.count !== 1) throw new ApprovalConflictError("approvals.e.not_cancellable");
    await tx.approvalStep.updateMany({ where: { requestId: id, version: request.version, status: "PENDING" }, data: { status: "SKIPPED" } });
    await tx.auditLog.create({
      data: { action: EVENTS.cancelled, actorId: actor.userId, orgId: actor.orgId, target: id, workspaceId: request.workspaceId, meta: { version: request.version, was: request.status } },
    });
    const told = await tx.approvalStep.findMany({ where: { requestId: id, version: request.version, notifiedAt: { not: null } }, select: { approverId: true } });
    return { request, told: told.map((s) => s.approverId).filter((u) => u !== actor.userId) };
  });
  const names = await namesOf([actor.userId]);
  await notifyApproval("decided", {
    orgId: actor.orgId,
    workspaceId: done.request.workspaceId,
    requestId: id,
    title: done.request.title,
    userIds: done.told,
    actorName: names.get(actor.userId) ?? null,
    titleKey: "approvals.note.cancelled",
  });
  return { id, status: "CANCELLED" };
}

// ───────────────────────────────────────────────────── resubmit ─────────────────────────────────────────────────────

export interface ResubmitInput {
  title?: string;
  details?: string | null;
  /** `null` clears the amount; left out keeps it. */
  amountMinor?: number | null;
  currency?: string | null;
  link?: { kind: LinkKind; id: string } | null;
  fileIds?: readonly string[];
  approverIds?: readonly string[];
}

/** What a form-based resubmit supplies in place of title and details: the new answers and the details they render to. */
export interface FormResubmit {
  answers: Record<string, string | number | boolean>;
  details: string;
}

/**
 * The requester edits a request that was sent back and sends it again: a NEW VERSION (the content of the old one is kept in
 * `history`, its steps and files stay under its own version number), a fresh chain (the same people unless the requester
 * picks others), and the first approver is told. Only from CHANGES_REQUESTED, once (a conditional UPDATE).
 */
export async function resubmitApproval(actor: Who, id: string, input: ResubmitInput, form?: FormResubmit): Promise<{ id: string; version: number }> {
  await approvalsGate(actor);
  const done = await db.$transaction(async (tx) => {
    const request = await lockedRequest(tx, actor.orgId, id);
    const viewer = await spaceViewer(actor, request.workspaceId);
    if (!viewer.sees) throw notFound();
    if (request.requesterId !== actor.userId) {
      const readable = mayRead(viewer, actor.userId, request, await everyApprover(tx, id));
      throw readable ? new ForbiddenError("approvals.e.requester_only") : notFound();
    }
    if (request.status !== "CHANGES_REQUESTED") throw new ApprovalConflictError("approvals.e.not_resubmittable");
    if (viewer.archived) throw new ForbiddenError("approvals.e.space_archived");
    if (request.version >= APPROVAL_LIMITS.versions) throw bad("version", "approvals.e.versions_limit");

    const content = contentOf({
      title: form ? request.title : (input.title ?? request.title),
      details: form ? form.details : input.details !== undefined ? input.details : request.details,
      amountMinor: input.amountMinor !== undefined ? input.amountMinor : request.amountMinor,
      currency: input.amountMinor !== undefined ? input.currency : request.currency,
    });
    const link = input.link !== undefined ? input.link : request.linkKind && request.linkId ? { kind: request.linkKind as LinkKind, id: request.linkId } : null;
    await assertLink(actor, request.workspaceId, link);

    const previousSteps = await tx.approvalStep.findMany({ where: { requestId: id, version: request.version }, orderBy: { position: "asc" } });
    const approverIds = input.approverIds ?? previousSteps.map((s) => s.approverId);
    const problem = chainProblem(approverIds, actor.userId);
    if (problem) throw bad("approverIds", problem);
    if ((await ineligible(actor.orgId, request.workspaceId, approverIds)).length > 0) throw bad("approverIds", "approvals.e.approver_invalid");

    const keep = input.fileIds ?? (await tx.approvalAttachment.findMany({ where: { requestId: id, version: request.version }, select: { fileId: true } })).map((a) => a.fileId);
    const fileIds = await assertFiles(tx, actor, id, keep);

    const snapshot: RevisionSnapshot = {
      version: request.version,
      title: request.title,
      details: request.details,
      amountMinor: request.amountMinor,
      currency: request.currency,
      answers: request.answers ?? null,
      // the moment this version was sent: when its chain was written
      submittedAt: (previousSteps[0]?.createdAt ?? request.createdAt).toISOString(),
    };
    const history = [...readHistory(request.history), snapshot];
    const version = request.version + 1;
    const now = new Date();
    const won = await tx.approvalRequest.updateMany({
      where: { id, status: "CHANGES_REQUESTED", version: request.version },
      data: {
        title: content.title,
        details: content.details,
        amountMinor: content.amountMinor,
        currency: content.currency,
        linkKind: link?.kind ?? null,
        linkId: link?.id ?? null,
        answers: form ? (form.answers as Prisma.InputJsonValue) : request.answers === null ? Prisma.JsonNull : (request.answers as Prisma.InputJsonValue),
        history: history as unknown as Prisma.InputJsonValue,
        version,
        currentStep: 1,
        status: "PENDING",
        decidedAt: null,
      },
    });
    if (won.count !== 1) throw new ApprovalConflictError("approvals.e.not_resubmittable");
    await tx.approvalStep.createMany({
      data: approverIds.map((approverId, i) => ({ requestId: id, version, position: i + 1, approverId, notifiedAt: i === 0 ? now : null })),
    });
    if (fileIds.length > 0) await tx.approvalAttachment.createMany({ data: fileIds.map((fileId) => ({ requestId: id, fileId, version, addedById: actor.userId })) });
    await tx.auditLog.create({
      data: {
        action: EVENTS.resubmitted,
        actorId: actor.userId,
        orgId: actor.orgId,
        target: id,
        workspaceId: request.workspaceId,
        meta: { version, approverIds: [...approverIds], hasAmount: content.amountMinor !== null, files: fileIds.length },
      },
    });
    return { request, content, first: approverIds[0]!, version };
  });
  const names = await namesOf([actor.userId]);
  await notifyApproval("requested", {
    orgId: actor.orgId,
    workspaceId: done.request.workspaceId,
    requestId: id,
    title: done.content.title,
    userIds: [done.first],
    actorName: names.get(actor.userId) ?? null,
    titleKey: "approvals.note.resubmitted",
  });
  return { id, version: done.version };
}

// ───────────────────────────────────────────────────── reading ─────────────────────────────────────────────────────

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

interface ViewerSpaces {
  /** Every space the person works in, with whether they manage it. */
  spaces: { id: string; name: string; manager: boolean }[];
}

/** The spaces a person works in (the OWNER: every space of the company), each with whether they manage it. */
export async function workSpacesOf(actor: Who): Promise<ViewerSpaces["spaces"]> {
  if (actor.role === "GUEST") return [];
  if (actor.role === "OWNER") {
    const all = await db.workspace.findMany({ where: { organizationId: actor.orgId }, select: { id: true, name: true }, orderBy: [{ position: "asc" }, { name: "asc" }] });
    return all.map((w) => ({ ...w, manager: true }));
  }
  const rows = await db.workspaceMember.findMany({
    where: { userId: actor.userId, workspace: { organizationId: actor.orgId } },
    select: { role: true, workspace: { select: { id: true, name: true } } },
  });
  return rows
    .filter((r) => canWriteInWorkspace(actor.role, r.role))
    .map((r) => ({ id: r.workspace.id, name: r.workspace.name, manager: isSpaceManager(actor.role, r.role) }));
}

type ListRow = Prisma.ApprovalRequestGetPayload<{ include: { steps: true } }>;

async function toListItems(rows: ListRow[], actor: Who, spaceNames: Map<string, string>): Promise<ListItem[]> {
  const people = await namesOf(rows.flatMap((r) => [r.requesterId, ...r.steps.map((s) => s.approverId)]));
  const person = (id: string): PersonRef => ({ id, name: people.get(id) ?? "" });
  const showAmount = actor.role !== "GUEST";
  return rows.map((r) => {
    const steps = r.steps.filter((s) => s.version === r.version).sort((a, b) => a.position - b.position);
    const current = r.status === "PENDING" ? steps.find((s) => s.position === r.currentStep) : undefined;
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      workspaceName: spaceNames.get(r.workspaceId) ?? "",
      title: r.title,
      status: r.status,
      version: r.version,
      currentStep: r.currentStep,
      requester: person(r.requesterId),
      amount: showAmount && r.amountMinor !== null && r.currency ? { minor: r.amountMinor, currency: r.currency } : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      decidedAt: iso(r.decidedAt),
      steps: steps.map((s) => ({ position: s.position, approver: person(s.approverId), status: s.status })),
      waitingOn: current ? person(current.approverId) : null,
      fromForm: r.formId !== null,
    };
  });
}

export interface ListOptions {
  view: "mine" | "waiting" | "all";
  /** Narrow to one space (the page passes the space the person is in). */
  workspaceId?: string | null;
  /** Narrow to one status. */
  status?: string | null;
  limit?: number;
}

const LIST_LIMIT = 100;

/**
 * The three lists. «طلباتي»: what the person asked. «بانتظاري»: requests whose turn is THEIRS now (their step is the one that
 * decides). «كل الطلبات»: the OWNER reads every request of the company (silently: no trace); a space ADMIN reads those of the
 * spaces they manage; anybody else is refused (403 `approvals.e.all_denied`).
 */
export async function listApprovals(actor: Who, opts: ListOptions): Promise<ListItem[]> {
  await approvalsGate(actor);
  const spaces = await workSpacesOf(actor);
  const names = new Map(spaces.map((s) => [s.id, s.name] as const));
  const limit = Math.min(Math.max(opts.limit ?? LIST_LIMIT, 1), 200);
  const status = opts.status && isApprovalStatus(opts.status) ? opts.status : undefined;
  const narrow = opts.workspaceId ? [opts.workspaceId] : null;
  let allowed: string[];
  if (opts.view === "all") {
    if (!actor.isOwner) {
      const managed = spaces.filter((s) => s.manager).map((s) => s.id);
      if (managed.length === 0) throw new ForbiddenError("approvals.e.all_denied");
      allowed = managed;
    } else allowed = spaces.map((s) => s.id);
  } else allowed = spaces.map((s) => s.id);
  if (narrow) allowed = allowed.filter((id) => narrow.includes(id));
  if (allowed.length === 0) return [];

  let ids: string[] | null = null;
  if (opts.view === "waiting") {
    // exact: the person's step is the request's CURRENT one in its CURRENT version (one join, no guessing in memory)
    const found = await db.$queryRaw<{ id: string }[]>`
      SELECT r."id" FROM "ApprovalRequest" r
      JOIN "ApprovalStep" s ON s."requestId" = r."id" AND s."version" = r."version" AND s."position" = r."currentStep"
      WHERE r."orgId" = ${actor.orgId} AND r."status" = 'PENDING' AND s."approverId" = ${actor.userId} AND s."status" = 'PENDING'
        AND r."workspaceId" IN (${Prisma.join(allowed)})
      ORDER BY r."createdAt" DESC LIMIT ${limit}`;
    ids = found.map((f) => f.id);
    if (ids.length === 0) return [];
  }
  const rows = await db.approvalRequest.findMany({
    where: {
      orgId: actor.orgId,
      workspaceId: { in: allowed },
      ...(opts.view === "mine" ? { requesterId: actor.userId } : {}),
      ...(ids ? { id: { in: ids } } : {}),
      ...(status ? { status } : {}),
    },
    include: { steps: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return toListItems(rows, actor, names);
}

async function attachmentsOf(requestId: string): Promise<AttachmentView[]> {
  const rows = await db.approvalAttachment.findMany({ where: { requestId }, orderBy: [{ version: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  if (rows.length === 0) return [];
  const files = await db.storedFile.findMany({
    where: { id: { in: rows.map((r) => r.fileId) }, deletedAt: null, path: { not: PENDING_PATH } },
    select: { id: true, name: true, mimeType: true, size: true },
  });
  const byId = new Map(files.map((f) => [f.id, f] as const));
  return rows.flatMap((r) => {
    const f = byId.get(r.fileId);
    return f ? [{ id: r.id, fileId: f.id, name: f.name, mimeType: f.mimeType, size: f.size, version: r.version, url: `/api/files/${f.id}/raw` }] : [];
  });
}

async function linkOf(kind: string | null, id: string | null, orgId: string): Promise<LinkView | null> {
  if (!kind || !id) return null;
  if (kind === "TASK") return { kind, id, href: (await db.task.findFirst({ where: { id, orgId }, select: { id: true } })) ? `/tasks/${id}` : null };
  if (kind === "CARD") return { kind, id, href: (await db.card.findFirst({ where: { id, orgId }, select: { id: true } })) ? `/cards/${id}` : null };
  if (kind === "MESSAGE") {
    const m = await db.chatMessage.findFirst({ where: { id, orgId }, select: { conversationId: true } });
    return { kind, id, href: m ? `/chat/${m.conversationId}` : null };
  }
  return null;
}

/**
 * The whole request, for a person who may read it (the requester, somebody in its chain, the space's managers, the owner:
 * silently — reading leaves no trace). Anybody else: 404, the same as for one that does not exist.
 */
export async function getApproval(actor: Who, id: string): Promise<ApprovalDetail> {
  await approvalsGate(actor);
  const request = await db.approvalRequest.findFirst({ where: { id, orgId: actor.orgId }, include: { steps: true } });
  if (!request) throw notFound();
  const viewer = await spaceViewer(actor, request.workspaceId);
  const approverIds = request.steps.map((s) => s.approverId);
  if (!mayRead(viewer, actor.userId, request, approverIds)) throw notFound();

  const space = await db.workspace.findUnique({ where: { id: request.workspaceId }, select: { name: true } });
  const [item] = await toListItems([request], actor, new Map([[request.workspaceId, space?.name ?? ""]]));
  const people = await namesOf(approverIds);
  const stepView = (s: (typeof request.steps)[number]): StepView => ({
    id: s.id,
    version: s.version,
    position: s.position,
    approver: { id: s.approverId, name: people.get(s.approverId) ?? "" },
    status: s.status,
    reason: s.reason,
    notifiedAt: iso(s.notifiedAt),
    decidedAt: iso(s.decidedAt),
  });
  const sorted = [...request.steps].sort((a, b) => a.version - b.version || a.position - b.position);
  const attachments = await attachmentsOf(id);
  const history = readHistory(request.history);
  const mine = request.steps.find((s) => s.version === request.version && s.approverId === actor.userId);
  const isRequester = request.requesterId === actor.userId;
  const form = request.formId ? await db.formTemplate.findUnique({ where: { id: request.formId }, select: { id: true, name: true, version: true, schema: true } }) : null;
  const canResubmit = isRequester && request.status === "CHANGES_REQUESTED";
  const checkedSchema = form ? validateSchema(form.schema) : null;
  const stored = request.answers && typeof request.answers === "object" && !Array.isArray(request.answers) ? (request.answers as Answers) : {};

  return {
    ...item!,
    details: request.details,
    linkedTo: await linkOf(request.linkKind, request.linkId, actor.orgId),
    attachments: attachments.filter((a) => a.version === request.version),
    stepsDetail: sorted.filter((s) => s.version === request.version).map(stepView),
    previous: history.map((h) => ({
      ...h,
      // an earlier version's amount is as private as the current one's (this reader may read the request, so they may read it)
      steps: sorted.filter((s) => s.version === h.version).map(stepView),
      attachments: attachments.filter((a) => a.version === h.version),
    })),
    form: form ? { id: form.id, name: form.name, version: form.version } : null,
    // only the requester who must edit it is handed the questions and the answers
    formFill: canResubmit && checkedSchema?.ok ? { schema: checkedSchema.value, answers: stored } : null,
    you: {
      requester: isRequester,
      approver: mine !== undefined,
      canDecide: mine !== undefined && request.status === "PENDING" && mine.status === "PENDING" && mine.position === request.currentStep && viewer.sees,
      canCancel: isRequester && (request.status === "PENDING" || request.status === "CHANGES_REQUESTED"),
      canResubmit,
      oversight: !isRequester && mine === undefined,
    },
  };
}

/** The space a request belongs to (for the page's «enter that space first» step); null for one the person may not read. */
export async function spaceOfApproval(actor: Who, id: string): Promise<string | null> {
  const request = await db.approvalRequest.findFirst({ where: { id, orgId: actor.orgId }, select: { workspaceId: true, requesterId: true, steps: { select: { approverId: true } } } });
  if (!request) return null;
  const viewer = await spaceViewer(actor, request.workspaceId);
  return mayRead(viewer, actor.userId, request, request.steps.map((s) => s.approverId)) ? request.workspaceId : null;
}

/** «بانتظاري»: how many requests wait for this person now (for a badge); 0 while the feature is off for them. */
export async function waitingCount(actor: Who): Promise<number> {
  await approvalsGate(actor);
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "ApprovalRequest" r
    JOIN "ApprovalStep" s ON s."requestId" = r."id" AND s."version" = r."version" AND s."position" = r."currentStep"
    WHERE r."orgId" = ${actor.orgId} AND r."status" = 'PENDING' AND s."approverId" = ${actor.userId} AND s."status" = 'PENDING'`;
  return Number(rows[0]?.n ?? 0);
}

// ───────────────────────────────────────────────────── on a task or a card ─────────────────────────────────────────────────────

export interface LinkedApprovals {
  /** The person may ask for an approval about this thing (works in its space, not a guest, the space is not archived). */
  canAsk: boolean;
  /** The requests about it that THIS person may read (same rule as `getApproval`), newest first. No amount, no details. */
  items: ListItem[];
}

const LINKED_LIMIT = 20;

/**
 * «طلب موافقة» on a task or a card: the requests whose link points at it, each shown only to a person who may read THAT request
 * (the requester, somebody named in its chain, the space's managers, the owner: the same `mayRead` as the request's own page), and
 * whether this person may open a new one. `null` while the `approvals` switch is off or for an external partner: the section does not
 * exist for them. The amount is cut from the list on purpose: a task's page is read by many people, the request's page by few.
 *
 * ⚠️ The caller has already checked that the viewer may open the task / card itself. 🔧 This function re-checks each request.
 */
export async function approvalsLinkedTo(actor: Who, kind: "TASK" | "CARD", id: string, workspaceId: string): Promise<LinkedApprovals | null> {
  if (actor.role === "GUEST" || actor.isExternal) return null;
  try {
    await approvalsGate(actor);
  } catch {
    return null;
  }
  const viewerHere = await spaceViewer(actor, workspaceId);
  const rows = await db.approvalRequest.findMany({
    where: { orgId: actor.orgId, linkKind: kind, linkId: id },
    include: { steps: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LINKED_LIMIT * 3,
  });
  const viewers = new Map<string, SpaceViewer>([[workspaceId, viewerHere]]);
  const readable: ListRow[] = [];
  for (const r of rows) {
    let viewer = viewers.get(r.workspaceId);
    if (!viewer) {
      viewer = await spaceViewer(actor, r.workspaceId);
      viewers.set(r.workspaceId, viewer);
    }
    if (mayRead(viewer, actor.userId, r, r.steps.map((s) => s.approverId))) readable.push(r);
    if (readable.length >= LINKED_LIMIT) break;
  }
  const spaces = await db.workspace.findMany({ where: { id: { in: [...new Set(readable.map((r) => r.workspaceId))] } }, select: { id: true, name: true } });
  const items = (await toListItems(readable, actor, new Map(spaces.map((s) => [s.id, s.name] as const)))).map((i) => ({ ...i, amount: null }));
  return { canAsk: viewerHere.sees && !viewerHere.archived, items };
}
