import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { perRequest } from "@/server/env";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import { FEATURES, economyOn, featureOn, ownChoicesOf, withFeature, type FeatureKey } from "@/lib/features";
import { presetChanges, type FeaturePreset } from "@/lib/feature-groups";

/**
 * «الميزات» on the server: the company's switches (`Organization.settings.features`), read on every request.
 * A switched-off feature's routes answer 404 (`assertFeatureOn`), its pages «not found», its place is not drawn;
 * nothing it stored is touched. Only the OWNER switches (src/lib/features.ts holds the keys and their defaults).
 */

/**
 * The company's name and settings, read ONCE per server render (`perRequest`, F1.2): the layout, the page and every
 * `isFeatureOn` of the render share this one read (a conversation page asked seven times before). The key is the company's id;
 * nothing outlives the render, so a switch the owner flips is seen by the very next request. C1.2 reuses it.
 */
export const orgSummaryOf = perRequest(async (orgId: string) => db.organization.findUnique({ where: { id: orgId }, select: { name: true, settings: true } }));

async function settingsOf(orgId: string): Promise<unknown> {
  return (await orgSummaryOf(orgId))?.settings ?? {};
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

/**
 * A1.4 — a preset («الوضع البسيط» / «كل شي», src/lib/feature-groups.ts): the OWNER's alone, like a single switch (D-A4: the owner rank, unchanged). The client names the
 * preset; the KEYS are the server's, judged against the company's own choices under the same row lock, written in ONE update with every other key of the settings kept.
 * Only the switches whose value differs are written and answered; nothing stored by a feature is touched, so «كل شي» gives back exactly what the simple mode switched off.
 * The audit line (`org.features_preset`: the preset and the keys it changed) is written in the same transaction. A press that changes nothing writes nothing and leaves no audit line.
 */
export async function applyFeaturePreset(ctx: OrgAccessContext, preset: FeaturePreset): Promise<{ preset: FeaturePreset; changed: { key: FeatureKey; on: boolean }[] }> {
  if (ctx.orgRole !== "OWNER") throw new ForbiddenError("features.owner_only");
  const changed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${ctx.orgId} FOR UPDATE`;
    const org = await tx.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } });
    const settings = org?.settings ?? {};
    const changes = presetChanges(preset, ownChoicesOf(settings));
    if (changes.length === 0) return changes;
    const next = changes.reduce<Record<string, unknown>>((acc, c) => withFeature(acc, c.key, c.on), settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {});
    await tx.organization.update({ where: { id: ctx.orgId }, data: { settings: next as Prisma.InputJsonValue } });
    // the audit line is part of the same transaction: the change and its record land together or not at all
    await tx.auditLog.create({ data: { action: "org.features_preset", actorId: ctx.userId, orgId: ctx.orgId, meta: { preset, changed: changes.map((c) => c.key) } } });
    return changes;
  });
  return { preset, changed };
}
