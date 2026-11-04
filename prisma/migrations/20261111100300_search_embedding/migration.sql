-- «بحث بالمعنى»: one vector per message or task, kept as plain numbers (DOUBLE PRECISION[]), NOT the pgvector extension.
-- Additive only: one new table, nothing existing is touched.

-- CreateTable
CREATE TABLE "SearchEmbedding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "conversationId" TEXT,
    "workspaceId" TEXT,
    "vector" DOUBLE PRECISION[],
    "model" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchEmbedding_kind_refId_key" ON "SearchEmbedding"("kind", "refId");

-- CreateIndex
CREATE INDEX "SearchEmbedding_orgId_kind_workspaceId_createdAt_idx" ON "SearchEmbedding"("orgId", "kind", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchEmbedding_orgId_kind_conversationId_createdAt_idx" ON "SearchEmbedding"("orgId", "kind", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchEmbedding_conversationId_idx" ON "SearchEmbedding"("conversationId");

-- AddForeignKey
ALTER TABLE "SearchEmbedding" ADD CONSTRAINT "SearchEmbedding_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchEmbedding" ADD CONSTRAINT "SearchEmbedding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
