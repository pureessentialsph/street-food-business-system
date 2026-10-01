-- DropIndex
DROP INDEX "ShiftCompensation_shiftId_key";

-- AlterTable
ALTER TABLE "CartShift" ADD COLUMN     "backdatedAt" TIMESTAMP(3),
ADD COLUMN     "backdatedById" TEXT;

-- CreateTable
CREATE TABLE "CartShiftVendor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartShiftVendor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CartShiftVendor_companyId_employeeId_idx" ON "CartShiftVendor"("companyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "CartShiftVendor_shiftId_employeeId_key" ON "CartShiftVendor"("shiftId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftCompensation_shiftId_employeeId_key" ON "ShiftCompensation"("shiftId", "employeeId");

-- AddForeignKey
ALTER TABLE "CartShiftVendor" ADD CONSTRAINT "CartShiftVendor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartShiftVendor" ADD CONSTRAINT "CartShiftVendor_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CartShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartShiftVendor" ADD CONSTRAINT "CartShiftVendor_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

