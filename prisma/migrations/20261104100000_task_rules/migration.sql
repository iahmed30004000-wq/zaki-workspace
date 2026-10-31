-- Task rules (if-then automations per project), part of the project page.
--
-- Additive only: two NEW, empty tables with their own indexes, two new enums and two foreign keys that point at
-- tables that already exist (Project) or are created here (TaskRule). Nothing existing is altered, renamed or rewritten.
-- TaskRuleRun is an append-only log: the application never updates or deletes a row of it.

-- CreateEnum
CREATE TYPE "TaskRuleTrigger" AS ENUM ('MOVED_TO_COLUMN', 'COMPLETED', 'OVERDUE', 'CREATED');

-- CreateEnum
CREATE TYPE "TaskRuleRunStatus" AS ENUM ('APPLIED', 'PARTIAL', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "TaskRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boardId" TEXT,
    "name" TEXT NOT NULL,
    "trigger" "TaskRuleTrigger" NOT NULL,
    "triggerColumnId" TEXT,
    "actions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "armedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runAsId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRuleRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "trigger" "TaskRuleTrigger" NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "runAsId" TEXT NOT NULL,
    "status" "TaskRuleRunStatus" NOT NULL,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskRuleRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskRule_projectId_active_trigger_idx" ON "TaskRule"("projectId", "active", "trigger");

-- CreateIndex
CREATE INDEX "TaskRule_orgId_idx" ON "TaskRule"("orgId");

-- CreateIndex
CREATE INDEX "TaskRuleRun_projectId_createdAt_idx" ON "TaskRuleRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskRuleRun_orgId_idx" ON "TaskRuleRun"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskRuleRun_ruleId_taskId_key" ON "TaskRuleRun"("ruleId", "taskId");

-- AddForeignKey
ALTER TABLE "TaskRule" ADD CONSTRAINT "TaskRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRuleRun" ADD CONSTRAINT "TaskRuleRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TaskRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
