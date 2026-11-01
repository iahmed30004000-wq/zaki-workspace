-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "sizeBytes" BIGINT,
    "tableCount" INTEGER,
    "rowCount" INTEGER,
    "driveFileId" TEXT,
    "errorKey" TEXT,
    "errorDetail" TEXT,
    "requestedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifyOk" BOOLEAN,
    "verifyTables" INTEGER,
    "verifyRows" INTEGER,
    "verifyErrorKey" TEXT,
    "prunedAt" TIMESTAMP(3),

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRun_organizationId_startedAt_idx" ON "BackupRun"("organizationId", "startedAt");

-- AddForeignKey
ALTER TABLE "BackupRun" ADD CONSTRAINT "BackupRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

