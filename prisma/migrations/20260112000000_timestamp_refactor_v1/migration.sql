-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "metadata" JSONB DEFAULT '{}',
ADD COLUMN     "model_id" TEXT NOT NULL DEFAULT 'llama3.2:1b',
ADD COLUMN     "new_id" TEXT NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "user_id" TEXT NOT NULL DEFAULT 'piuser-1';

ALTER TABLE "Chat" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "Chat" RENAME COLUMN "updatedAt" TO "updated_at";

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "metadata" JSONB DEFAULT '{}',
ADD COLUMN     "message_group_id" TEXT NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "model_id" TEXT,
ADD COLUMN     "new_id" TEXT NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "new_chat_id" TEXT,
ADD COLUMN     "user_id" TEXT NOT NULL DEFAULT 'piuser-1';

ALTER TABLE "Message" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "Message" RENAME COLUMN "updatedAt" TO "updated_at";

-- UpdateData (Link Messages to new Chat UUIDs)
UPDATE "Message" m
SET "new_chat_id" = c."new_id"
FROM "Chat" c
WHERE m."chatId" = c."id";

-- DropForeignKey
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_modelId_fkey";

-- DropForeignKey
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_username_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_chatId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_username_fkey";

-- DropTable
DROP TABLE "Model";

-- DropTable
DROP TABLE "User";

-- AlterTable (Finalize Chat)
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_pkey";
ALTER TABLE "Chat" DROP COLUMN "id";
ALTER TABLE "Chat" DROP COLUMN "modelId";
ALTER TABLE "Chat" DROP COLUMN "username";
ALTER TABLE "Chat" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_pkey" PRIMARY KEY ("id");

-- AlterTable (Finalize Message)
ALTER TABLE "Message" DROP CONSTRAINT "Message_pkey";
ALTER TABLE "Message" DROP COLUMN "id";
ALTER TABLE "Message" DROP COLUMN "chatId";
ALTER TABLE "Message" DROP COLUMN "username";
ALTER TABLE "Message" DROP COLUMN "messageGroupId";
ALTER TABLE "Message" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "Message" RENAME COLUMN "new_chat_id" TO "chat_id";
ALTER TABLE "Message" ADD CONSTRAINT "Message_pkey" PRIMARY KEY ("id");
ALTER TABLE "Message" ALTER COLUMN "chat_id" SET NOT NULL;


-- CreateIndex
CREATE INDEX "Chat_user_id_idx" ON "Chat"("user_id");

-- CreateIndex
CREATE INDEX "Chat_updated_at_idx" ON "Chat"("updated_at");

-- CreateIndex
CREATE INDEX "Message_chat_id_created_at_idx" ON "Message"("chat_id", "created_at");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
