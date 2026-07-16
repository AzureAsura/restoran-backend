/*
  Warnings:

  - Added the required column `updated_at` to the `accounts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `sessions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `verifications` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "access_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "id_token" TEXT,
ADD COLUMN     "refresh_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "verifications" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");
