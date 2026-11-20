/**
 * «طلبات الموافقة» — the shapes the routes and the pages hand to the screens (plain data: strings, numbers, no Date, so they
 * cross from the server to the browser as they are). Types only.
 *
 * ⚠️ `amount` is `null` for anybody who may not see one. A guest is never given an approval at all, and this field is the second
 * lock: the service builds it from the viewer, never from the row.
 */
import type { Answers, FormSchema } from "./forms";
import type { LinkKind, RevisionSnapshot } from "./shared";

export interface PersonRef {
  id: string;
  name: string;
}

export interface AmountView {
  minor: number;
  currency: string;
}

export interface StepView {
  id: string;
  version: number;
  position: number;
  approver: PersonRef;
  status: string;
  reason: string | null;
  notifiedAt: string | null;
  decidedAt: string | null;
}

export interface AttachmentView {
  id: string;
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  version: number;
  /** The one file route (`/api/files/[id]/raw`): it lets in exactly the people who may read the request. */
  url: string;
}

export interface LinkView {
  kind: LinkKind;
  id: string;
  /** Where it opens (that page decides again who may read it); null when the thing is gone. */
  href: string | null;
}

export interface ListItem {
  id: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  status: string;
  version: number;
  currentStep: number;
  requester: PersonRef;
  amount: AmountView | null;
  /**
   * Present ONLY on a request of a money form («طلب مصروف», «تحويل بين الصناديق», I1.3): `true` when the request has an amount that the viewer
   * may not see (they hold neither `prices.view` nor `cash.view` and did not ask it themselves). The figure, the currency and the invoice photo
   * are cut on the server; this is only the flag that lets the screen say so.
   */
  amountHidden?: boolean;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  /** The chain of the current version, in order. */
  steps: { position: number; approver: PersonRef; status: string }[];
  /** The approver whose turn it is (a request being decided only). */
  waitingOn: PersonRef | null;
  fromForm: boolean;
}

export interface RevisionView extends RevisionSnapshot {
  steps: StepView[];
  attachments: AttachmentView[];
}

/** What the viewer may do with this request now (the server checks again on every action). */
export interface YouView {
  requester: boolean;
  /** Named in the chain of the current version. */
  approver: boolean;
  /** Their step is the one that decides now. */
  canDecide: boolean;
  canCancel: boolean;
  canResubmit: boolean;
  /** Reads it because of their place (space manager or owner), not because they asked or were asked. */
  oversight: boolean;
}

export interface ApprovalDetail extends ListItem {
  details: string;
  linkedTo: LinkView | null;
  attachments: AttachmentView[];
  stepsDetail: StepView[];
  /** Earlier versions (after «اطلب تعديل»): their content, their steps and their files, oldest first. */
  previous: RevisionView[];
  form: { id: string; name: string; version: number } | null;
  /** For the requester who must edit a request that came from a form: its questions (the version it was filled with) and the answers. */
  formFill: { schema: FormSchema; answers: Answers } | null;
  you: YouView;
}

export interface FormListItem {
  id: string;
  familyId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  version: number;
  fields: number;
  approvers: PersonRef[];
  /** ⚠️ Somebody in the preset chain can no longer be asked in this space (left, suspended, a guest now). */
  approverProblem: boolean;
  archived: boolean;
  createdAt: string;
}
