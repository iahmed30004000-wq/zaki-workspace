import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { FORM_LIMITS, moneyOf, purposeOf, renderAnswers, renderedProblem, validateAnswers, validateSchema, type Answers, type FormSchema, type Issue } from "@/lib/approvals/forms";
import { chainProblem } from "@/lib/approvals/shared";
import type { FormListItem, PersonRef } from "@/lib/approvals/view";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { approvalsGate, ineligible, notFound, spaceViewer } from "./approval-access";
import { namesOf } from "./approval-notify";
import { ApprovalConflictError, createApproval, resubmitApproval, type ResubmitInput } from "./approvals";

/**
 * «نموذج» — reusable forms that create approval requests.
 *
 * WHO: the OWNER and the space's ADMIN (an org ADMIN who is in it) define, edit and archive the forms of a space; anybody who
 * works in the space fills them. A guest sees none (the switch and the guest gate are the first line of every function).
 *
 * VERSIONS: a template row is never changed. An edit adds the next `version` of the same `familyId` and the old row stops
 * being `isLatest` (one conditional UPDATE: two editors at once, the second gets 409). A request keeps the row it was filled
 * from (`formId`), so it keeps its own questions; its answers were validated against exactly that version.
 *
 * A FORM IS DATA: six field types and a fixed list of properties (src/lib/approvals/forms.ts); no script, no formula, no file.
 *
 * MONEY FORMS (I1.3): a schema with a `purpose` («طلب مصروف», «تحويل بين الصناديق») behind the switch `expenseForms`. Its `amount` and `currency`
 * answers are lifted into the request's own amount columns (cut on the server for anybody without `prices.view` / `cash.view`, src/server/services/approvals.ts)
 * and are never written into the request's words or its stored answers. Internal office spending only; nothing moves money.
 */

type Who = Pick<Actor, "userId" | "orgId" | "role" | "isOwner" | "isExternal">;

const bad = (path: string, message: string) => new ValidationError([{ path, message }]);
const issuesError = (issues: Issue[]) => new ValidationError(issues.map((i) => ({ path: i.path, message: i.message })));

export interface FormDetail {
  id: string;
  familyId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  version: number;
  schema: FormSchema;
  archived: boolean;
  /** The person may edit and archive it. */
  canManage: boolean;
  approvers: PersonRef[];
  approverProblem: boolean;
}

export interface FormBody {
  name: string;
  description?: string | null;
  schema: unknown;
}

function tidyName(name: string): string {
  const text = (name ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw bad("name", "approvals.f.name_required");
  if (text.length > FORM_LIMITS.name) throw bad("name", "approvals.f.name_long");
  return text;
}

function tidyDescription(text: string | null | undefined): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length > FORM_LIMITS.description) throw bad("description", "approvals.f.description_long");
  return t || null;
}

/** The stored column read back as a schema (a row written by this code always is one; anything else reads as empty). */
function schemaOf(raw: Prisma.JsonValue): FormSchema {
  const checked = validateSchema(raw);
  return checked.ok ? checked.value : { fields: [], approvers: [] };
}

async function managerOf(who: Who, workspaceId: string): Promise<void> {
  await approvalsGate(who);
  const viewer = await spaceViewer(who, workspaceId);
  if (!viewer.sees) throw notFound();
  if (!viewer.manager) throw new ForbiddenError("approvals.f.manage_denied");
  if (viewer.archived) throw new ForbiddenError("approvals.e.space_archived");
}

/** The latest row of a family, for a person who works in its space (404 otherwise). */
async function latestRow(who: Who, familyId: string) {
  await approvalsGate(who);
  const row = await db.formTemplate.findFirst({ where: { familyId, orgId: who.orgId, isLatest: true } });
  if (!row) throw notFound();
  const viewer = await spaceViewer(who, row.workspaceId);
  if (!viewer.sees) throw notFound();
  return { row, viewer };
}

/** The forms of a space. A person who is not a manager sees the ones that can be filled; a manager also the archived ones. */
export async function listForms(who: Who, workspaceId: string): Promise<FormListItem[]> {
  await approvalsGate(who);
  const viewer = await spaceViewer(who, workspaceId);
  if (!viewer.sees) throw notFound();
  const moneyOn = await isFeatureOn(who.orgId, "expenseForms");
  const rows = (
    await db.formTemplate.findMany({
      where: { orgId: who.orgId, workspaceId, isLatest: true, ...(viewer.manager ? {} : { archivedAt: null }) },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    })
  ).filter((r) => moneyOn || purposeOf(r.schema) === null);
  const names = await namesOf(rows.flatMap((r) => schemaOf(r.schema).approvers));
  const gone = new Set(await ineligible(who.orgId, workspaceId, [...new Set(rows.flatMap((r) => schemaOf(r.schema).approvers))]));
  return rows.map((r) => {
    const schema = schemaOf(r.schema);
    return {
      id: r.familyId,
      familyId: r.familyId,
      workspaceId: r.workspaceId,
      name: r.name,
      description: r.description,
      version: r.version,
      fields: schema.fields.length,
      approvers: schema.approvers.map((id) => ({ id, name: names.get(id) ?? "" })),
      approverProblem: schema.approvers.some((id) => gone.has(id)),
      archived: r.archivedAt !== null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/** One form (its latest version) with its fields, for the filler and the editor. */
export async function getForm(who: Who, familyId: string): Promise<FormDetail> {
  const { row, viewer } = await latestRow(who, familyId);
  if (row.archivedAt && !viewer.manager) throw notFound();
  // a money form does not exist while the switch is off (the requests already made stay readable)
  if (purposeOf(row.schema) !== null && !(await isFeatureOn(who.orgId, "expenseForms"))) throw notFound();
  const schema = schemaOf(row.schema);
  const names = await namesOf(schema.approvers);
  return {
    id: row.id,
    familyId: row.familyId,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    version: row.version,
    schema,
    archived: row.archivedAt !== null,
    canManage: viewer.manager && !viewer.archived,
    approvers: schema.approvers.map((id) => ({ id, name: names.get(id) ?? "" })),
    approverProblem: (await ineligible(who.orgId, row.workspaceId, schema.approvers)).length > 0,
  };
}

async function checkedSchema(who: Who, workspaceId: string, raw: unknown): Promise<FormSchema> {
  const checked = validateSchema(raw);
  if (!checked.ok) throw issuesError(checked.issues);
  if ((await ineligible(who.orgId, workspaceId, checked.value.approvers)).length > 0) throw bad("approvers", "approvals.e.approver_invalid");
  return checked.value;
}

/** «نموذج جديد»: a manager of the space. Version 1. Audited. */
export async function createForm(who: Who, workspaceId: string, body: FormBody): Promise<{ id: string; familyId: string; version: number }> {
  await managerOf(who, workspaceId);
  if (purposeOf(body.schema) !== null) await assertFeatureOn(who.orgId, "expenseForms");
  const name = tidyName(body.name);
  const description = tidyDescription(body.description);
  const schema = await checkedSchema(who, workspaceId, body.schema);
  const familyId = randomUUID();
  const row = await db.$transaction(async (tx) => {
    const created = await tx.formTemplate.create({
      data: { orgId: who.orgId, workspaceId, familyId, version: 1, name, description, schema: schema as unknown as Prisma.InputJsonValue, createdById: who.userId },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: { action: "form.created", actorId: who.userId, orgId: who.orgId, target: familyId, workspaceId, meta: { version: 1, fields: schema.fields.length } },
    });
    return created;
  });
  return { id: row.id, familyId, version: 1 };
}

/**
 * Edit a form = write its NEXT version. The old row is closed with one conditional UPDATE (`isLatest` true → false): two
 * editors at once, or an editor who started from an older version (`baseVersion`), get 409. Requests keep their own version.
 */
export async function updateForm(who: Who, familyId: string, body: FormBody & { baseVersion?: number }): Promise<{ id: string; familyId: string; version: number }> {
  const { row } = await latestRow(who, familyId);
  await managerOf(who, row.workspaceId);
  // a money form stays a money form: an edit that drops (or changes) its purpose would let its next version carry the amount in the open
  const was = purposeOf(row.schema);
  const next = purposeOf(body.schema);
  if (was !== null || next !== null) await assertFeatureOn(who.orgId, "expenseForms");
  if (was !== null && next !== was) throw bad("purpose", "approvals.f.purpose_locked");
  const name = tidyName(body.name);
  const description = tidyDescription(body.description);
  const schema = await checkedSchema(who, row.workspaceId, body.schema);
  if (body.baseVersion !== undefined && body.baseVersion !== row.version) throw new ApprovalConflictError("approvals.f.stale");
  const written = await db.$transaction(async (tx) => {
    const closed = await tx.formTemplate.updateMany({ where: { id: row.id, isLatest: true }, data: { isLatest: false } });
    if (closed.count !== 1) throw new ApprovalConflictError("approvals.f.stale");
    const created = await tx.formTemplate.create({
      data: {
        orgId: row.orgId,
        workspaceId: row.workspaceId,
        familyId,
        version: row.version + 1,
        name,
        description,
        schema: schema as unknown as Prisma.InputJsonValue,
        archivedAt: row.archivedAt,
        createdById: who.userId,
      },
      select: { id: true, version: true },
    });
    await tx.auditLog.create({
      data: { action: "form.updated", actorId: who.userId, orgId: who.orgId, target: familyId, workspaceId: row.workspaceId, meta: { from: row.version, to: created.version, fields: schema.fields.length } },
    });
    return created;
  });
  return { id: written.id, familyId, version: written.version };
}

/** «أرشِف» / «أعِد»: nothing is deleted; an archived form is not offered for filling and keeps every request made from it. */
export async function setFormArchived(who: Who, familyId: string, archived: boolean): Promise<{ familyId: string; archived: boolean }> {
  const { row } = await latestRow(who, familyId);
  await managerOf(who, row.workspaceId);
  await db.$transaction(async (tx) => {
    const won = await tx.formTemplate.updateMany({ where: { id: row.id, isLatest: true }, data: { archivedAt: archived ? new Date() : null } });
    if (won.count !== 1) throw new ApprovalConflictError("approvals.f.stale");
    await tx.auditLog.create({
      data: { action: archived ? "form.archived" : "form.restored", actorId: who.userId, orgId: who.orgId, target: familyId, workspaceId: row.workspaceId, meta: { version: row.version } },
    });
  });
  return { familyId, archived };
}

export interface FillInput {
  answers: unknown;
  fileIds?: readonly string[];
  link?: { kind: "TASK" | "CARD" | "MESSAGE"; id: string } | null;
}

/** «املأ النموذج»: the answers are checked against the latest version, written as labelled lines, and the preset chain is asked. */
export async function submitForm(who: Who, familyId: string, input: FillInput): Promise<{ id: string }> {
  const { row } = await latestRow(who, familyId);
  if (row.archivedAt) throw new ApprovalConflictError("approvals.f.archived");
  const schema = schemaOf(row.schema);
  // a money form is filled only while the switch is on (404 `features.off`, like any switched-off feature)
  if (schema.purpose) await assertFeatureOn(who.orgId, "expenseForms");
  const checked = validateAnswers(schema, input.answers);
  if (!checked.ok) throw issuesError(checked.issues);
  const money = moneyOf(schema, checked.value);
  if (money && !money.ok) throw issuesError(money.issues);
  const kept = money?.ok ? money.value.rest : checked.value;
  const details = renderAnswers(schema, kept);
  const long = renderedProblem(details);
  if (long) throw bad("answers", long);
  const own = chainProblem(schema.approvers, who.userId);
  if (own) throw bad("approvers", own);
  if ((await ineligible(who.orgId, row.workspaceId, schema.approvers)).length > 0) throw bad("approvers", "approvals.f.preset_invalid");
  return createApproval(
    who,
    {
      workspaceId: row.workspaceId,
      title: row.name,
      details,
      approverIds: schema.approvers,
      link: input.link ?? null,
      fileIds: input.fileIds,
      ...(money?.ok ? { amountMinor: money.value.amountMinor, currency: money.value.currency } : {}),
    },
    { formId: row.id, answers: kept },
  );
}

/**
 * The same for a request that was filled from a form and sent back: the answers are checked against the version the request
 * was FILLED with (not a newer one), and the details are written again from them.
 */
export async function resubmitForm(who: Who, requestId: string, answers: unknown, rest: Omit<ResubmitInput, "title" | "details">): Promise<{ id: string; version: number }> {
  await approvalsGate(who);
  const request = await db.approvalRequest.findFirst({ where: { id: requestId, orgId: who.orgId }, select: { formId: true, requesterId: true } });
  if (!request) throw notFound();
  // anybody but the requester is refused (or not told it exists) by the plain resubmit, before a single answer is read
  if (request.requesterId !== who.userId) return resubmitApproval(who, requestId, rest);
  if (!request.formId) throw bad("answers", "approvals.f.not_a_form");
  const row = await db.formTemplate.findUnique({ where: { id: request.formId } });
  if (!row) throw bad("answers", "approvals.f.not_a_form");
  const schema = schemaOf(row.schema);
  const checked = validateAnswers(schema, answers);
  if (!checked.ok) throw issuesError(checked.issues);
  const money = moneyOf(schema, checked.value);
  if (money && !money.ok) throw issuesError(money.issues);
  const kept = money?.ok ? money.value.rest : (checked.value as Answers);
  const details = renderAnswers(schema, kept);
  const long = renderedProblem(details);
  if (long) throw bad("answers", long);
  // the amount of a money form comes from its answers, never from the body's own amount boxes
  const amount = money?.ok ? { amountMinor: money.value.amountMinor, currency: money.value.currency } : {};
  return resubmitApproval(who, requestId, { ...rest, ...amount }, { answers: kept, details });
}
