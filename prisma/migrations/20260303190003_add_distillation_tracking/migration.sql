-- AlterTable
ALTER TABLE "Chat" ADD COLUMN "last_distilled_at" TIMESTAMP(3);
ALTER TABLE "Chat" ADD COLUMN "distilled_message_count" INTEGER NOT NULL DEFAULT 0;
