/*
  Warnings:

  - Changed the type of `category` on the `Asset` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Asset" DROP COLUMN "category",
ADD COLUMN     "category" TEXT NOT NULL;

-- DropEnum
DROP TYPE "AssetCategory";

-- CreateTable
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetCategory_companyId_isActive_idx" ON "AssetCategory"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCategory_companyId_name_key" ON "AssetCategory"("companyId", "name");

-- AddForeignKey
ALTER TABLE "AssetCategory" ADD CONSTRAINT "AssetCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
