-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "TopicGroup" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicGroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicGroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateIndex
CREATE INDEX "TopicGroup_spaceId_position_idx" ON "TopicGroup"("spaceId", "position");

-- CreateIndex
CREATE INDEX "TopicGroup_orgId_idx" ON "TopicGroup"("orgId");

-- CreateIndex
CREATE INDEX "TopicGroupMember_userId_idx" ON "TopicGroupMember"("userId");

-- CreateIndex
CREATE INDEX "Conversation_groupId_idx" ON "Conversation"("groupId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TopicGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicGroup" ADD CONSTRAINT "TopicGroup_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicGroupMember" ADD CONSTRAINT "TopicGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TopicGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicGroupMember" ADD CONSTRAINT "TopicGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

