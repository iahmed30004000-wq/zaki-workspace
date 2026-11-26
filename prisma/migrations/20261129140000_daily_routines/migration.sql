-- «روتين يومي»: a template that makes one card per company day, and the day each routine already made its card.
-- Additive: two new tables, nothing existing is changed.
-- CreateTable
CREATE TABLE "DailyRoutine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "days" INTEGER[],
    "time" TEXT NOT NULL,
    "dueTime" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stoppedReason" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyRoutine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyRoutineRun" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyRoutineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyRoutine_active_nextRunAt_idx" ON "DailyRoutine"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "DailyRoutine_orgId_idx" ON "DailyRoutine"("orgId");

-- CreateIndex
CREATE INDEX "DailyRoutine_workspaceId_idx" ON "DailyRoutine"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRoutineRun_routineId_day_key" ON "DailyRoutineRun"("routineId", "day");

-- AddForeignKey
ALTER TABLE "DailyRoutine" ADD CONSTRAINT "DailyRoutine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRoutine" ADD CONSTRAINT "DailyRoutine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRoutine" ADD CONSTRAINT "DailyRoutine_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRoutineRun" ADD CONSTRAINT "DailyRoutineRun_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "DailyRoutine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

