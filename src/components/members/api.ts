/**
 * The team screen's conversation with `/api/organizations/[id]/members`.
 *
 * `membersApi` is the raw calls (one function per endpoint of the account API contract). The flows
 * below it are what the screen actually runs: validate, call, and answer either `{ ok: true, value }`
 * or `{ ok: false, message }` with the message already in Arabic. Secrets (a temporary password)
 * travel back only as a flow's value: they are never put in the query cache, in storage or in a URL.
 */
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import {
  buildCreatePayload,
  buildInfoPatch,
  capabilityListsAfterRankChange,
  capabilityPatch,
  memberErrorMessage,
  normalizeMembersResponse,
  normalizeUsername,
  resetCapabilityLists,
  toggleCapability,
  validateAddForm,
  validateInfoForm,
  type AddFormField,
  type ActorInfo,
  type AddFormValues,
  type CapabilityLists,
  type ContractMember,
  type CreatePayload,
  type InfoForm,
  type InfoPatch,
  type MembersResponse,
  type TFn,
} from "@/lib/members-ui";
import type { Capability } from "@/server/policy/capabilities";
import type { MemberTemplate, RoleTemplate } from "@/lib/permission-templates";

export interface CreateResult {
  userId: string;
  username?: string;
  temporaryPassword?: string;
}

export interface OkResult {
  ok: true;
  temporaryPassword?: string;
}

export interface StatusBody {
  action: "suspend" | "reactivate" | "offboard";
  transferToUserId?: string;
}

/** `GET /api/organizations/[id]/role-templates` (A1.1, behind the switch `permissionTemplates`: 404 while it is off). */
export interface TemplatesResponse {
  templates: RoleTemplate[];
  rev: string;
  canEdit: boolean;
}

/** What applying a template answers: the person as they ended up. */
export interface AppliedResponse {
  ok: true;
  role: ContractMember["role"];
  capabilities: string[];
  revokedCapabilities: string[];
  template: MemberTemplate;
}

const base = (orgId: string) => `/api/organizations/${encodeURIComponent(orgId)}/members`;
const one = (orgId: string, userId: string) => `${base(orgId)}/${encodeURIComponent(userId)}`;

export const membersApi = {
  list: async (orgId: string): Promise<MembersResponse> => normalizeMembersResponse(await apiGet<MembersResponse>(base(orgId))),
  create: (orgId: string, body: CreatePayload) => apiPost<CreateResult>(base(orgId), body),
  patch: (orgId: string, userId: string, body: InfoPatch | CapabilityLists) => apiPatch<OkResult>(one(orgId, userId), body),
  status: (orgId: string, userId: string, body: StatusBody) => apiPost<OkResult>(`${one(orgId, userId)}/status`, body),
  resetPassword: (orgId: string, userId: string) => apiPost<OkResult>(`${one(orgId, userId)}/password`),
  logout: (orgId: string, userId: string) => apiPost<OkResult>(`${one(orgId, userId)}/logout`),
  templates: (orgId: string) => apiGet<TemplatesResponse>(`/api/organizations/${encodeURIComponent(orgId)}/role-templates`),
  applyTemplate: (orgId: string, templateId: string, userId: string) =>
    apiPost<AppliedResponse>(`/api/organizations/${encodeURIComponent(orgId)}/role-templates/${encodeURIComponent(templateId)}/apply`, { userId }),
};

// ---------------------------------------------------------------------------------- outcomes

export interface FlowFailure {
  ok: false;
  /** Arabic, ready to show. */
  message: string;
  /** The API error code, `client.invalid` for a form refused before sending, or `network`. */
  code: string;
  /** The server's message key (`accounts.transfer_required`, ...), when it sent one. */
  messageKey?: string;
  /** The form field to point at (client-side validation only). */
  field?: AddFormField;
}

export type FlowOutcome<T> = { ok: true; value: T } | FlowFailure;

function failure(err: unknown, t: TFn): FlowFailure {
  const e = (typeof err === "object" && err !== null ? err : {}) as { code?: unknown; messageKey?: unknown };
  return {
    ok: false,
    message: memberErrorMessage(err, t),
    code: typeof e.code === "string" ? e.code : "network",
    ...(typeof e.messageKey === "string" ? { messageKey: e.messageKey } : {}),
  };
}

function invalid(message: string, field?: AddFormField): FlowFailure {
  return { ok: false, message, code: "client.invalid", ...(field ? { field } : {}) };
}

// ---------------------------------------------------------------------------------- the flows

export interface CreatedPerson {
  userId: string;
  username: string;
  name: string;
  /** The temporary password to show once; null only if the server did not send one. */
  password: string | null;
}

/** A free sign-in name made from the person's name, or "" (the form keeps what it already shows). */
export async function suggestUsername(orgId: string, name: string, signal: AbortSignal): Promise<string> {
  try {
    const res = await fetch(`/api/organizations/${encodeURIComponent(orgId)}/members/suggest-username?name=${encodeURIComponent(name)}`, { signal, cache: "no-store" });
    if (!res.ok) return "";
    const json = (await res.json()) as { username?: unknown };
    return typeof json.username === "string" ? json.username : "";
  } catch {
    return "";
  }
}

export async function createMember(orgId: string, values: AddFormValues, t: TFn): Promise<FlowOutcome<CreatedPerson>> {
  const problem = validateAddForm(values);
  if (problem) return invalid(t(problem.key), problem.field);
  try {
    const res = await membersApi.create(orgId, buildCreatePayload(values));
    return {
      ok: true,
      value: {
        userId: res.userId,
        username: res.username ?? normalizeUsername(values.username),
        name: values.name.trim(),
        password: res.temporaryPassword ?? (values.autoPassword ? null : values.password),
      },
    };
  } catch (err) {
    return failure(err, t);
  }
}

/** Name, job title, rank and manager. Resolves to what changed locally (null = nothing to save). */
export async function saveMemberInfo(
  orgId: string,
  member: ContractMember,
  form: InfoForm,
  members: readonly ContractMember[],
  actor: ActorInfo,
  t: TFn,
): Promise<FlowOutcome<Partial<ContractMember> | null>> {
  const problem = validateInfoForm(form);
  if (problem) return invalid(t(problem.key), problem.field);
  const patch = buildInfoPatch(member, form);
  if (Object.keys(patch).length === 0) return { ok: true, value: null };
  try {
    await membersApi.patch(orgId, member.id, patch);
    const local: Partial<ContractMember> = {};
    if (patch.name !== undefined) local.name = patch.name;
    if (patch.jobTitle !== undefined) local.jobTitle = patch.jobTitle === "" ? null : patch.jobTitle;
    if (patch.role !== undefined) {
      // The server recomposes the person's switches for the new rank (and switches off the new rank's
      // defaults that THIS actor does not hold): show exactly that, not the old lists under the new rank.
      local.role = patch.role;
      Object.assign(local, capabilityPatch({ role: patch.role }, capabilityListsAfterRankChange(actor, member, patch.role)));
    }
    if (patch.managerId !== undefined) {
      local.managerId = patch.managerId;
      local.managerName = patch.managerId ? (members.find((m) => m.id === patch.managerId)?.name ?? null) : null;
    }
    if (patch.role === "GUEST") {
      // the server also clears a new guest's manager (an external partner follows nobody)
      local.managerId = null;
      local.managerName = null;
    }
    return { ok: true, value: local };
  } catch (err) {
    return failure(err, t);
  }
}

type CapabilityResult = Pick<ContractMember, "capabilities" | "revokedCapabilities" | "effectiveCapabilities">;

/** One switch, saved at once. */
export async function setCapability(
  orgId: string,
  member: ContractMember,
  capability: Capability,
  on: boolean,
  t: TFn,
): Promise<FlowOutcome<CapabilityResult>> {
  const lists = toggleCapability(member, capability, on);
  try {
    await membersApi.patch(orgId, member.id, lists);
    return { ok: true, value: capabilityPatch(member, lists) };
  } catch (err) {
    return failure(err, t);
  }
}

/**
 * Back to what the rank gives: the displayed switches the actor may change are cleared; what the
 * screen does not show, and what the actor cannot take away, stays as stored (see `resetCapabilityLists`).
 */
export async function resetCapabilities(
  orgId: string,
  member: ContractMember,
  actor: ActorInfo,
  t: TFn,
): Promise<FlowOutcome<CapabilityResult>> {
  const lists: CapabilityLists = resetCapabilityLists(member, actor);
  try {
    await membersApi.patch(orgId, member.id, lists);
    return { ok: true, value: capabilityPatch(member, lists) };
  } catch (err) {
    return failure(err, t);
  }
}

/**
 * Applies a template to a person (the server judges it again and answers what they ended with). Resolves to what changed locally: the rank,
 * both lists, what the person can do now and «القالب: X» without «معدّل».
 */
export async function applyTemplate(orgId: string, member: ContractMember, templateId: string, t: TFn): Promise<FlowOutcome<Partial<ContractMember>>> {
  try {
    const res = await membersApi.applyTemplate(orgId, templateId, member.id);
    const lists: CapabilityLists = { capabilities: res.capabilities, revokedCapabilities: res.revokedCapabilities };
    return { ok: true, value: { role: res.role, ...capabilityPatch({ role: res.role }, lists), template: res.template } };
  } catch (err) {
    return failure(err, t);
  }
}

export async function suspendMember(orgId: string, member: ContractMember, t: TFn): Promise<FlowOutcome<Partial<ContractMember>>> {
  try {
    await membersApi.status(orgId, member.id, { action: "suspend" });
    return { ok: true, value: { status: "SUSPENDED" } };
  } catch (err) {
    return failure(err, t);
  }
}

export interface Reactivated {
  /** The new temporary password, to show once. */
  password: string | null;
  patch: Partial<ContractMember>;
}

export async function reactivateMember(orgId: string, member: ContractMember, t: TFn): Promise<FlowOutcome<Reactivated>> {
  try {
    const res = await membersApi.status(orgId, member.id, { action: "reactivate" });
    return {
      ok: true,
      value: { password: res.temporaryPassword ?? null, patch: { status: "ACTIVE", mustChangePassword: true } },
    };
  } catch (err) {
    return failure(err, t);
  }
}

/**
 * Leaving the team. When the person has open work a person to hand it to is required: the server
 * insists, and the screen refuses to send without one rather than wait for the 400.
 */
export async function offboardMember(
  orgId: string,
  member: ContractMember,
  transferToUserId: string | null,
  t: TFn,
): Promise<FlowOutcome<Partial<ContractMember>>> {
  if (member.openWork > 0 && !transferToUserId) return invalid(t("accounts.transfer_required"));
  try {
    await membersApi.status(orgId, member.id, {
      action: "offboard",
      ...(transferToUserId ? { transferToUserId } : {}),
    });
    return { ok: true, value: { status: "OFFBOARDED", workspaces: [], openWork: 0 } };
  } catch (err) {
    return failure(err, t);
  }
}

export interface PasswordReset {
  password: string | null;
  patch: Partial<ContractMember>;
}

export async function resetMemberPassword(orgId: string, member: ContractMember, t: TFn): Promise<FlowOutcome<PasswordReset>> {
  try {
    const res = await membersApi.resetPassword(orgId, member.id);
    return { ok: true, value: { password: res.temporaryPassword ?? null, patch: { mustChangePassword: true } } };
  } catch (err) {
    return failure(err, t);
  }
}

export async function logoutEverywhere(orgId: string, member: ContractMember, t: TFn): Promise<FlowOutcome<true>> {
  try {
    await membersApi.logout(orgId, member.id);
    return { ok: true, value: true };
  } catch (err) {
    return failure(err, t);
  }
}
