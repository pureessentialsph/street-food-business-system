-- CreateEnum
CREATE TYPE "CompensationRuleType" AS ENUM ('SET_COMPLETION', 'REFILL_BONUS', 'COMMISSION_PCT', 'PER_UNIT', 'TARGET_BONUS', 'ATTENDANCE');

-- CreateEnum
CREATE TYPE "PayStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "DeductionType" AS ENUM ('CASH_SHORTAGE', 'CASH_ADVANCE', 'UNRETURNED_ITEM', 'DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "CompensationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "type" "CompensationRuleType" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "params" JSONB NOT NULL DEFAULT '{}',
    "scopeProductId" TEXT,
    "scopeCategoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CompensationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftCompensation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "schemeId" TEXT,
    "businessDate" DATE NOT NULL,
    "basePay" DECIMAL(14,4) NOT NULL,
    "incentiveTotal" DECIMAL(14,4) NOT NULL,
    "deductionTotal" DECIMAL(14,4) NOT NULL,
    "netPay" DECIMAL(14,4) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "status" "PayStatus" NOT NULL DEFAULT 'DRAFT',
    "payrollItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftCompensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deduction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT,
    "payrollItemId" TEXT,
    "type" "DeductionType" NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "note" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "businessDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Deduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "branchId" TEXT,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "totals" JSONB NOT NULL DEFAULT '{}',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "daysWorked" INTEGER NOT NULL DEFAULT 0,
    "basePayTotal" DECIMAL(14,4) NOT NULL,
    "incentiveTotal" DECIMAL(14,4) NOT NULL,
    "deductionTotal" DECIMAL(14,4) NOT NULL,
    "netPay" DECIMAL(14,4) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompensationRule_companyId_schemeId_isActive_idx" ON "CompensationRule"("companyId", "schemeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftCompensation_shiftId_key" ON "ShiftCompensation"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftCompensation_companyId_employeeId_businessDate_idx" ON "ShiftCompensation"("companyId", "employeeId", "businessDate");

-- CreateIndex
CREATE INDEX "ShiftCompensation_companyId_status_idx" ON "ShiftCompensation"("companyId", "status");

-- CreateIndex
CREATE INDEX "Deduction_companyId_employeeId_businessDate_idx" ON "Deduction"("companyId", "employeeId", "businessDate");

-- CreateIndex
CREATE INDEX "PayrollRun_companyId_status_periodStart_idx" ON "PayrollRun"("companyId", "status", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_companyId_reference_key" ON "PayrollRun"("companyId", "reference");

-- CreateIndex
CREATE INDEX "PayrollItem_companyId_employeeId_idx" ON "PayrollItem"("companyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollItem_payrollRunId_employeeId_key" ON "PayrollItem"("payrollRunId", "employeeId");

-- AddForeignKey
ALTER TABLE "CompensationRule" ADD CONSTRAINT "CompensationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationRule" ADD CONSTRAINT "CompensationRule_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "CompensationScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCompensation" ADD CONSTRAINT "ShiftCompensation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

