-- «آخر ظهور», second fill: a sign-in is also kept on the account itself («آخر دخول» in the members list), and the
-- first fill did not read it, so people who signed in only that way still showed «غير معروف».
--
-- For an ACTIVE member whose account belongs to exactly ONE active company, the time becomes the account's last sign-in
-- when that is LATER than what is recorded (or nothing is recorded). It only moves forward to a sign-in that really
-- happened; a later time already recorded is never lowered; a person in two companies is left alone because a sign-in
-- is not tied to one of them; a second run changes nothing.

UPDATE "OrganizationMember" AS m
SET "lastSeenAt" = u."lastLoginAt"
FROM "User" AS u
WHERE u."id" = m."userId"
  AND m."status" = 'ACTIVE'
  AND u."lastLoginAt" IS NOT NULL
  AND (m."lastSeenAt" IS NULL OR m."lastSeenAt" < u."lastLoginAt")
  AND (SELECT count(*) FROM "OrganizationMember" AS o WHERE o."userId" = m."userId" AND o."status" = 'ACTIVE') = 1;
