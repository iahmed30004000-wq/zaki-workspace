-- «المعنيين بس»: a task can be private to the people it concerns (additive: one column with a default, one index).
-- Every existing task stays visible to its whole space ('SPACE'): nothing is hidden by this migration.
ALTER TABLE "Task" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'SPACE';

CREATE INDEX "Task_workspaceId_visibility_idx" ON "Task"("workspaceId", "visibility");
