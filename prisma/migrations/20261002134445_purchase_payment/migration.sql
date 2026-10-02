-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidById" TEXT,
ADD COLUMN     "paymentMethod" "PaymentMethod";
