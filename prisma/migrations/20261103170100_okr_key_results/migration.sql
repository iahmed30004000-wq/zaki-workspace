-- «الأهداف والنتائج»: key results, their links to a project or tasks, and their append-only check-ins.
--
-- Additive only: one new enum, three nullable columns on "Goal" (every existing objective stays as it is: no owner,
-- no light), and three NEW, empty tables with their own indexes and foreign keys. Nothing existing is altered,
-- renamed or rewritten.

-- CreateEnum
CREATE TYPE "GoalLight" AS ENUM ('ON_TRACK', 'BEHIND', 'AT_RISK');

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "light" "GoalLight",
ADD COLUMN     "lightSetAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KeyResult" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "linkedProjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyResultTask" (
    "keyResultId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyResultTask_pkey" PRIMARY KEY ("keyResultId","taskId")
);

-- CreateTable
CREATE TABLE "KeyResultUpdate" (
    "id" TEXT NOT NULL,
    "keyResultId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "previousValue" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyResultUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeyResult_goalId_position_idx" ON "KeyResult"("goalId", "position");

-- CreateIndex
CREATE INDEX "KeyResult_linkedProjectId_idx" ON "KeyResult"("linkedProjectId");

-- CreateIndex
CREATE INDEX "KeyResultTask_taskId_idx" ON "KeyResultTask"("taskId");

-- CreateIndex
CREATE INDEX "KeyResultUpdate_keyResultId_createdAt_idx" ON "KeyResultUpdate"("keyResultId", "createdAt");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyResult" ADD CONSTRAINT "KeyResult_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyResult" ADD CONSTRAINT "KeyResult_linkedProjectId_fkey" FOREIGN KEY ("linkedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyResultTask" ADD CONSTRAINT "KeyResultTask_keyResultId_fkey" FOREIGN KEY ("keyResultId") REFERENCES "KeyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyResultTask" ADD CONSTRAINT "KeyResultTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyResultUpdate" ADD CONSTRAINT "KeyResultUpdate_keyResultId_fkey" FOREIGN KEY ("keyResultId") REFERENCES "KeyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
