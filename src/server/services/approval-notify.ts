import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { pushNotification } from "@/server/notify";
import { storeAppCard, topicForAuthor } from "@/server/chat/door-message";
import { isFeatureOn } from "@/server/services/features";
import { moneyForms } from "./approval-access";

/**
 * The bell of «طلبات الموافقة». Three types: `approval_requested` (it is your turn), `approval_decided` (a step was decided, the
 * request finished or was cancelled) and `approval_changes` (the requester is asked to edit and resubmit).
 *
 * The bell's body (inside the app, behind the sign-in) is the request's title, and who. The Web Push text is GENERIC: it is
 * the same fixed line for every event and carries no title, no name, no amount and no detail — a phone's lock screen shows
 * nothing about the request. An approval never carries an amount into any notification.
 */

export type ApprovalEvent = "requested" | "decided" | "changes";

export interface NoteInput {
  orgId: string;
  workspaceId: string;
  requestId: string;
  title: string;
  /** Who is told. */
  userIds: readonly string[];
  /** The person whose action it is (their name leads the bell's body). */
  actorName?: string | null;
  /** The sentence of the bell's title, a dictionary key under `approvals.note.*`. */
  titleKey: string;
}

const TYPE: Record<ApprovalEvent, string> = {
  requested: "approval_requested",
  decided: "approval_decided",
  changes: "approval_changes",
};

export const PUSH_LINE_KEY = "approvals.note.push";

/** One bell row (and one Web Push) for each person; a failure never undoes the decision that is already committed. */
export async function notifyApproval(event: ApprovalEvent, input: NoteInput): Promise<void> {
  const ids = [...new Set(input.userIds)];
  if (ids.length === 0) return;
  const body = input.actorName ? `${input.actorName} · ${input.title}` : input.title;
  await Promise.all(
    ids.map((userId) =>
      pushNotification({
        userId,
        type: TYPE[event],
        title: AR[input.titleKey] ?? AR["common.error"] ?? "",
        body,
        pushBody: AR[PUSH_LINE_KEY] ?? "",
        linkUrl: `/approvals/${input.requestId}`,
        workspaceId: input.workspaceId,
        organizationId: input.orgId,
      }).catch(() => undefined),
    ),
  );
}

export interface DecidedRequest {
  id: string;
  orgId: string;
  workspaceId: string;
  title: string;
  requesterId: string;
  formId: string | null;
}

/**
 * I1.3 - the end of an office-money request (approved or rejected) as ONE card message in the space's «عام» topic, for visibility. The row holds
 * a pointer (`{ type: "approval", requestId, outcome, purpose }`) and a readable line («قرار: تمت الموافقة على «طلب مصروف» (سارة)»; the kind comes from the
 * form's purpose, not from the request's title): NO amount, no currency, no reason, no invoice (the screen that draws it resolves what each viewer may see). It is a message, never an action: nothing in it decides, and no
 * chat text approves money. The decider writes it when the topic lets them post there (the owner only where he joined, a closed or archived topic
 * takes nothing); else the person who asked does; else nothing is posted. Only while the switch `expenseForms` is on, only for a money form.
 * It never throws and never undoes the decision that is already committed. Returns whether a card was written.
 */
export async function postDecisionCard(actor: { userId: string }, request: DecidedRequest, outcome: "APPROVED" | "REJECTED"): Promise<boolean> {
  try {
    if (!request.formId) return false;
    const purpose = (await moneyForms([request.formId])).get(request.formId);
    if (!purpose) return false;
    if (!(await isFeatureOn(request.orgId, "expenseForms"))) return false;
    const topic = await db.conversation.findFirst({
      where: { orgId: request.orgId, spaceId: request.workspaceId, kind: "TOPIC", systemKey: "general", archivedAt: null, closedAt: null },
      select: { id: true },
    });
    if (!topic) return false;
    let authorId: string | null = null;
    for (const candidate of [actor.userId, request.requesterId]) {
      if ((await topicForAuthor(request.orgId, candidate, topic.id)).ok) {
        authorId = candidate;
        break;
      }
    }
    if (!authorId) return false;
    const who = (await namesOf([request.requesterId])).get(request.requesterId) ?? "";
    // the words name the KIND of request («طلب مصروف»), never the request's own title: nobody's typing reaches a message everybody in the topic reads
    const body = interpolate(AR[outcome === "APPROVED" ? "expense.card.approved" : "expense.card.rejected"] ?? "", { what: AR[`expense.preset.${purpose}.name`] ?? "", who });
    const author = authorId;
    await db.$transaction((tx) =>
      storeAppCard(tx, {
        orgId: request.orgId,
        conversationId: topic.id,
        spaceId: request.workspaceId,
        authorId: author,
        body,
        card: { type: "approval", requestId: request.id, outcome, purpose },
        viaApp: AR["expense.card.via"] ?? "",
      }),
    );
    return true;
  } catch (err) {
    log.warn("approvals.card_failed", { message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Names of people by id (a missing one is simply absent). */
export async function namesOf(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name] as const));
}
