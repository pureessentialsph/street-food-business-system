-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('CAPITAL', 'OWNER_DRAW', 'SALES', 'EXPENSE', 'PAYROLL', 'PURCHASE', 'BANK_DEPOSIT', 'BANK_WITHDRAWAL', 'COUNT_ADJUSTMENT', 'OTHER_IN', 'OTHER_OUT');

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "branchId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT NOT NULL,
    "reversesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashCountSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "branchId" TEXT,
    "expected" DECIMAL(14,4) NOT NULL,
    "counted" DECIMAL(14,4) NOT NULL,
    "variance" DECIMAL(14,4) NOT NULL,
    "denominations" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "adjustmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "CashCountSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashMovement_companyId_businessDate_idx" ON "CashMovement"("companyId", "businessDate");

-- CreateIndex
CREATE INDEX "CashMovement_companyId_type_idx" ON "CashMovement"("companyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_companyId_refType_refId_key" ON "CashMovement"("companyId", "refType", "refId");

-- CreateIndex
CREATE INDEX "CashCountSession_companyId_businessDate_idx" ON "CashCountSession"("companyId", "businessDate");

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCountSession" ADD CONSTRAINT "CashCountSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
