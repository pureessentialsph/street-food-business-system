-- CreateEnum
CREATE TYPE "PoStatus" AS ENUM ('SUGGESTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('NEW', 'ACCEPTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "poNo" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "destinationBranchId" TEXT NOT NULL,
    "status" "PoStatus" NOT NULL DEFAULT 'SUGGESTED',
    "orderedAt" TIMESTAMP(3),
    "expectedAt" DATE,
    "receivedAt" TIMESTAMP(3),
    "totalAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("poNo")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "qtyPurchaseUnit" DECIMAL(14,4) NOT NULL,
    "purchaseUnitName" TEXT NOT NULL,
    "baseUnitsPerPurchaseUnit" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "qtyReceivedBase" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplenishmentSuggestion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationType" "StockLocationType" NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHand" DECIMAL(14,4) NOT NULL,
    "avgDailyUsage" DECIMAL(14,4) NOT NULL,
    "daysOfCover" DECIMAL(14,4),
    "reorderPoint" DECIMAL(14,4) NOT NULL,
    "suggestedQty" DECIMAL(14,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'NEW',
    "dismissReason" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplenishmentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_status_idx" ON "PurchaseOrder"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_reference_key" ON "PurchaseOrder"("companyId", "reference");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_companyId_ingredientId_idx" ON "PurchaseOrderLine"("companyId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_poNo_ingredientId_key" ON "PurchaseOrderLine"("poNo", "ingredientId");

-- CreateIndex
CREATE INDEX "ReplenishmentSuggestion_companyId_status_generatedAt_idx" ON "ReplenishmentSuggestion"("companyId", "status", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReplenishmentSuggestion_companyId_itemType_itemId_locationT_key" ON "ReplenishmentSuggestion"("companyId", "itemType", "itemId", "locationType", "locationId", "status");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_poNo_fkey" FOREIGN KEY ("poNo") REFERENCES "PurchaseOrder"("poNo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentSuggestion" ADD CONSTRAINT "ReplenishmentSuggestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

