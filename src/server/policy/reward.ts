import { isRewardTaskStatus } from "@/lib/rewards";
import type { Capability } from "@/server/policy/capabilities";

/**
 * What the callers hand in: the rank (read from the database, never from a cookie) and, since A1.3, the person's effective
 * capabilities. With `caps` the OWNER rank also needs the section's box (`tasks.edit`), so a partner who lost it is refused;
 * without `caps` (a caller that has not been moved yet) the rank alone decides, as before.
 */
export interface RewardActor {
  isOwner: boolean;
  caps?: ReadonlySet<Capability>;
}

/** The section the reward lives in is the tasks'; its «يضيف ويعدّل» box is the one a partner can lose. */
const REWARD_CAPABILITY: Capability = "tasks.edit";

const holdsRewardSection = (actor: RewardActor): boolean => actor.caps === undefined || actor.caps.has(REWARD_CAPABILITY);

/**
 * «مهمة بمكافأة» — who may touch a task that carries a reward. ONE function, called from the service layer, so every door
 * (the board, a message, an idea, the instant dialog, the API) answers the same.
 *
 * The OWNER rank alone (every OWNER of the company, the co-owners with him) creates a reward, edits it or the title,
 * description or day of a reward task, cancels it, archives or deletes the task. Everybody else may see it, comment, tick
 * its steps and move it between columns (finishing it is how the reward is earned). Assigning people keeps its own rule
 * (src/server/services/task-assign.ts).
 *
 * Pure: the callers hand in whether the actor is an owner (read from the database, never from a cookie).
 */
export function canEditRewardTask(actor: RewardActor, task: { rewardStatus: string | null | undefined }): boolean {
  if (!isRewardTaskStatus(task.rewardStatus)) return true;
  return actor.isOwner && holdsRewardSection(actor);
}

/** Who may create a reward, or change what a reward is: the OWNER rank, whatever the task is. */
export function canSetReward(actor: RewardActor): boolean {
  return actor.isOwner && holdsRewardSection(actor);
}

/**
 * Who may see a reward amount, a badge, a status: never an external partner (an org GUEST, or a person whose row in the space
 * says GUEST). Everybody else who may open the task sees it.
 */
export function canSeeReward(viewer: { orgRole: string; spaceRole?: string | null }): boolean {
  if (viewer.orgRole === "GUEST") return false;
  if (viewer.orgRole !== "OWNER" && viewer.spaceRole === "GUEST") return false;
  return true;
}

/** Who may pin or unpin a task: the OWNER and the space's ADMIN (an org ADMIN who is in the space counts). A pin never changes access. */
export function canPinTask(viewer: { orgRole: string; spaceRole?: string | null }): boolean {
  if (viewer.orgRole === "OWNER") return true;
  if (viewer.orgRole === "GUEST") return false;
  return viewer.spaceRole === "ADMIN" || (viewer.orgRole === "ADMIN" && viewer.spaceRole != null);
}

/** The fields of a task that carry the reward: stripped from anything a partner is shown. */
export const REWARD_FIELDS = [
  "rewardAmountMinor",
  "rewardCurrency",
  "rewardNote",
  "rewardStatus",
  "rewardAwardedToId",
  "rewardAwardedAt",
  "rewardApprovedById",
  "rewardCancelReason",
  "rewardCancelledAt",
] as const;

/** A copy of the row without the reward fields (what a partner receives). The pin stays: it is not money. */
export function withoutReward<T extends object>(row: T): Omit<T, (typeof REWARD_FIELDS)[number]> {
  const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const key of REWARD_FIELDS) delete copy[key];
  return copy as Omit<T, (typeof REWARD_FIELDS)[number]>;
}
