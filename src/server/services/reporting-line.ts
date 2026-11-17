import { db } from "@/server/db";

/**
 * Everybody BELOW a person in the reporting line (`OrganizationMember.managerId`, transitive, ACTIVE people only), as user
 * ids. A task that is private to «المعنيين بس» is read by the assignee's managers and their managers (D-P4), so this walk
 * is part of the visibility rule. Depth is capped (the line itself is capped at the same depth) and a loop in bad data
 * ends: a person is visited once. At most one query per level, and one when nobody reports to the person.
 */
export const REPORT_DEPTH = 6;

export async function loadReportIds(userId: string): Promise<Set<string>> {
  const found = new Set<string>();
  let level = [userId];
  const seen = new Set<string>([userId]);
  for (let depth = 0; depth < REPORT_DEPTH && level.length; depth++) {
    const rows = await db.organizationMember.findMany({
      where: { managerId: { in: level }, status: "ACTIVE" },
      select: { userId: true },
    });
    level = [];
    for (const r of rows) {
      if (seen.has(r.userId)) continue;
      seen.add(r.userId);
      found.add(r.userId);
      level.push(r.userId);
    }
  }
  return found;
}
