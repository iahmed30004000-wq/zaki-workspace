-- W1.3 (B): the data move for "BoardColumn"."stage" (the structure is the migration before this one). Two statements, each with its WHERE.
-- Safe to repeat: both only look at columns still holding the column's default 'DOING', so a second run changes nothing and a stage a
-- person chose (anything but the default) is never overwritten.

-- 1. a column that marks "done" is the DONE stage.
UPDATE "BoardColumn"
SET "stage" = 'DONE'
WHERE "done" = true
  AND "stage" = 'DOING';

-- 2. the first column of each board (the smallest position; on a tie the smallest id) that is not a done column is TODO.
UPDATE "BoardColumn" c
SET "stage" = 'TODO'
WHERE c."done" = false
  AND c."stage" = 'DOING'
  AND c."id" = (
    SELECT x."id"
    FROM "BoardColumn" x
    WHERE x."boardId" = c."boardId"
    ORDER BY x."position" ASC, x."id" ASC
    LIMIT 1
  );
