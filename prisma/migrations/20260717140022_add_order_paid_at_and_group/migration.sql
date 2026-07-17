-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "payment_group_id" TEXT;

-- Backfill: order lama yang sudah paid dianggap dibayar saat terakhir diupdate
-- (kolom paid_at belum ada sebelum ini, jadi updated_at adalah pendekatan terbaik).
-- payment_group_id sengaja TIDAK di-backfill — data lama dianggap "dibayar sendiri", null sudah representasi yang benar.
UPDATE "orders" SET "paid_at" = "updated_at" WHERE "payment_status" = 'paid' AND "paid_at" IS NULL;
