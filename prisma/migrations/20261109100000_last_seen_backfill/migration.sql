-- «آخر ظهور» for the people who were here before it was recorded.
--
-- The time is written by the presence layer only while somebody is connected, so everybody who has not opened the site
-- since the feature went live showed «غير معروف». For each ACTIVE member with NO recorded time, take the latest thing
-- we KNOW they did in that company: a sign-in, or a message they wrote (never a system line). That can only be earlier
-- than their real last visit, never later. A person who has a time already is not touched, a person with nothing to go
-- on keeps NULL, and a second run changes nothing. The hide choice is still decided when the time is read.

UPDATE "OrganizationMember" AS m
SET "lastSeenAt" = s."at"
FROM (
  SELECT
    x."id" AS "memberId",
    GREATEST(
      (SELECT max(a."createdAt") FROM "AuditLog" AS a
        WHERE a."actorId" = x."userId" AND a."action" = 'auth.login' AND (a."orgId" = x."organizationId" OR a."orgId" IS NULL)),
      (SELECT max(c."createdAt") FROM "ChatMessage" AS c
        WHERE c."authorId" = x."userId" AND c."orgId" = x."organizationId" AND c."kind" <> 'SYSTEM')
    ) AS "at"
  FROM "OrganizationMember" AS x
  WHERE x."lastSeenAt" IS NULL AND x."status" = 'ACTIVE'
) AS s
WHERE m."id" = s."memberId" AND s."at" IS NOT NULL AND m."lastSeenAt" IS NULL;
