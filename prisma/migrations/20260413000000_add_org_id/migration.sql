-- Add org_id to Chat
ALTER TABLE "Chat" ADD COLUMN "org_id" TEXT;

-- Composite index for org-scoped queries
CREATE INDEX "Chat_org_id_user_id_idx" ON "Chat"("org_id", "user_id");

-- Backfill all existing chat records to the public org
UPDATE "Chat" SET "org_id" = 'a0000000-0000-4000-8000-000000000002' WHERE "org_id" IS NULL;
