import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, ValidationError, audit } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { AccountsError, findRoleTemplate, requireAccountsActor, updateAccount } from "@/server/services/accounts";
import { assertFeatureOn } from "@/server/services/features";
import { checkTemplatesInput, roleTemplatesOf, type RoleTemplate } from "@/lib/permission-templates";

/**
 * «قوالب» (A1.1, switch `permissionTemplates`): the company's templates and how one is applied. The rules are the pure ones of
 * src/lib/permission-templates.ts; this file reads and writes `Organization.settings.roleTemplates` and hands the application to the
 * account service, so applying keeps every rank rule and leaves its audit row there.
 *
 *  - Whoever holds `users.manage` lists the templates and applies them (to people strictly below their rank, giving nothing they do not hold);
 *    only the OWNER names and edits them.
 *  - Saving is a read-compare-write under the row lock of the company: the copy the screen was made from carries a `rev` (a hash of the list), and a
 *    save made on an older copy is refused 409 `ptemplates.stale`, so two owners saving at the same second never lose one silently (Q1.5 noted that
 *    race for its own settings). Only the `roleTemplates` key is replaced; every other key of the settings is kept.
 */

export interface RoleTemplatesView {
  templates: RoleTemplate[];
  /** What a save must send back: a hash of this very list. */
  rev: string;
  /** The OWNER's alone. */
  canEdit: boolean;
}

/** The caller of every template route: an accounts manager of THIS company, with the switch on (404 `features.off` otherwise). */
export async function requireTemplatesActor(orgId: string): Promise<Actor> {
  const actor = await requireAccountsActor(orgId);
  await assertFeatureOn(actor.orgId, "permissionTemplates");
  return actor;
}

/** A hash of the list as the code reads it (so a company that never saved and one that saved the starters unchanged share a rev). */
export function revOf(templates: readonly RoleTemplate[]): string {
  return createHash("sha256").update(JSON.stringify(templates)).digest("hex").slice(0, 32);
}

export async function listRoleTemplates(actor: Actor): Promise<RoleTemplatesView> {
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { settings: true } });
  const templates = roleTemplatesOf(org?.settings);
  return { templates, rev: revOf(templates), canEdit: actor.role === "OWNER" };
}

export const saveTemplatesSchema = z.object({
  templates: z.array(z.unknown()).max(100),
  rev: z.string().min(1).max(100),
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function saveRoleTemplates(actor: Actor, input: z.infer<typeof saveTemplatesSchema>): Promise<RoleTemplatesView> {
  if (actor.role !== "OWNER") throw new ForbiddenError("ptemplates.owner_only");
  const checked = checkTemplatesInput(input.templates, () => `tpl-${randomBytes(5).toString("hex")}`);
  if (!checked.ok) throw new ValidationError([{ path: "templates", message: checked.key }]);
  await db.$transaction(async (tx) => {
    // the row is locked for the read-compare-write: a save made at the same moment waits, then finds the list changed and is told
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${actor.orgId} FOR UPDATE`;
    const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.orgId }, select: { settings: true } });
    if (revOf(roleTemplatesOf(org.settings)) !== input.rev) throw new AccountsError(409, "ptemplates.stale");
    const next: Record<string, unknown> = { ...(isObj(org.settings) ? org.settings : {}), roleTemplates: checked.templates };
    await tx.organization.update({ where: { id: actor.orgId }, data: { settings: next as Prisma.InputJsonValue } });
  });
  await audit("org.role_templates_saved", { actorId: actor.userId, orgId: actor.orgId, meta: { count: checked.templates.length, ids: checked.templates.map((t) => t.id) } });
  return listRoleTemplates(actor);
}

/**
 * Applies the company's template to one person, THROUGH `updateAccount`: the same rank rules, nothing the caller does not hold, the account's own
 * audit row and `membership.changed`, plus `org.template_applied` for the sheet. Answers what the person ended with.
 */
export async function applyRoleTemplate(actor: Actor, templateId: string, userId: string) {
  const template = await findRoleTemplate(actor.orgId, templateId);
  const written = await updateAccount(actor, userId, {}, { template });
  return { ok: true as const, ...written, template: { id: template.id, name: template.name, modified: false } };
}
