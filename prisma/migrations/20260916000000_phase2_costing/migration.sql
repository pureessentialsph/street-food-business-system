-- CreateEnum
CREATE TYPE "AllocationBasis" AS ENUM ('PER_BATCH', 'PER_PIECE', 'PER_STICK');

-- CreateEnum
CREATE TYPE "ComponentType" AS ENUM ('RAW', 'PACKAGING', 'CONDIMENT', 'OIL', 'CONSUMABLE');

-- CreateEnum
CREATE TYPE "CostTrigger" AS ENUM ('RECIPE_CREATED', 'RECIPE_EDITED', 'INGREDIENT_COST_CHANGE', 'MANUAL_RECALC', 'SEED');

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "batchYieldPieces" DECIMAL(14,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "qtyInBaseUnit" DECIMAL(14,4) NOT NULL,
    "wastagePct" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "allocationBasis" "AllocationBasis" NOT NULL DEFAULT 'PER_BATCH',
    "componentType" "ComponentType" NOT NULL DEFAULT 'RAW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCostVersion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "recipeVersion" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "costPerPiece" DECIMAL(14,4) NOT NULL,
    "costPerStick" DECIMAL(14,4) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "triggeredBy" "CostTrigger" NOT NULL DEFAULT 'MANUAL_RECALC',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ProductCostVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recipe_companyId_productId_isActive_idx" ON "Recipe"("companyId", "productId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_productId_version_key" ON "Recipe"("productId", "version");

-- CreateIndex
CREATE INDEX "RecipeLine_companyId_ingredientId_idx" ON "RecipeLine"("companyId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeLine_recipeId_ingredientId_allocationBasis_key" ON "RecipeLine"("recipeId", "ingredientId", "allocationBasis");

-- CreateIndex
CREATE INDEX "ProductCostVersion_companyId_productId_effectiveFrom_idx" ON "ProductCostVersion"("companyId", "productId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostVersion" ADD CONSTRAINT "ProductCostVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostVersion" ADD CONSTRAINT "ProductCostVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

