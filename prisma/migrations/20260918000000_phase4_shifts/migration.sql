-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED', 'APPROVED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "AcknowledgedVia" AS ENUM ('SIGNATURE', 'VERBAL_CONFIRMED', 'SMS_SENT', 'NONE');

-- CreateEnum
CREATE TYPE "TargetScope" AS ENUM ('COMPANY', 'BRANCH', 'CART', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "TargetPeriod" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateTable
CREATE TABLE "CartShift" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "vendorAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedVia" "AcknowledgedVia" NOT NULL DEFAULT 'NONE',
    "acknowledgedNote" TEXT,
    "signatureKey" TEXT,
    "cashFloat" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cashRemitted" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "digitalSales" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "otherPayments" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "grossSales" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "netSales" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "expectedCash" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cashVariance" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cogs" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "wasteCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "grossProfit" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CartShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftIssue" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "isRefill" BOOLEAN NOT NULL DEFAULT false,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftIssueLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtyPieces" DECIMAL(14,4) NOT NULL,
    "unitCostPerPiece" DECIMAL(14,4) NOT NULL,
    "pricePerStick" DECIMAL(14,4) NOT NULL,
    "piecesPerStick" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftIssueLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "piecesIssued" DECIMAL(14,4) NOT NULL,
    "piecesReturned" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "piecesWasted" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "wasteReason" TEXT,
    "piecesSold" DECIMAL(14,4) NOT NULL,
    "sticksSold" DECIMAL(14,4) NOT NULL,
    "piecesPerStick" DECIMAL(14,4) NOT NULL,
    "pricePerStick" DECIMAL(14,4) NOT NULL,
    "unitCostPerPiece" DECIMAL(14,4) NOT NULL,
    "discountAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "grossSales" DECIMAL(14,4) NOT NULL,
    "netSales" DECIMAL(14,4) NOT NULL,
    "lineCogs" DECIMAL(14,4) NOT NULL,
    "lineWasteCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scopeType" "TargetScope" NOT NULL,
    "scopeId" TEXT,
    "metric" TEXT NOT NULL DEFAULT 'NET_SALES',
    "periodType" "TargetPeriod" NOT NULL DEFAULT 'DAY',
    "periodStart" DATE NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CartShift_companyId_businessDate_status_idx" ON "CartShift"("companyId", "businessDate", "status");

-- CreateIndex
CREATE INDEX "CartShift_companyId_employeeId_businessDate_idx" ON "CartShift"("companyId", "employeeId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "CartShift_cartId_businessDate_key" ON "CartShift"("cartId", "businessDate");

-- CreateIndex
CREATE INDEX "ShiftIssue_companyId_shiftId_idx" ON "ShiftIssue"("companyId", "shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftIssue_shiftId_seq_key" ON "ShiftIssue"("shiftId", "seq");

-- CreateIndex
CREATE INDEX "ShiftIssueLine_companyId_productId_idx" ON "ShiftIssueLine"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftIssueLine_issueId_productId_key" ON "ShiftIssueLine"("issueId", "productId");

-- CreateIndex
CREATE INDEX "ShiftLine_companyId_productId_idx" ON "ShiftLine"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftLine_shiftId_productId_key" ON "ShiftLine"("shiftId", "productId");

-- CreateIndex
CREATE INDEX "Target_companyId_periodStart_idx" ON "Target"("companyId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Target_companyId_scopeType_scopeId_metric_periodType_period_key" ON "Target"("companyId", "scopeType", "scopeId", "metric", "periodType", "periodStart");

-- AddForeignKey
ALTER TABLE "CartShift" ADD CONSTRAINT "CartShift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftIssue" ADD CONSTRAINT "ShiftIssue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftIssue" ADD CONSTRAINT "ShiftIssue_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CartShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftIssueLine" ADD CONSTRAINT "ShiftIssueLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftIssueLine" ADD CONSTRAINT "ShiftIssueLine_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ShiftIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftLine" ADD CONSTRAINT "ShiftLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftLine" ADD CONSTRAINT "ShiftLine_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CartShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

