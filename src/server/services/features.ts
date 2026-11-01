import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { FEATURES, economyOn, featureOn, ownChoicesOf, withFeature, type FeatureKey } from "@/lib/features";

/**
 * «الميزات» on the server: the company's switches (`Organization.settings.features`), read on every request.
 * A switched-off feature's routes answer 404 (`assertFeatureOn`), its pages «not found», its place is not drawn;
 * nothing it stored is touched. Only the OWNER switches (src/lib/features.ts holds the keys and their defaults).
 */

async function settingsOf(orgId: string): Promise<unknown> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  return org?.settings ?? {};
}

export async function isFeatureOn(orgId: string, key: FeatureKey): Promise<boolean> {
  return featureOn(await settingsOf(orgId), key);
}

/** The same for whoever is asking (an `Actor`, an `OrgAccessContext`: anything with the company). */
export async function actorFeatureOn(actor: { orgId: string }, key: FeatureKey): Promise<boolean> {
  return isFeatureOn(actor.orgId, key);
}

/** A switched-off feature does not exist for anybody: its routes answer 404 `features.off`. */
export async function assertFeatureOn(orgId: string, key: FeatureKey): Promise<void> {
  if (!(await isFeatureOn(orgId, key))) throw new NotFoundError("features.off");
}

/** «وضع التوفير» is on for this company: the heavy switches of `ECONOMY_FORCED_OFF` are held off (src/lib/features.ts). */
export async function isEconomyOn(orgId: string): Promise<boolean> {
  return economyOn(await settingsOf(orgId));
}

/**
 * Every switch of the company as the OWNER set it, for «الميزات» (economy mode is NOT applied here: a switch the owner left on and
 * economy mode holds off still shows on, and the screen marks it «مطفية بوضع التوفير»; the effective value is `isFeatureOn`).
 */
export async function listFeatures(orgId: string): Promise<{ key: FeatureKey; on: boolean }[]> {
  const all = ownChoicesOf(await settingsOf(orgId));
  return FEATURES.map((key) => ({ key, on: all[key] }));
}

/** One switch on or off: the OWNER's alone. Every other key of the settings is kept (read and written in one go). */
export async function setFeature(ctx: OrgAccessContext, key: FeatureKey, on: boolean): Promise<{ key: FeatureKey; on: boolean }> {
  if (ctx.orgRole !== "OWNER") throw new ForbiddenError("features.owner_only");
  await db.$transaction(async (tx) => {
    // the row is locked for the read-and-write, so two switches pressed at once both land
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${ctx.orgId} FOR UPDATE`;
    const org = await tx.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } });
    await tx.organization.update({ where: { id: ctx.orgId }, data: { settings: withFeature(org?.settings ?? {}, key, on) as Prisma.InputJsonValue } });
  });
  return { key, on };
}
