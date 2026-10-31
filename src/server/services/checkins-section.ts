import { checkinSummaryFor } from "@/server/services/checkins";
import { isFeatureOn } from "@/server/services/features";
import type { BoardSection, SectionContext } from "@/server/services/owner-board-sections";

/**
 * «التسجيل اليومي» as a section of the team score: how many days a person answered in the period and the run of answered days.
 * It is SHOWN BESIDE the score, never inside it (a count of answered days is not a judgement of quality) and it carries NUMBERS
 * ONLY: the answers' texts are never read here (`checkinSummaryFor` does not select them).
 *
 * Who sees it: whoever the score already lets open that person's file (the person, their supervisors, the owner). The section asks
 * only for the people it is given and the days of the window. Off (`checkins`), the section does not exist.
 */
export const checkinsSection: BoardSection = {
  id: "checkins",
  columns: [
    { key: "checkins.answered", labelKey: "teamdev.score.checkins", formulaKey: "teamdev.score.checkins_formula", kind: "count" },
    { key: "checkins.streak", labelKey: "teamdev.score.checkins_streak", formulaKey: "teamdev.score.checkins_streak_formula", kind: "count" },
  ],
  enabled: (orgId) => isFeatureOn(orgId, "checkins"),
  async load(ctx: SectionContext) {
    const out = new Map<string, Record<string, number | string | null>>();
    const summaries = await checkinSummaryFor(ctx.orgId, ctx.userIds, { from: ctx.window.from, to: ctx.window.to });
    for (const [userId, s] of summaries) out.set(userId, { "checkins.answered": s.answered, "checkins.streak": s.streak });
    return out;
  },
};
