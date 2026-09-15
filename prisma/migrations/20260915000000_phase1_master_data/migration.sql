-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('SCHOOL', 'OFFICE', 'FACTORY', 'TERMINAL', 'MARKET', 'RESIDENTIAL', 'COMMERCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CartType" AS ENUM ('FOOD_CART', 'MOTOR_CART', 'KIOSK');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'IDLE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('PROBATIONARY', 'REGULAR', 'PART_TIME', 'CONTRACTUAL', 'SEPARATED');

-- CreateEnum
CREATE TYPE "EmploymentEventType" AS ENUM ('HIRED', 'REGULARIZED', 'TRANSFERRED', 'PROMOTED', 'RATE_CHANGE', 'SUSPENDED', 'SEPARATED');

-- CreateEnum
CREATE TYPE "IngredientCategory" AS ENUM ('RAW', 'PACKAGING', 'CONDIMENT', 'OIL', 'CONSUMABLE');

-- CreateEnum
CREATE TYPE "BaseUnit" AS ENUM ('G', 'ML', 'PC');

-- CreateEnum
CREATE TYPE "SellingUnit" AS ENUM ('PIECE', 'STICK');

-- CreateEnum
CREATE TYPE "PriceScope" AS ENUM ('COMPANY', 'BRANCH', 'CART');

-- CreateEnum
CREATE TYPE "SetCompletionMode" AS ENUM ('PER_COMPONENT', 'ALL_COMPONENTS', 'PROPORTIONAL');

-- CreateEnum
CREATE TYPE "CostSource" AS ENUM ('MANUAL', 'PURCHASE_RECEIPT', 'IMPORT');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "areaId" TEXT;

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'OTHER',
    "address" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CartType" NOT NULL DEFAULT 'FOOD_CART',
    "branchId" TEXT NOT NULL,
    "locationId" TEXT,
    "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE',
    "defaultVendorId" TEXT,
    "dailySalesTarget" DECIMAL(14,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompensationScheme" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseDailyRate" DECIMAL(14,4) NOT NULL,
    "deductShortage" BOOLEAN NOT NULL DEFAULT true,
    "maxShortageDeduction" DECIMAL(14,4),
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CompensationScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "birthDate" DATE,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactNo" TEXT,
    "position" TEXT NOT NULL,
    "dateHired" DATE NOT NULL,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'PROBATIONARY',
    "separationDate" DATE,
    "branchId" TEXT,
    "cartId" TEXT,
    "dailyRate" DECIMAL(14,4) NOT NULL,
    "compensationSchemeId" TEXT,
    "supervisorId" TEXT,
    "photoKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "EmploymentEventType" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "EmploymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "mobile" TEXT,
    "address" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 1,
    "paymentTerms" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "IngredientCategory" NOT NULL DEFAULT 'RAW',
    "baseUnit" "BaseUnit" NOT NULL DEFAULT 'G',
    "currentCostPerBaseUnit" DECIMAL(14,4) NOT NULL,
    "minStock" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "safetyStock" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "packSize" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierIngredient" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "purchaseUnitName" TEXT NOT NULL,
    "baseUnitsPerPurchaseUnit" DECIMAL(14,4) NOT NULL,
    "lastPurchasePrice" DECIMAL(14,4) NOT NULL,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "SupplierIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientCostHistory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "costPerBaseUnit" DECIMAL(14,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "source" "CostSource" NOT NULL DEFAULT 'MANUAL',
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "IngredientCostHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sellingUnit" "SellingUnit" NOT NULL DEFAULT 'STICK',
    "piecesPerStick" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "imageKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopeType" "PriceScope" NOT NULL DEFAULT 'COMPANY',
    "scopeId" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "pricePerStick" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetDefinition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "incentiveAmount" DECIMAL(14,4) NOT NULL,
    "completionMode" "SetCompletionMode" NOT NULL DEFAULT 'PER_COMPONENT',
    "maxSetsPerComponent" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "SetDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetComponent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "setDefinitionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requiredSticks" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "SetComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Area_companyId_idx" ON "Area"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Area_companyId_name_key" ON "Area"("companyId", "name");

-- CreateIndex
CREATE INDEX "Location_companyId_type_idx" ON "Location"("companyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Location_companyId_name_key" ON "Location"("companyId", "name");

-- CreateIndex
CREATE INDEX "Cart_companyId_branchId_status_idx" ON "Cart"("companyId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_companyId_code_key" ON "Cart"("companyId", "code");

-- CreateIndex
CREATE INDEX "CompensationScheme_companyId_isActive_idx" ON "CompensationScheme"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CompensationScheme_companyId_name_key" ON "CompensationScheme"("companyId", "name");

-- CreateIndex
CREATE INDEX "Employee_companyId_isActive_idx" ON "Employee"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "Employee_companyId_branchId_idx" ON "Employee"("companyId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_employeeNo_key" ON "Employee"("companyId", "employeeNo");

-- CreateIndex
CREATE INDEX "EmploymentEvent_companyId_employeeId_effectiveDate_idx" ON "EmploymentEvent"("companyId", "employeeId", "effectiveDate");

-- CreateIndex
CREATE INDEX "Supplier_companyId_isActive_idx" ON "Supplier"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_companyId_name_key" ON "Supplier"("companyId", "name");

-- CreateIndex
CREATE INDEX "Ingredient_companyId_category_isActive_idx" ON "Ingredient"("companyId", "category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_companyId_sku_key" ON "Ingredient"("companyId", "sku");

-- CreateIndex
CREATE INDEX "SupplierIngredient_companyId_ingredientId_idx" ON "SupplierIngredient"("companyId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierIngredient_supplierId_ingredientId_key" ON "SupplierIngredient"("supplierId", "ingredientId");

-- CreateIndex
CREATE INDEX "IngredientCostHistory_companyId_ingredientId_effectiveFrom_idx" ON "IngredientCostHistory"("companyId", "ingredientId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ProductCategory_companyId_sortOrder_idx" ON "ProductCategory"("companyId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_companyId_name_key" ON "ProductCategory"("companyId", "name");

-- CreateIndex
CREATE INDEX "Product_companyId_categoryId_isActive_idx" ON "Product"("companyId", "categoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Product_companyId_sku_key" ON "Product"("companyId", "sku");

-- CreateIndex
CREATE INDEX "PriceList_companyId_scopeType_isActive_idx" ON "PriceList"("companyId", "scopeType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_companyId_name_key" ON "PriceList"("companyId", "name");

-- CreateIndex
CREATE INDEX "PriceListItem_companyId_productId_idx" ON "PriceListItem"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_productId_key" ON "PriceListItem"("priceListId", "productId");

-- CreateIndex
CREATE INDEX "SetDefinition_companyId_isActive_idx" ON "SetDefinition"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SetDefinition_companyId_code_key" ON "SetDefinition"("companyId", "code");

-- CreateIndex
CREATE INDEX "SetComponent_companyId_productId_idx" ON "SetComponent"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "SetComponent_setDefinitionId_productId_key" ON "SetComponent"("setDefinitionId", "productId");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_defaultVendorId_fkey" FOREIGN KEY ("defaultVendorId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationScheme" ADD CONSTRAINT "CompensationScheme_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_compensationSchemeId_fkey" FOREIGN KEY ("compensationSchemeId") REFERENCES "CompensationScheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentEvent" ADD CONSTRAINT "EmploymentEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentEvent" ADD CONSTRAINT "EmploymentEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierIngredient" ADD CONSTRAINT "SupplierIngredient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierIngredient" ADD CONSTRAINT "SupplierIngredient_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierIngredient" ADD CONSTRAINT "SupplierIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientCostHistory" ADD CONSTRAINT "IngredientCostHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientCostHistory" ADD CONSTRAINT "IngredientCostHistory_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetDefinition" ADD CONSTRAINT "SetDefinition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetComponent" ADD CONSTRAINT "SetComponent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetComponent" ADD CONSTRAINT "SetComponent_setDefinitionId_fkey" FOREIGN KEY ("setDefinitionId") REFERENCES "SetDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetComponent" ADD CONSTRAINT "SetComponent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

