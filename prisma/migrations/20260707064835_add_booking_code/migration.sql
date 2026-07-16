-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "booking_code" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_code_key" ON "bookings"("booking_code");
