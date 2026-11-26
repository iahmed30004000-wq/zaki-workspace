-- «محصور بمساحة»: an account that works only in the spaces it was put in. Additive: every existing row is false.
ALTER TABLE "OrganizationMember" ADD COLUMN "spaceOnly" BOOLEAN NOT NULL DEFAULT false;
