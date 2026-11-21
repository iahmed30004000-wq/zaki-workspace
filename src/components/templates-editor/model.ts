import { TEMPLATE_RANKS, cleanTemplate, type RoleTemplate } from "@/lib/permission-templates";
import { OWNER_ONLY, RANK_DEFAULTS, WIRED_CAPABILITIES, grantProblem } from "@/server/policy/capabilities";

/**
 * The pure part of the templates editor (A2.1): which boxes a template of a rank may hold, and how switching a box or the rank changes the two lists the door stores
 * (`caps`: boxes the rank does not give and the template adds; `revoked`: boxes the rank gives and the template takes away). The server judges every rule again
 * (`checkTemplatesInput`); this decides only what the screen OFFERS and keeps the two lists disjoint and meaningful, so a save of what the screen built is accepted.
 */
export type TemplateRank = (typeof TEMPLATE_RANKS)[number];

/** The boxes this rank can hold in a template, in the catalogue's order: wired (not a box that does nothing), not the owner's alone, grantable to the rank. */
export function offeredFor(rank: TemplateRank): string[] {
  return WIRED_CAPABILITIES.filter((c) => !(OWNER_ONLY as readonly string[]).includes(c) && grantProblem(rank, c) === null);
}

export const isRankDefault = (rank: TemplateRank, c: string): boolean => (RANK_DEFAULTS[rank] as readonly string[]).includes(c);

/** Is the box ON for a person given this template? A box the rank gives is on unless the template takes it away; any other is on only when the template adds it. */
export function isOn(template: RoleTemplate, c: string): boolean {
  return isRankDefault(template.rank as TemplateRank, c) ? !template.revoked.includes(c) : template.caps.includes(c);
}

/** The template with one box switched: the lists stay disjoint and each holds only what its meaning allows. */
export function withBox(template: RoleTemplate, c: string, on: boolean): RoleTemplate {
  const rank = template.rank as TemplateRank;
  if (isRankDefault(rank, c)) return { ...template, revoked: on ? template.revoked.filter((x) => x !== c) : [...template.revoked.filter((x) => x !== c), c] };
  return { ...template, caps: on ? [...template.caps.filter((x) => x !== c), c] : template.caps.filter((x) => x !== c) };
}

/**
 * The template moved to another rank: the rank brings ITS OWN defaults (a template never carries one rank's powers over to another), so only the template's own choices stay:
 * its extras that the new rank does not already give, and its revocations of boxes the new rank gives. The cleaner is the one the server uses.
 */
export function withRank(template: RoleTemplate, rank: TemplateRank): RoleTemplate {
  return cleanTemplate({ ...template, rank }) ?? { ...template, rank, caps: [], revoked: [] };
}
