-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('INGREDIENT', 'PRODUCT');

-- CreateEnum
CREATE TYPE "StockLocationType" AS ENUM ('WAREHOUSE', 'BRANCH', 'CART', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "InventoryTxnType" AS ENUM ('PURCHASE_RECEIPT', 'PRODUCTION_IN', 'PRODUCTION_CONSUME', 'TRANSFER_OUT', 'TRANSFER_IN', 'ISSUE_TO_VENDOR', 'RETURN_FROM_VENDOR', 'SALE_CONSUMPTION', 'WASTE', 'SPOILAGE', 'DAMAGE', 'ADJUSTMENT', 'COUNT_VARIANCE');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationType" "StockLocationType" NOT NULL,
    "locationId" TEXT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "type" "InventoryTxnType" NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationType" "StockLocationType" NOT NULL,
    "locationId" TEXT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "avgUnitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "fromLocationType" "StockLocationType" NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationType" "StockLocationType" NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "businessDate" DATE NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "dispatchedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtySent" DECIMAL(14,4) NOT NULL,
    "qtyReceived" DECIMAL(14,4),
    "unitCost" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "recipeVersion" INTEGER NOT NULL,
    "plannedQty" DECIMAL(14,4) NOT NULL,
    "actualQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "wasteQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "businessDate" DATE NOT NULL,
    "producedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalCount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "locationType" "StockLocationType" NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'DRAFT',
    "businessDate" DATE NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "PhysicalCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalCountLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "systemQty" DECIMAL(14,4) NOT NULL,
    "countedQty" DECIMAL(14,4) NOT NULL,
    "variance" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhysicalCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryTransaction_companyId_itemType_itemId_locationType_idx" ON "InventoryTransaction"("companyId", "itemType", "itemId", "locationType", "locationId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_companyId_businessDate_idx" ON "InventoryTransaction"("companyId", "businessDate");

-- CreateIndex
CREATE INDEX "InventoryTransaction_companyId_refType_refId_idx" ON "InventoryTransaction"("companyId", "refType", "refId");

-- CreateIndex
CREATE INDEX "StockBalance_companyId_locationType_locationId_idx" ON "StockBalance"("companyId", "locationType", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_itemType_itemId_locationType_locationId_compan_key" ON "StockBalance"("itemType", "itemId", "locationType", "locationId", "companyId");

-- CreateIndex
CREATE INDEX "StockTransfer_companyId_status_idx" ON "StockTransfer"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_companyId_reference_key" ON "StockTransfer"("companyId", "reference");

-- CreateIndex
CREATE INDEX "StockTransferLine_companyId_itemId_idx" ON "StockTransferLine"("companyId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransferLine_transferId_itemType_itemId_key" ON "StockTransferLine"("transferId", "itemType", "itemId");

-- CreateIndex
CREATE INDEX "ProductionBatch_companyId_status_businessDate_idx" ON "ProductionBatch"("companyId", "status", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_companyId_reference_key" ON "ProductionBatch"("companyId", "reference");

-- CreateIndex
CREATE INDEX "PhysicalCount_companyId_status_idx" ON "PhysicalCount"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalCount_companyId_reference_key" ON "PhysicalCount"("companyId", "reference");

-- CreateIndex
CREATE INDEX "PhysicalCountLine_companyId_itemId_idx" ON "PhysicalCountLine"("companyId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalCountLine_countId_itemType_itemId_key" ON "PhysicalCountLine"("countId", "itemType", "itemId");

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalCount" ADD CONSTRAINT "PhysicalCount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalCountLine" ADD CONSTRAINT "PhysicalCountLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalCountLine" ADD CONSTRAINT "PhysicalCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "PhysicalCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

