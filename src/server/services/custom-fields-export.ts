import { db } from "@/server/db";
import { ForbiddenError, audit, requireProjectAccess } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { fieldDefsOf, isPartnerIn } from "@/server/services/custom-fields";
import { fieldsCsv, type ExportRow } from "@/lib/custom-fields-csv";
import { fromStored } from "@/lib/custom-fields";
import { columnLabel } from "@/lib/i18n/enums";

/**
 * «حقول مخصصة» — the project's values as a CSV file.
 *
 * WHO. Whoever may open the project (`requireProjectAccess`: the space, then the project's team) with the projects row of the
 * section grid, while the company's `customFields` switch is on. An external partner — an org GUEST or a guest row of the space — is
 * handed no field at all, so no file either (403 `guest.no_access`): the money field never reaches one by this road.
 * WHAT. The live fields (archived ones are not exported) and, for every task of the project that is not archived, its number, title,
 * column and holder with the values. At most `MAX_ROWS` tasks.
 * ⚠️ The file holds what the screen holds, in a form that can leave the app. 🔧 Every export is audited (who, which project, how many rows).
 */

const MAX_ROWS = 5000;

export async function projectFieldsCsv(projectId: string): Promise<{ filename: string; body: string }> {
  const access = await requireProjectAccess(projectId);
  await assertMemberCan(access, "projects.view", "section.view_denied", { spaceGuestsPass: true });
  await assertFeatureOn(access.orgId, "customFields");
  if (await isPartnerIn(access, access.project.workspaceId)) throw new ForbiddenError("guest.no_access");

  const defs = await fieldDefsOf(projectId);
  const tasks = await db.task.findMany({
    where: { projectId, orgId: access.orgId, archived: false },
    orderBy: [{ number: "asc" }, { id: "asc" }],
    take: MAX_ROWS,
    select: {
      id: true,
      number: true,
      title: true,
      organization: { select: { keyPrefix: true } },
      column: { select: { name: true } },
      assignee: { select: { name: true } },
    },
  });
  const values =
    defs.length && tasks.length
      ? await db.taskFieldValue.findMany({ where: { orgId: access.orgId, taskId: { in: tasks.map((t) => t.id) }, fieldId: { in: defs.map((d) => d.id) } } })
      : [];
  const typeOf = new Map(defs.map((d) => [d.id, d.type] as const));
  const byTask = new Map<string, Record<string, unknown>>();
  const personIds = new Set<string>();
  for (const row of values) {
    const type = typeOf.get(row.fieldId);
    if (!type) continue;
    const v = fromStored(type, row);
    if (v === undefined) continue;
    const mine = byTask.get(row.taskId) ?? {};
    mine[row.fieldId] = v;
    byTask.set(row.taskId, mine);
    if (type === "PERSON" && typeof v === "string") personIds.add(v);
  }
  const names = new Map(
    personIds.size ? (await db.user.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name] as const) : [],
  );
  const rows: ExportRow[] = tasks.map((t) => ({
    key: `${t.organization.keyPrefix}-${t.number}`,
    title: t.title,
    status: columnLabel(t.column.name),
    assignee: t.assignee?.name ?? null,
    values: byTask.get(t.id) ?? {},
  }));
  await audit("customField.exported", { actorId: access.userId, orgId: access.orgId, target: projectId, meta: { rows: rows.length, fields: defs.length } });
  return { filename: `project-fields-${projectId}.csv`, body: fieldsCsv(defs, rows, names) };
}
