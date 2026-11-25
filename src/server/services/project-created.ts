import { db } from "@/server/db";
import { fmtStamp } from "@/lib/work/stamp";
import { orgTimeZone } from "@/server/services/org-day";

/** «أنشأها فلان · 25 تشرين الثاني 14:30» for a project the caller already reads (an older project, or one the system made, has no maker: its date alone). */
export async function projectCreatedLine(
  orgId: string,
  project: { createdAt: Date; createdById: string | null },
  t: (key: string, params?: Record<string, string | number>) => string,
): Promise<string> {
  const when = fmtStamp(project.createdAt, await orgTimeZone(orgId));
  const maker = project.createdById ? await db.user.findUnique({ where: { id: project.createdById }, select: { name: true } }) : null;
  return maker ? t("task.created_line", { name: maker.name, when }) : t("task.created_at", { when });
}
