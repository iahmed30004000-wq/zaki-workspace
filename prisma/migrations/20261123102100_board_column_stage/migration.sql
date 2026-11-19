-- W1.3 (A): the normalized stage of a board column. A column keeps its own name; the stage (TODO | DOING | REVIEW | DONE) is what
-- the cross-project lists group and filter by. A plain TEXT (the four values are checked by the app's zod enum, so adding one later is no
-- migration). Additive: NOT NULL with a DEFAULT, so every existing row is DOING until the next migration (the data move) sets the two
-- obvious ones. The `done` flag keeps its meaning.
ALTER TABLE "BoardColumn" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'DOING';
