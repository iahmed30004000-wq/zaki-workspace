/**
 * «الطلبات» (W1.4) — the shapes of the inbox, shared by the server (src/server/services/work-requests.ts) and the screen. Plain data
 * only: the server fills it, the browser draws it, nothing here decides who may see what (the service does, row by row).
 */

/** The two tabs: «بانتظاري» (waits for ME) and «طلباتي» (I asked and it still waits). */
export type RequestTab = "waiting" | "mine";

export const REQUEST_TABS: readonly RequestTab[] = ["waiting", "mine"];

/** A tab from the address; anything else is «بانتظاري». */
export function requestTabOf(raw: unknown): RequestTab {
  return raw === "mine" ? "mine" : "waiting";
}

/** The sections, in the order the screen draws them. */
export const SECTION_KEYS = ["approvals", "assignments", "tickets", "cards", "sheets"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

interface RowBase {
  /** The row's own id: the approval request, the assignment request, the ticket, the card. */
  id: string;
  title: string;
  /** ISO time the thing was asked / raised. */
  at: string;
  /** Where the full page of the thing is (the detail pages stay where they were). */
  href: string;
  /** The space or department the row belongs to, for a small line under the title. */
  place: string | null;
}

export interface ApprovalRow extends RowBase {
  kind: "approval";
  byName: string;
  /** «٥٠٠ د.أ»-style text, only when the server handed the amount to this person (never for somebody who may not see it). */
  amount: string | null;
  status: string;
  /** Who the request waits on (shown under «طلباتي»). */
  waitingOn: string | null;
  /** The person's own step is the one that decides now. */
  canDecide: boolean;
}

export interface AssignRow extends RowBase {
  kind: "assign";
  taskId: string;
  requestId: string;
  /** «ZK-12». */
  key: string;
  fromName: string;
  toName: string;
  asCo: boolean;
  /** The request is addressed to this person: accept, or return with a reason. */
  canAnswer: boolean;
}

export interface TicketRow extends RowBase {
  kind: "ticket";
  key: string;
  status: string;
  priority: string;
  assignee: string | null;
  /** «استلمها»: the existing ticket update (in progress, assigned to the person). */
  canTake: boolean;
  /** «حُلّت»: the existing ticket update (resolved). */
  canResolve: boolean;
}

export interface CardRow extends RowBase {
  kind: "card";
  cardKind: string;
  byName: string | null;
  /** The person moderates the card's space: approve it or send it back to a draft. */
  canDecide: boolean;
}

export interface SheetRow extends RowBase {
  kind: "sheet";
  byName: string | null;
  /** The version the approver is looking at: an approval is of THAT version. */
  version: number;
  canDecide: boolean;
}

export type RequestRow = ApprovalRow | AssignRow | TicketRow | CardRow | SheetRow;

export interface RequestSection {
  key: SectionKey;
  /** How many wait in all (the rows below are the newest ones). */
  total: number;
  rows: RequestRow[];
  /** The page that lists all of it, where one exists (the approvals pages stay pages). */
  allHref: string | null;
}

export interface WorkRequestsView {
  tab: RequestTab;
  /** The signed-in person (the ticket «استلمها» assigns the ticket to them). */
  viewerId: string;
  /** When the server built this answer: the screen's cache is keyed by it, so a page the person comes back to is never an older answer. */
  builtAt: string;
  /** The sum of the sections' totals: the number on «الشغل» when the tab is «بانتظاري». */
  total: number;
  /** Only the sections that exist for this person (a switch that is off, a box they do not hold, a space they do not manage: no section). */
  sections: RequestSection[];
}
