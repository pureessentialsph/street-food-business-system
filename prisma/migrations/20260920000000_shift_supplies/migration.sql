-- CreateTable
CREATE TABLE "ShiftSupply" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "qtyIssued" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "qtyReturned" DECIMAL(14,4),
    "qtyConsumed" DECIMAL(14,4),
    "unitCost" DECIMAL(14,4) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "ShiftSupply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftSupply_companyId_ingredientId_idx" ON "ShiftSupply"("companyId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftSupply_shiftId_ingredientId_key" ON "ShiftSupply"("shiftId", "ingredientId");

-- AddForeignKey
ALTER TABLE "ShiftSupply" ADD CONSTRAINT "ShiftSupply_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSupply" ADD CONSTRAINT "ShiftSupply_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CartShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

