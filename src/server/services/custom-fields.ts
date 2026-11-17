import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, audit, requireProjectAccess, requireTaskAccess, type OrgAccessContext } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { assertRewardEditable } from "@/server/services/reward-guard";
import type { FieldFilter, FieldSort } from "@/server/services/views";
import { RequiredFieldsError } from "@/server/custom-fields-error";
import { STEP_GAP, crowded, positionBetween, reorder } from "@/lib/task-steps";
import { cellOf, type FieldCell } from "@/lib/custom-fields-display";
import {
  FILTER_TYPES,
  MAX_ACTIVE_FIELDS,
  MAX_TOTAL_FIELDS,
  SORT_TYPES,
  cleanLabel,
  cleanUnit,
  fromStored,
  isChoice,
  isCurrency,
  isFieldType,
  mergeOptions,
  missingRequired,
  readConfig,
  toDefDto,
  validateValue,
  type FieldConfig,
  type FieldDefDto,
  type FieldType,
  type OptionInput,
  type Problem,
  type StoredRow,
} from "@/lib/custom-fields";

/**
 * «حقول مخصصة» — the custom fields of a project's tasks.
 *
 * WHO. The DEFINITIONS (the project's schema) belong to the space's ADMIN and the owner alone (`requireProjectAccess` with the
 * ADMIN role, then the projects row of the section grid). The VALUES belong to whoever may edit the task (the writing roles, then
 * the tasks row), except that the owner reading a space he is not in reads silently and writes nothing, and a reward task keeps its
 * owner-only lock (`assertRewardEditable`). An external partner — an org GUEST, or somebody whose row in the space says GUEST —
 * is handed NO field at all, neither the definitions nor a value, and a money field never reaches one by any road.
 *
 * REQUIRED FIELDS are enforced where a task is FINISHED (`assertRequiredFilled`, called by `moveTask` and `setTaskCompletion` inside
 * their transaction, after the row lock) and nowhere else: a quick-add never asks for them. Switched off, nothing is enforced.
 *
 * The company's `customFields` switch closes every door of this file; nothing stored is lost.
 */

const FEATURE = "customFields" as const;
const DEF_SELECT = { id: true, label: true, type: true, required: true, archived: true, config: true, position: true } as const;

type Tx = Prisma.TransactionClient;

export function newOptionId(): string {
  return `o_${randomBytes(6).toString("hex")}`;
}

function problem(p: Problem): never {
  throw new ValidationError([{ path: p.path, message: p.key }]);
}

/** Is this person an external partner for this space (an org GUEST, or a row of the space that says GUEST — the owner never is)? */
export async function isPartnerIn(ctx: { orgId: string; userId: string; orgRole?: string }, workspaceId: string): Promise<boolean> {
  if (ctx.orgRole === "OWNER") return false;
  if (ctx.orgRole === "GUEST") return true;
  const org = ctx.orgRole
    ? null
    : await db.organizationMember.findFirst({ where: { organizationId: ctx.orgId, userId: ctx.userId, status: "ACTIVE" }, select: { role: true } });
  if (org?.role === "GUEST") return true;
  if (org?.role === "OWNER") return false;
  const row = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: ctx.userId } }, select: { role: true } });
  return row?.role === "GUEST";
}

// ---------- the definitions ----------

/** The live fields of a project, in the project's order (archived ones only when asked). The caller has passed the project's guard. */
export async function fieldDefsOf(projectId: string, opts: { archived?: boolean } = {}, client: Tx | typeof db = db): Promise<FieldDefDto[]> {
  const rows = await client.projectField.findMany({
    where: { projectId, ...(opts.archived ? {} : { archived: false }) },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: DEF_SELECT,
  });
  return rows.map(toDefDto);
}

/** Reading the definitions: the project's guard, then the switch. A partner reads none. */
export async function listProjectFields(projectId: string, opts: { includeArchived?: boolean } = {}): Promise<FieldDefDto[]> {
  const access = await requireProjectAccess(projectId);
  await assertMemberCan(access, "projects.view", "section.view_denied", { spaceGuestsPass: true });
  await assertFeatureOn(access.orgId, FEATURE);
  if (await isPartnerIn(access, access.project.workspaceId)) return [];
  const manager = access.orgRole === "OWNER" || (await isSpaceAdmin(access, access.project.workspaceId));
  return fieldDefsOf(projectId, { archived: Boolean(opts.includeArchived) && manager });
}

/** An ADMIN row in the space (an org ADMIN who is in it counts too: `requireWorkspace` already said so). */
async function isSpaceAdmin(ctx: { userId: string; orgRole: string }, workspaceId: string): Promise<boolean> {
  if (ctx.orgRole === "OWNER") return true;
  if (ctx.orgRole === "GUEST") return false;
  const row = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: ctx.userId } }, select: { role: true } });
  return row != null && (row.role === "ADMIN" || ctx.orgRole === "ADMIN");
}

/** The door of every definition write: the space's ADMIN or the owner, the projects row, the switch. */
async function manageAccess(projectId: string): Promise<OrgAccessContext & { project: { id: string; workspaceId: string; teamId: string | null } }> {
  const access = await requireProjectAccess(projectId, ["ADMIN"]);
  await assertMemberCan(access, "projects.edit", "section.edit_denied");
  await assertFeatureOn(access.orgId, FEATURE);
  return access;
}

export interface FieldInput {
  label: string;
  type: string;
  required?: boolean;
  unit?: string | null;
  currency?: string | null;
  options?: OptionInput[];
}

function configFor(type: FieldType, input: { unit?: string | null | undefined; currency?: string | null | undefined; options?: OptionInput[] | undefined }, stored: FieldConfig): FieldConfig {
  const config: FieldConfig = {};
  if (type === "NUMBER") {
    const unit = cleanUnit(input.unit === undefined ? (stored.unit ?? null) : input.unit);
    if (!unit.ok) problem(unit);
    if (unit.value) config.unit = unit.value;
  }
  if (type === "MONEY") {
    const currency = input.currency === undefined ? stored.currency : input.currency;
    if (!isCurrency(currency)) throw new ValidationError([{ path: "currency", message: "fields.currency_invalid" }]);
    config.currency = currency;
  }
  if (isChoice(type)) {
    const merged = input.options === undefined ? { ok: true as const, value: stored.options ?? [] } : mergeOptions(stored.options ?? [], input.options, newOptionId);
    if (!merged.ok) problem(merged);
    if (merged.value.filter((o) => !o.deleted).length === 0) throw new ValidationError([{ path: "options", message: "fields.options_required" }]);
    config.options = merged.value;
  }
  return config;
}

export async function createField(projectId: string, input: FieldInput): Promise<FieldDefDto> {
  const access = await manageAccess(projectId);
  const label = cleanLabel(input.label);
  if (!label.ok) problem(label);
  if (!isFieldType(input.type)) throw new ValidationError([{ path: "type", message: "fields.type_invalid" }]);
  const type = input.type;
  const config = configFor(type, input, {});
  const row = await db.$transaction(async (tx) => {
    // the project's row is held while the fields are counted and the new one is written, so two adds at once cannot pass 15
    await tx.$queryRaw`SELECT 1 FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
    const [active, total, last] = await Promise.all([
      tx.projectField.count({ where: { projectId, archived: false } }),
      tx.projectField.count({ where: { projectId } }),
      tx.projectField.findFirst({ where: { projectId }, orderBy: [{ position: "desc" }, { id: "desc" }], select: { position: true } }),
    ]);
    if (active >= MAX_ACTIVE_FIELDS || total >= MAX_TOTAL_FIELDS) throw new ForbiddenError("fields.too_many");
    return tx.projectField.create({
      data: {
        orgId: access.orgId,
        projectId,
        label: label.value,
        type,
        required: input.required === true,
        position: positionBetween(last ? Number(last.position.toString()) : null, null),
        config: config as Prisma.InputJsonValue,
        createdById: access.userId,
      },
      select: DEF_SELECT,
    });
  });
  await audit("customField.created", { actorId: access.userId, orgId: access.orgId, target: row.id, meta: { projectId, type } });
  return toDefDto(row);
}

export interface FieldPatch {
  label?: string;
  required?: boolean;
  archived?: boolean;
  unit?: string | null;
  currency?: string | null;
  options?: OptionInput[];
  /** Sit right after this field (`null`: first). Absent: the field stays where it is. */
  afterId?: string | null;
}

/** A field named by id, of THIS project and company: a field id from another project is «not found». */
async function fieldOf(projectId: string, orgId: string, fieldId: string, client: Tx | typeof db = db) {
  const row = await client.projectField.findFirst({ where: { id: fieldId, projectId, orgId }, select: DEF_SELECT });
  if (!row) throw new NotFoundError("fields.not_found");
  return row;
}

export async function updateField(projectId: string, fieldId: string, patch: FieldPatch): Promise<FieldDefDto> {
  const access = await manageAccess(projectId);
  const saved = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
    const field = await fieldOf(projectId, access.orgId, fieldId, tx);
    if (!isFieldType(field.type)) throw new NotFoundError("fields.not_found");
    const type = field.type;
    const stored = readConfig(field.config);
    const data: Prisma.ProjectFieldUpdateInput = {};
    if (patch.label !== undefined) {
      const label = cleanLabel(patch.label);
      if (!label.ok) problem(label);
      data.label = label.value;
    }
    if (patch.required !== undefined) data.required = patch.required;
    if (patch.archived !== undefined && patch.archived !== field.archived) {
      if (!patch.archived && (await tx.projectField.count({ where: { projectId, archived: false } })) >= MAX_ACTIVE_FIELDS) throw new ForbiddenError("fields.too_many");
      data.archived = patch.archived;
    }
    const touchesConfig = patch.unit !== undefined || patch.currency !== undefined || patch.options !== undefined;
    if (touchesConfig) {
      // money keeps its currency once any value exists: the amounts already stored were typed in it
      if (type === "MONEY" && patch.currency !== undefined && patch.currency !== stored.currency && (await tx.taskFieldValue.count({ where: { fieldId } })) > 0) {
        throw new ForbiddenError("fields.currency_locked");
      }
      data.config = configFor(type, patch, stored) as Prisma.InputJsonValue;
    }
    if (patch.afterId !== undefined) data.position = await positionAfter(tx, projectId, fieldId, patch.afterId);
    return tx.projectField.update({ where: { id: fieldId }, data, select: DEF_SELECT });
  });
  await audit("customField.updated", {
    actorId: access.userId,
    orgId: access.orgId,
    target: fieldId,
    meta: { projectId, changed: Object.keys(patch) },
  });
  return toDefDto(saved);
}

/** The position that puts `fieldId` right after `afterId` (`null`: first). One row is written, unless two neighbours are too close. */
async function positionAfter(tx: Tx, projectId: string, fieldId: string, afterId: string | null): Promise<Prisma.Decimal | number> {
  const rows = await tx.projectField.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, position: true } });
  const order = reorder(rows.map((r) => r.id), fieldId, afterId);
  if (!order) throw new NotFoundError("fields.not_found");
  const position = new Map(rows.map((r) => [r.id, Number(r.position.toString())]));
  const at = order.indexOf(fieldId);
  const prev = at > 0 ? position.get(order[at - 1]!)! : null;
  const next = at < order.length - 1 ? position.get(order[at + 1]!)! : null;
  const candidate = positionBetween(prev, next);
  if (!crowded(candidate, prev, next)) return candidate;
  // too close: the whole list is renumbered once, in this transaction
  for (const [i, id] of order.entries()) {
    if (id !== fieldId) await tx.projectField.update({ where: { id }, data: { position: (i + 1) * STEP_GAP } });
  }
  return (at + 1) * STEP_GAP;
}

// ---------- the values of a task ----------

/** Writing a value: who may edit the task, never a partner, never the owner reading a space he is not in. */
async function writeAccess(taskId: string) {
  const access = await requireTaskAccess(taskId, ["ADMIN", "MEMBER"]);
  await assertFeatureOn(access.orgId, FEATURE);
  await assertMemberCan(access, "tasks.edit", "section.edit_denied");
  if (access.orgRole === "OWNER") {
    const row = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: access.task.workspaceId, userId: access.userId } }, select: { userId: true } });
    if (!row) throw new ForbiddenError("fields.oversight_readonly");
  }
  return access;
}

/** The people a PERSON field may name in this space: ACTIVE in the company, not a partner, with a row in the space. */
export async function spacePeople(orgId: string, workspaceId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db.workspaceMember.findMany({
    where: {
      workspaceId,
      role: { not: "GUEST" },
      user: { memberships: { some: { organizationId: orgId, status: "ACTIVE", role: { not: "GUEST" } } } },
    },
    select: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.user);
}

export interface FieldValuesDto {
  fields: FieldDefDto[];
  /** fieldId -> canonical value (see src/lib/custom-fields.ts); a field with no answer is absent. */
  values: Record<string, unknown>;
  people: { id: string; name: string }[];
}

const EMPTY_CARD: FieldValuesDto = { fields: [], values: {}, people: [] };

/**
 * What the task's card shows: the project's live fields and the task's values. The caller has passed the task's guard.
 * `null` when the switch is off; an EMPTY card (no field, no value) for an external partner.
 */
export async function taskFieldsCard(ctx: { orgId: string; userId: string; orgRole?: string }, task: { id: string; projectId: string; workspaceId: string }): Promise<FieldValuesDto | null> {
  if (!(await isFeatureOn(ctx.orgId, FEATURE))) return null;
  if (await isPartnerIn(ctx, task.workspaceId)) return EMPTY_CARD;
  const fields = await fieldDefsOf(task.projectId);
  if (fields.length === 0) return EMPTY_CARD;
  const rows = await db.taskFieldValue.findMany({ where: { taskId: task.id, orgId: ctx.orgId, fieldId: { in: fields.map((f) => f.id) } } });
  const byField = new Map(rows.map((r) => [r.fieldId, r]));
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    const row = byField.get(f.id);
    const v = row ? fromStored(f.type, row) : undefined;
    if (v !== undefined) values[f.id] = v;
  }
  const people = fields.some((f) => f.type === "PERSON") ? await spacePeople(ctx.orgId, task.workspaceId) : [];
  // a person already named stays readable even after they left the space
  const named = fields.filter((f) => f.type === "PERSON").flatMap((f) => (typeof values[f.id] === "string" ? [values[f.id] as string] : []));
  const missing = named.filter((id) => !people.some((p) => p.id === id));
  const extra = missing.length ? await db.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } }) : [];
  return { fields, values, people: [...people, ...extra] };
}

export async function readTaskFields(taskId: string): Promise<FieldValuesDto> {
  const access = await requireTaskAccess(taskId);
  await assertMemberCan(access, "tasks.view", "section.view_denied", { spaceGuestsPass: true });
  await assertFeatureOn(access.orgId, FEATURE);
  return (await taskFieldsCard(access, access.task)) ?? EMPTY_CARD;
}

/** Sets (or clears, for an emptied box) one value. Returns the canonical value now stored, `null` when cleared. */
export async function setTaskFieldValue(taskId: string, fieldId: string, raw: unknown): Promise<{ fieldId: string; value: unknown }> {
  const access = await writeAccess(taskId);
  const result = await db.$transaction(async (tx) => {
    // the task's row is held for the write: a completion that is checking the required fields waits for it, then reads what is left
    // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
    await tx.$queryRaw`SELECT 1 FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`;
    // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
    const task = await tx.task.findFirst({ where: { id: taskId, orgId: access.orgId }, select: { id: true, projectId: true, workspaceId: true, rewardStatus: true } });
    if (!task) throw new NotFoundError("task.not_found");
    // «مهمة بمكافأة»: a reward task keeps its owner-only lock for its fields too
    await assertRewardEditable(access, task);
    // the field must be one of THIS task's project (another project's id is «not found»)
    const field = await fieldOf(task.projectId, access.orgId, fieldId, tx);
    if (field.archived) throw new ForbiddenError("fields.archived");
    if (!isFieldType(field.type)) throw new NotFoundError("fields.not_found");
    const def = { type: field.type, config: readConfig(field.config) };
    const checked = validateValue(def, raw);
    if (!checked.ok) problem(checked);
    if (checked.empty) {
      await tx.taskFieldValue.deleteMany({ where: { taskId, fieldId } });
      return { fieldId, value: null as unknown, type: field.type, empty: true };
    }
    if (field.type === "PERSON") await assertPersonInSpaceTx(tx, access.orgId, task.workspaceId, checked.stored.valueText as string);
    const s = checked.stored;
    const data = {
      valueText: s.valueText,
      valueNumber: s.valueNumber === null ? null : new Prisma.Decimal(s.valueNumber),
      valueDate: s.valueDate === null ? null : new Date(`${s.valueDate}T00:00:00.000Z`),
      valueJson: s.valueJson === null ? Prisma.DbNull : (s.valueJson as Prisma.InputJsonValue),
      updatedById: access.userId,
    };
    const row = await tx.taskFieldValue.upsert({
      where: { taskId_fieldId: { taskId, fieldId } },
      create: { orgId: access.orgId, taskId, fieldId, ...data },
      update: data,
    });
    return { fieldId, value: fromStored(field.type, row) ?? null, type: field.type, empty: false };
  });
  // money is the one value that is also written to the audit log (who put what into a money field)
  if (result.type === "MONEY") await audit("customField.money_set", { actorId: access.userId, orgId: access.orgId, target: taskId, meta: { fieldId, cleared: result.empty } });
  return { fieldId, value: result.value };
}

async function assertPersonInSpaceTx(tx: Tx, orgId: string, workspaceId: string, userId: string): Promise<void> {
  const ok = await tx.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId,
      role: { not: "GUEST" },
      user: { memberships: { some: { organizationId: orgId, status: "ACTIVE", role: { not: "GUEST" } } } },
    },
    select: { userId: true },
  });
  if (!ok) throw new ValidationError([{ path: "value", message: "fields.person_invalid" }]);
}

// ---------- required fields: the door of finishing ----------

/**
 * 422 `fields.required` (with the missing labels) unless every required, live field of the task's project holds an answer.
 * Called by `moveTask` and `setTaskCompletion` INSIDE their transaction, right after the task's row is locked, when a task
 * goes from open to finished. Quick-add (`createTask`) never calls it. A switched-off company is never asked.
 */
export async function assertRequiredFilled(tx: Tx, task: { id: string; projectId: string; orgId: string }): Promise<void> {
  if (!(await isFeatureOn(task.orgId, FEATURE))) return;
  const required = await tx.projectField.findMany({
    where: { projectId: task.projectId, orgId: task.orgId, archived: false, required: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, label: true, type: true, required: true, archived: true },
  });
  if (required.length === 0) return;
  const rows = await tx.taskFieldValue.findMany({ where: { taskId: task.id, fieldId: { in: required.map((f) => f.id) } } });
  const byField = new Map<string, StoredRow>(rows.map((r) => [r.fieldId, r]));
  const missing = missingRequired(
    required.flatMap((f) => (isFieldType(f.type) ? [{ ...f, type: f.type }] : [])),
    byField,
  );
  if (missing.length) throw new RequiredFieldsError(missing);
}

// ---------- the cells of a list or a board ----------

export interface FieldCellsDto {
  /** The live fields of the projects on the page (the picker lists them), each with its project. */
  defs: { id: string; projectId: string; projectName: string; label: string; type: FieldType }[];
  /** taskId -> fieldId -> chip */
  cells: Record<string, Record<string, FieldCell>>;
}

/**
 * The chips of a page of tasks, in one read per table: for every task its project's live fields that hold an answer. `null`
 * when the switch is off or the viewer is an external partner (a partner is handed nothing, money included). The caller has already
 * read the tasks, so only tasks the viewer may see are named.
 */
export async function fieldCellsFor(
  ctx: { orgId: string; userId: string; orgRole?: string },
  workspaceId: string,
  tasks: readonly { id: string; projectId: string }[],
): Promise<FieldCellsDto | null> {
  if (!(await isFeatureOn(ctx.orgId, FEATURE))) return null;
  if (await isPartnerIn(ctx, workspaceId)) return null;
  const projectIds = [...new Set(tasks.map((t) => t.projectId))];
  if (projectIds.length === 0) return { defs: [], cells: {} };
  const fieldRows = await db.projectField.findMany({
    where: { orgId: ctx.orgId, projectId: { in: projectIds }, archived: false },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { ...DEF_SELECT, projectId: true, project: { select: { name: true } } },
  });
  if (fieldRows.length === 0) return { defs: [], cells: {} };
  const defs = new Map(fieldRows.map((r) => [r.id, { projectId: r.projectId, dto: toDefDto(r) }]));
  const values = await db.taskFieldValue.findMany({ where: { orgId: ctx.orgId, taskId: { in: tasks.map((t) => t.id) }, fieldId: { in: [...defs.keys()] } } });
  const projectOf = new Map(tasks.map((t) => [t.id, t.projectId]));
  const personIds = new Set<string>();
  for (const v of values) if (defs.get(v.fieldId)?.dto.type === "PERSON" && v.valueText) personIds.add(v.valueText);
  const names = new Map(
    personIds.size ? (await db.user.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name] as const) : [],
  );
  const cells: Record<string, Record<string, FieldCell>> = {};
  for (const v of values) {
    const def = defs.get(v.fieldId);
    // a value only counts against the field of the task's CURRENT project (a task that moved keeps old rows that read as nothing)
    if (!def || projectOf.get(v.taskId) !== def.projectId) continue;
    const cell = cellOf(def.dto, fromStored(def.dto.type, v), names);
    if (cell) (cells[v.taskId] ??= {})[v.fieldId] = cell;
  }
  return { defs: fieldRows.map((r) => ({ id: r.id, projectId: r.projectId, projectName: r.project.name, label: r.label, type: toDefDto(r).type })), cells };
}

/**
 * The exact total of a NUMBER field over the tasks of a project (decimal text): SQL's own DECIMAL sum, never a float. With
 * `taskIds` only those tasks count (the rows a list shows: what the viewer may see, after every filter).
 */
export async function sumNumberField(orgId: string, projectId: string, fieldId: string, taskIds?: readonly string[]): Promise<string> {
  if (taskIds && taskIds.length === 0) return "0";
  const only = taskIds ? Prisma.sql`AND t."id" IN (${Prisma.join([...taskIds])})` : Prisma.empty;
  // task-visibility: every route that gets here passed requireTaskAccess / requireTeamWork(…, task) first
  const rows = await db.$queryRaw<{ total: string | null }[]>(Prisma.sql`
    SELECT SUM(v."valueNumber")::text AS total
    FROM "TaskFieldValue" v
    JOIN "Task" t ON t."id" = v."taskId"
    JOIN "ProjectField" f ON f."id" = v."fieldId"
    WHERE v."orgId" = ${orgId} AND f."id" = ${fieldId} AND f."projectId" = ${projectId} AND f."type" = 'NUMBER'
      AND t."projectId" = ${projectId} AND t."archived" = FALSE ${only}`);
  const total = rows[0]?.total ?? "0";
  return total.includes(".") ? total.replace(/0+$/, "").replace(/\.$/, "") : total;
}


// ---------- the list's field bar ----------

export interface FieldListInput {
  project?: string | undefined;
  ff?: string | undefined;
  fv?: string | undefined;
  fs?: string | undefined;
  fd?: string | undefined;
}

export interface ResolvedFieldList {
  /** The projects of the space the person may open (the selector). */
  projects: { id: string; name: string }[];
  /** The selected project, when it is one of those. */
  project: { id: string; name: string } | null;
  filterFields: { id: string; label: string; type: "SINGLE_CHOICE" | "BOOLEAN" | "PERSON"; options: { id: string; label: string }[] }[];
  sortFields: { id: string; label: string; type: FieldType }[];
  /** What `queryTasksForView` is told (absent when the parameter was not valid for this project's fields). */
  filter?: FieldFilter;
  sort?: FieldSort;
  /** The parameters that survived validation, to be kept in every link of the page. */
  params: Record<string, string>;
}

/**
 * The list page's custom-field parameters, validated against the project's OWN fields: a project the person may not open, a field
 * of another project, a type that cannot be filtered or sorted, an option that is not the field's own are all dropped (the page
 * then simply shows the unfiltered list). `null` when the switch is off or the viewer is an external partner. Nothing here builds SQL:
 * the result is a typed filter and a typed sort for `queryTasksForView`.
 */
export async function resolveFieldList(
  ctx: { orgId: string; userId: string; orgRole?: string },
  workspaceId: string,
  visibleProjects: Prisma.ProjectWhereInput,
  input: FieldListInput,
): Promise<ResolvedFieldList | null> {
  if (!(await isFeatureOn(ctx.orgId, FEATURE))) return null;
  if (await isPartnerIn(ctx, workspaceId)) return null;
  const projects = await db.project.findMany({
    where: { workspaceId, workspace: { organizationId: ctx.orgId }, systemKey: null, AND: [visibleProjects] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const project = projects.find((p) => p.id === input.project) ?? null;
  const out: ResolvedFieldList = { projects, project, filterFields: [], sortFields: [], params: {} };
  if (!project) return out;
  out.params["project"] = project.id;
  const defs = await fieldDefsOf(project.id);
  out.filterFields = defs.flatMap((f) =>
    f.type === "SINGLE_CHOICE" || f.type === "BOOLEAN" || f.type === "PERSON"
      ? [{ id: f.id, label: f.label, type: f.type, options: f.options.filter((o) => !o.deleted).map((o) => ({ id: o.id, label: o.label })) }]
      : [],
  );
  out.sortFields = defs.filter((f) => SORT_TYPES.includes(f.type)).map((f) => ({ id: f.id, label: f.label, type: f.type }));
  const ff = defs.find((f) => f.id === input.ff && FILTER_TYPES.includes(f.type));
  if (ff && input.fv) {
    if (ff.type === "BOOLEAN" && (input.fv === "yes" || input.fv === "no")) out.filter = { fieldId: ff.id, kind: "boolean", value: input.fv === "yes" };
    else if (ff.type === "SINGLE_CHOICE" && ff.options.some((o) => o.id === input.fv && !o.deleted)) out.filter = { fieldId: ff.id, kind: "text", value: input.fv };
    else if (ff.type === "PERSON" && /^[A-Za-z0-9_-]{1,64}$/.test(input.fv)) out.filter = { fieldId: ff.id, kind: "text", value: input.fv };
    if (out.filter) {
      out.params["ff"] = ff.id;
      out.params["fv"] = input.fv;
    }
  } else if (ff) out.params["ff"] = ff.id;
  const fs = defs.find((f) => f.id === input.fs && SORT_TYPES.includes(f.type));
  if (fs) {
    const dir = input.fd === "desc" ? "desc" : "asc";
    out.sort = { fieldId: fs.id, projectId: project.id, column: fs.type === "DATE" ? "valueDate" : "valueNumber", dir };
    out.params["fs"] = fs.id;
    out.params["fd"] = dir;
  }
  return out;
}
