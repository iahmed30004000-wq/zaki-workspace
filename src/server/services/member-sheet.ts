import { NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import {
  canResetCapabilities,
  capabilityGroups,
  explainAreas,
  explainState,
  managerCandidates,
  normalizeMember,
  offeredActions,
  permissionAreas,
  resetCapabilityLists,
  SECTION_ACTIONS,
  toggleCapability,
  transferCandidates,
  type ActorInfo,
  type CapabilityLists,
  type CapabilityRow,
  type ContractMember,
  type OfferedActions,
  type OrgRoleName,
  type SectionCell,
} from "@/lib/members-ui";
import { getServerT } from "@/lib/i18n/server";
import { orgSummaryOf } from "./features";
import { listOrgMembers, type RosterMember } from "./org-members";

/**
 * One person's sheet of «الحسابات والصلاحيات» as the site draws it, decided on the server by the site's OWN functions (`offeredActions`,
 * `permissionAreas`, `capabilityGroups`, `toggleCapability`, `resetCapabilityLists`): the phone draws the answer and sends back the lists a row
 * carries (`next`), so it never re-implements who may switch what. The routes that change a person stay the site's; this only reads.
 */

/** A switch or a grid box with the two stored lists it leads to when flipped (what the site's `toggleCapability` would send). */
export type SheetRow = CapabilityRow & { next: CapabilityLists };
export type SheetCell = SectionCell & { next: CapabilityLists };

export interface MemberSheet {
  member: ContractMember;
  acts: OfferedActions;
  /** the actor is of the OWNER rank: آ«ط¥ط´ط§ط±ط© ط§ظ„طھظˆط«ظٹظ‚آ» is theirs to give (the verify door judges again) */
  ownerRank: boolean;
  /** the ranks the rank box offers, the person's own first when the actor may not give it (as the site's sheet) */
  roles: OrgRoleName[];
  /** «الرقابة الصامتة»: the primary owner's switch on a partner's sheet; null otherwise */
  oversight: SheetRow | null;
  areas: { id: string; on: number; total: number; grid: { section: string; cells: (SheetCell | null)[] }[]; rows: SheetRow[] }[];
  /** «رجّع حسب الرتبة»: the lists it sends, or null when it would change nothing (or the sheet is read-only) */
  reset: CapabilityLists | null;
  /** «شو بيقدر يعمل؟»: every permission the sheet offers, can or cannot, and why in the site's own sentence (the company's switches read here, so always known) */
  explain: { id: string; rows: { capability: string; usable: boolean; why: string }[] }[];
  managers: { id: string; name: string }[];
  receivers: { id: string; name: string; role: OrgRoleName; primaryOwner: boolean }[];
}

function contractOf(m: RosterMember): ContractMember {
  return normalizeMember({ ...m, lastLoginAt: m.lastLoginAt ? new Date(m.lastLoginAt).toISOString() : null } as Partial<ContractMember> & { id: string });
}

export async function memberSheetFor(actor: Actor, userId: string): Promise<MemberSheet> {
  const roster = await listOrgMembers(actor);
  const members = roster.members.map(contractOf);
  const member = members.find((m) => m.id === userId);
  if (!member) throw new NotFoundError("orgm.not_member");
  const info: ActorInfo = { id: actor.userId, role: actor.role, caps: [...actor.caps], primaryOwner: roster.actorPrimaryOwner, sectionGrid: roster.sectionGrid };
  const acts = offeredActions(info, member);
  const editable = acts.capabilities === "editable";
  const withNext = <R extends CapabilityRow>(row: R): R & { next: CapabilityLists } => ({ ...row, next: toggleCapability(member, row.capability, !row.on) });
  const drawn = acts.capabilities === "editable" || acts.capabilities === "readonly";
  const oversight = editable ? capabilityGroups(member, info, editable).find((g) => g.id === "oversight")?.rows[0] : undefined;
  return {
    member,
    acts,
    ownerRank: actor.role === "OWNER",
    roles: acts.rankChoices.length === 0 || acts.rankChoices.includes(member.role) ? acts.rankChoices : [member.role, ...acts.rankChoices],
    oversight: oversight ? withNext(oversight) : null,
    areas: drawn
      ? permissionAreas(member, info, editable).map((area) => ({
          id: area.id,
          on: area.on,
          total: area.total,
          grid: area.grid.map((row) => ({ section: row.section, cells: SECTION_ACTIONS.map((a) => (row.cells[a] ? withNext(row.cells[a] as SectionCell) : null)) })),
          rows: area.rows.map(withNext),
        }))
      : [],
    explain: drawn ? explainOf(member, (await orgSummaryOf(actor.orgId))?.settings ?? {}) : [],
    reset: editable && canResetCapabilities(member, info) ? resetCapabilityLists(member, info) : null,
    managers: managerCandidates(members, member.id).map((m) => ({ id: m.id, name: m.name })),
    receivers: transferCandidates(members, member.id).map((m) => ({ id: m.id, name: m.name, role: m.role, primaryOwner: m.primaryOwner === true })),
  };
}

function explainOf(member: ContractMember, settings: unknown): MemberSheet["explain"] {
  const { t } = getServerT();
  return explainAreas(member, settings).map((area) => ({
    id: area.id,
    rows: area.rows.map((row) => ({
      capability: row.capability,
      usable: explainState(row, true) === "can",
      why: row.reason === "feature_off" && row.feature ? t("perm.why.feature_off", { name: t(`features.${row.feature}.name`) }) : t(`perm.why.${row.reason}`),
    })),
  }));
}
