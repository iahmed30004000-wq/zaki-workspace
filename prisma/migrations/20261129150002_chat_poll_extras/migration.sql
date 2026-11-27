-- The extra poll options (quiz and its explanation, adding options later, hidden results, no change of vote, shuffled order). Additive: every new column has a default or is nullable, so an old poll is exactly what it was.
ALTER TABLE "Poll" ADD COLUMN     "quiz" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "explanation" TEXT,
ADD COLUMN     "openOptions" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hideResults" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "noRevote" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shuffle" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PollOption" ADD COLUMN     "correct" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "addedById" TEXT;
