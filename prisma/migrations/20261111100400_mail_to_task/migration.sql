-- «بريد يصير مهمة» (the owner, 2026-11-04): the company's mailbox is read by the app and each new mail becomes a task.
-- Additive only: TWO NEW TABLES. Nothing existing is touched. The mailbox password is stored ENCRYPTED in "MailInbox"."passwordEnc"
-- (never plain text) and is never read back by a route. No foreign keys on purpose (as "AiSettings").

-- CreateTable
CREATE TABLE "MailInbox" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 993,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'INBOX',
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "allowList" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "markSeen" BOOLEAN NOT NULL DEFAULT false,
    "lastUid" INTEGER,
    "uidValidity" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastErrorKey" TEXT,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailTaskSeen" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailTaskSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailInbox_orgId_key" ON "MailInbox"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "MailTaskSeen_orgId_messageId_key" ON "MailTaskSeen"("orgId", "messageId");
