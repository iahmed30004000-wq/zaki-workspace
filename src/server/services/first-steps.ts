import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { audienceOf, type Audience } from "@/lib/guide/audience";
import { CURRENT_PHASE, FIRST_STEPS, stepsFor, toViews, type Fact, type FirstStepView } from "@/lib/guide/first-steps";
import { isChosenTheme } from "@/lib/themes/registry";
import { isFeatureOn } from "@/server/services/features";

/**
 * The first-steps card («خطواتك الأولى») computed from REAL data for the signed-in actor: nothing is
 * stored about "progress" - a step is done because the rows say so (a theme chosen, a task created,
 * a task of theirs finished, a colleague added, a space they can open, a chat message they wrote). A step is never ticked by
 * somebody else's work or by a row the person cannot see: tests/db/first-steps-scope.test.ts.
 *
 *  - Which steps apply is decided by the registry (src/lib/guide/first-steps.ts): by the actor's
 *    level (a guest is never asked to add a task, only a people manager to add a person) and by the
 *    phase the step exists in.
 *  - Everything is scoped to the organization the actor works in now, never to another one.
 *  - Only the facts the actor's steps need are read (a guest costs one query).
 *  - The steps the DEVICE decides (the app installed on this phone, the guide opened here) come back
 *    not done: the card reads them from the device. What leaves here is plain keys and flags - no id,
 *    no row.
 */

type Who = Pick<Actor, "userId" | "orgId" | "isExternal" | "caps">;

export interface FirstStepsResult {
  audience: Audience;
  steps: FirstStepView[];
}

/** One fact about the person, from the database. */
async function check(actor: Who, fact: Fact): Promise<boolean> {
  switch (fact) {
    case "theme": {
      // User.theme held "system" for the old light/dark toggle: only a theme key is a choice, and a retired
      // key («إسلامي هادي», now «ليل») still counts — the person did choose
      const me = await db.user.findUnique({ where: { id: actor.userId }, select: { theme: true } });
      return isChosenTheme(me?.theme);
    }
    case "task-created": {
      // task-visibility: the person's own tasks (assignee, co-assignee or creator) are theirs to see
      const row = await db.task.findFirst({ where: { orgId: actor.orgId, creatorId: actor.userId }, select: { id: true } });
      return row !== null;
    }
    case "task-completed": {
      // a task that is THEIRS (assigned to them) and finished, archived or not. A task row does not say
      // who finished it (there is no `completedById`), so what counts is "it was given to this person and
      // it is done": a task they only CREATED, finished by a colleague, never ticks the step for them.
      // task-visibility: the person's own tasks (assignee, co-assignee or creator) are theirs to see
      const row = await db.task.findFirst({
        where: { orgId: actor.orgId, completedAt: { not: null }, assigneeId: actor.userId },
        select: { id: true },
      });
      return row !== null;
    }
    case "people": {
      // at least one colleague besides themselves who can still use the app. An external partner (guest)
      // is not "a colleague added to the team", so an owner with only a guest beside them has not done it.
      const colleagues = await db.organizationMember.count({
        where: { organizationId: actor.orgId, status: "ACTIVE", role: { not: "GUEST" }, userId: { not: actor.userId } },
      });
      return colleagues >= 1;
    }
    case "message-sent": {
      // a message of their own in this company (a system line «انضم» is not one they wrote)
      const row = await db.chatMessage.findFirst({
        where: { orgId: actor.orgId, authorId: actor.userId, kind: { not: "SYSTEM" } },
        select: { id: true },
      });
      return row !== null;
    }
    case "spaces": {
      // a space THEY can open in the company they work in now: the owner opens every one, everybody else
      // only the spaces they were put in (an admin by rank opens none). Counting every space of the company
      // would tick the step for somebody who cannot see any, and tell them that one exists.
      const open = await accessibleWorkspaceIds(actor.userId);
      if (open.length === 0) return false;
      const spaces = await db.workspace.count({ where: { id: { in: open }, organizationId: actor.orgId } });
      return spaces >= 1;
    }
  }
}

/** The facts the given steps need, read together. */
export async function loadFirstStepFacts(actor: Who, facts: readonly Fact[]): Promise<Partial<Record<Fact, boolean>>> {
  const wanted = [...new Set(facts)];
  const results = await Promise.all(wanted.map((fact) => check(actor, fact)));
  return Object.fromEntries(wanted.map((fact, i) => [fact, results[i] === true]));
}

/**
 * The steps this actor is shown, each with its done flag. `phase` is the phase of the product (it
 * defaults to the current one): steps of a later phase are not returned.
 */
export async function getFirstSteps(actor: Who, opts: { phase?: number } = {}): Promise<FirstStepsResult> {
  const audience = audienceOf(actor);
  // S3.3: while «الإعدادات» is ONE door (both switches, as `oneDoorOnFor`) the guide has no step here and the theme's step leads to its home
  const [door, panel] = await Promise.all([isFeatureOn(actor.orgId, "settingsOneDoor"), isFeatureOn(actor.orgId, "controlPanelV2")]);
  const oneDoor = door && panel;
  const defs = stepsFor(audience, opts.phase ?? CURRENT_PHASE, FIRST_STEPS, oneDoor);
  const needed = defs.flatMap((def) => (def.fact ? [def.fact] : []));
  const facts = await loadFirstStepFacts(actor, needed);
  return { audience, steps: toViews(defs, facts) };
}
