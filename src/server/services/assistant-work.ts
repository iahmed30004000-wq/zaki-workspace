import { dayOfInstant } from "@/lib/due-day";
import { zonedDayStart } from "@/lib/zoned-time";
import { db } from "@/server/db";
import { LOCAL_CONTEXT_LIMITS } from "@/server/ai/local-transport";
import { buildContext, redactTitle } from "@/server/ai/redact";
import type { RefTable } from "@/server/ai/redact";
import type { BoardAccess } from "@/server/policy/board";
import { isFeatureOn } from "@/server/services/features";
import { orgTimeZone } from "@/server/services/org-day";
import { loadScope } from "@/server/services/owner-assistant-data";

/**
 * «المساعد» يعرف شغلك — the work picture the assistant contact gets with every question asked in a person's OWN conversation.
 *
 *   OWNER    the owner board's own numbers of the last 7 days (`loadScope` + `buildContext`: the SAME filter as «مساعد المالك», people
 *            as «موظف n», titles only when «allowTitles» is on) — only while «لوحة المالك» is on.
 *   OTHERS   only THEIR OWN open tasks (assigned to them or shared with them): a count, how many are late, how many they finished in
 *            the last 7 days, and at most 15 tasks (a title only with «allowTitles», after `redactTitle`). Never anybody else's.
 *   NEVER    a reward task, a message body, a file, a CRM row, a name when names are not allowed. Reading writes nothing.
 *
 * Its own switch («المساعد يعرف شغلك»): off, the contact answers from the conversation alone, as before.
 */

export const WORK_TASKS_MAX = 15;
const WEEK_MS = 7 * 86_400_000;

export interface AssistantWork {
  /** The JSON placed between <work>…</work>. */
  text: string;
  /** What the filter masked in the titles and names it carried. */
  masked: number;
  /** The references (U1, T5, S1, P2) of the text, to put real names back and to resolve a proposal. Empty for anybody but the owner. */
  refs: RefTable;
  /** The owner's own conversation: the assistant may propose actions (he approves each). */
  canPropose: boolean;
}

export async function loadAssistantWork(
  who: { orgId: string; userId: string; role: string },
  options: { allowNames: boolean; allowTitles: boolean; local: boolean; now?: Date },
): Promise<AssistantWork | null> {
  if (!(await isFeatureOn(who.orgId, "assistantWorkData"))) return null;
  const now = options.now ?? new Date();
  if (who.role === "OWNER" && (await isFeatureOn(who.orgId, "ownerBoard"))) {
    const access: BoardAccess = {
      mode: "owner",
      orgId: who.orgId,
      viewerId: who.userId,
      reach: null,
      ownPage: true,
      companyWide: true,
      scope: { restricted: false, workspaceIds: [], teamIds: [] },
    };
    const raw = await loadScope(access, { preset: "7" }, now);
    const built = buildContext(raw, { allowNames: options.allowNames, allowTitles: options.allowTitles, ...(options.local ? LOCAL_CONTEXT_LIMITS : {}) });
    return { text: JSON.stringify({ scope: "company", ...built.context }), masked: built.masked, refs: built.refs, canPropose: true };
  }
  return ownWork(who, options, now);
}

async function ownWork(
  who: { orgId: string; userId: string },
  options: { allowTitles: boolean; local: boolean },
  now: Date,
): Promise<AssistantWork> {
  const tz = await orgTimeZone(who.orgId);
  const today = dayOfInstant(now, tz);
  const todayStart = zonedDayStart(now, tz);
  const mine = { OR: [{ assigneeId: who.userId }, { coAssignees: { some: { userId: who.userId } } }] };
  // a reward task is the owner's alone: it is never counted or listed here
  const noReward = { OR: [{ rewardStatus: null }, { rewardStatus: { notIn: ["OPEN", "AWARDED"] } }] };
  const open = { orgId: who.orgId, completedAt: null, archived: false, AND: [mine, noReward] };
  const limit = options.local ? Math.min(WORK_TASKS_MAX, LOCAL_CONTEXT_LIMITS.maxTasks) : WORK_TASKS_MAX;
  const [rows, openTotal, overdue, finished] = await Promise.all([
    db.task.findMany({
      where: open,
      select: { title: true, priority: true, dueDate: true },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: limit,
    }),
    db.task.count({ where: open }),
    db.task.count({ where: { ...open, dueDate: { lt: todayStart } } }),
    db.task.count({ where: { orgId: who.orgId, completedAt: { gte: new Date(now.getTime() - WEEK_MS) }, AND: [mine, noReward] } }),
  ]);
  let masked = 0;
  const tasks = rows.map((t, i) => {
    const due = t.dueDate ? dayOfInstant(t.dueDate, tz) : null;
    const base = { ref: `T${i + 1}`, priority: t.priority, due, late: due !== null && due < today };
    if (!options.allowTitles) return base;
    const title = redactTitle(t.title);
    masked += title.count;
    return { ...base, title: title.text };
  });
  const text = JSON.stringify({ scope: "mine", today, openTotal, overdue, finishedLast7Days: finished, tasksShown: tasks.length, tasks });
  return { text, masked, refs: {}, canPropose: false };
}
