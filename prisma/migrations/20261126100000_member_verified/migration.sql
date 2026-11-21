-- S5.5: «إشارة التوثيق». One nullable column on the company membership: the moment the OWNER gave the person the check badge (null: none).
-- Additive: no default, no backfill, nothing is dropped or changed; every existing row simply has no badge.

-- AlterTable
ALTER TABLE "OrganizationMember" ADD COLUMN     "verifiedAt" TIMESTAMP(3);
