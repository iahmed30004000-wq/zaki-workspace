import { Prisma } from "@prisma/client";
import { ECONOMY_FORCED_OFF, FEATURE_DEFAULTS, isFeatureKey, type FeatureKey } from "@/lib/features";

/**
 * «الميزات» inside SQL: the same answer as `featureOn(settings, key)` (src/lib/features.ts) for a query that joins the company's row,
 * so a background job can leave a switched-off company out of its SELECT instead of reading every company's settings first.
 *
 *  - the stored value counts only when it is a JSON boolean (a broken value is the default, exactly like `storedOf`);
 *  - for a key of `ECONOMY_FORCED_OFF` the company's «وضع التوفير» is part of the condition (the overlay), so economy mode stops the
 *    work at the database too, not only on the screen.
 *
 * The key and the table alias are written into the statement text, so both are checked first: a key must be one of `FEATURES`, an alias
 * must be a plain identifier. Nothing a person typed ever reaches either.
 */
export function featureOnSql(key: FeatureKey, orgAlias = "o"): Prisma.Sql {
  if (!isFeatureKey(key)) throw new Error("featureOnSql: unknown feature key");
  if (!/^[a-z][a-z0-9_]*$/i.test(orgAlias)) throw new Error("featureOnSql: bad alias");
  const settings = Prisma.raw(`${orgAlias}."settings"`);
  const flag = (k: string, fallback: boolean): Prisma.Sql => {
    const path = Prisma.raw(`'{features,${k}}'`);
    return Prisma.sql`COALESCE(CASE WHEN jsonb_typeof(${settings} #> ${path}) = 'boolean' THEN (${settings} #>> ${path})::boolean END, ${Prisma.raw(fallback ? "true" : "false")})`;
  };
  const own = flag(key, FEATURE_DEFAULTS[key]);
  if (!(ECONOMY_FORCED_OFF as readonly string[]).includes(key)) return Prisma.sql`(${own})`;
  return Prisma.sql`(${own} AND NOT ${flag("economyMode", FEATURE_DEFAULTS.economyMode)})`;
}
