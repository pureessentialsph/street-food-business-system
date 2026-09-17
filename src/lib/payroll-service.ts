import type { Prisma } from "@prisma/client";
import type { ScopedDb } from "@/lib/db";
import { dec } from "@/lib/money";
import {
  computeShiftPay, type CompensationRule, type PayLineInput,
  type PayResult, type SetDefinitionInput,
} from "@/lib/engines/compensation";

/**
 * Turns a closed shift into pay, and a period of pay into a payroll run.
 *
 * The engine does the arithmetic; this file only fetches and stores. Approved payroll
 * snapshots its breakdown so editing a rule next month cannot rewrite what was paid.
 */

/** The set in force on a given business date. */
async function setInForce(db: ScopedDb, businessDate: Date): Promise<SetDefinitionInput | null> {
  const set = await db.setDefinition.findFirst({
    where: { isActive: true, effectiveFrom: { lte: businessDate } },
    include: { components: { include: { product: { select: { name: true } } } } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!set) return null;
  return {
    code: set.code,
    incentiveAmount: set.incentiveAmount.toString(),
    completionMode: set.completionMode,
    maxSetsPerComponent: set.maxSetsPerComponent,
    components: set.components.map((component) => ({
      productId: component.productId,
      productName: component.product.name,
      requiredSticks: component.requiredSticks.toString(),
      creditValue: component.creditValue?.toString() ?? null,
    })),
  };
}

/** Compute and store what one shift earned. Called at closing and on recalculation. */
export async function computeShiftCompensation(
  db: ScopedDb,
  shiftId: string,
): Promise<PayResult | null> {
  const shift = await db.cartShift.findUnique({
    where: { id: shiftId },
    include: { lines: true, issues: true },
  });
  if (!shift) return null;

  const employee = await db.employee.findUnique({
    where: { id: shift.employeeId },
    include: { compensationScheme: { include: { rules: { where: { isActive: true } } } } },
  });
  if (!employee?.compensationScheme) return null;

  const scheme = employee.compensationScheme;

  const products = await db.product.findMany({
    where: { id: { in: shift.lines.map((l) => l.productId) } },
    select: { id: true, name: true, categoryId: true },
  });
  const categoryOf = new Map(products.map((p) => [p.id, p.categoryId]));
  const nameOf = new Map(products.map((p) => [p.id, p.name]));

  const lines: PayLineInput[] = shift.lines.map((line) => ({
    productId: line.productId,
    productName: nameOf.get(line.productId),
    categoryId: categoryOf.get(line.productId) ?? null,
    sticksSold: line.sticksSold.toString(),
    piecesSold: line.piecesSold.toString(),
  }));

  // Approved deductions raised against this shift, on top of any cash shortage.
  const extras = await db.deduction.findMany({
    where: { shiftId, type: { not: "CASH_SHORTAGE" } },
  });

  const result = computeShiftPay({
    shift: {
      status: shift.status,
      netSales: shift.netSales.toString(),
      cashVariance: shift.cashVariance.toString(),
      vendorAcknowledged: shift.vendorAcknowledged,
      refillCount: shift.issues.filter((i) => i.isRefill).length,
    },
    lines,
    scheme: {
      name: scheme.name,
      baseDailyRate: scheme.baseDailyRate.toString(),
      deductShortage: scheme.deductShortage,
      maxShortageDeduction: scheme.maxShortageDeduction ? scheme.maxShortageDeduction.toString() : null,
    },
    rules: scheme.rules.map<CompensationRule>((rule) => ({
      id: rule.id,
      type: rule.type,
      priority: rule.priority,
      params: (rule.params ?? {}) as Record<string, unknown>,
      scopeProductId: rule.scopeProductId,
      scopeCategoryId: rule.scopeCategoryId,
    })),
    setDefinition: await setInForce(db, shift.businessDate),
    deductions: extras.map((d) => ({
      type: d.type,
      amount: d.amount.toString(),
      note: d.note ?? undefined,
    })),
  });

  await db.shiftCompensation.upsert({
    where: { shiftId },
    update: {
      employeeId: shift.employeeId,
      schemeId: scheme.id,
      businessDate: shift.businessDate,
      basePay: result.basePay,
      incentiveTotal: result.incentiveTotal,
      deductionTotal: result.deductionTotal,
      netPay: result.netPay,
      breakdown: result as unknown as Prisma.InputJsonValue,
      status: "DRAFT",
    },
    create: {
      companyId: db.$companyId,
      shiftId,
      employeeId: shift.employeeId,
      schemeId: scheme.id,
      businessDate: shift.businessDate,
      basePay: result.basePay,
      incentiveTotal: result.incentiveTotal,
      deductionTotal: result.deductionTotal,
      netPay: result.netPay,
      breakdown: result as unknown as Prisma.InputJsonValue,
    },
  });

  // Record the shortage so it is visible in the employee's deduction history too.
  const shortage = result.lines.find((l) => l.ruleType === "CASH_SHORTAGE");
  if (shortage && dec(shortage.amount).greaterThan(0)) {
    const existing = await db.deduction.findFirst({ where: { shiftId, type: "CASH_SHORTAGE" } });
    if (existing) {
      await db.deduction.update({
        where: { id: existing.id },
        data: { amount: shortage.amount, acknowledged: shift.vendorAcknowledged },
      });
    } else {
      await db.deduction.create({
        data: {
          companyId: db.$companyId,
          employeeId: shift.employeeId,
          shiftId,
          type: "CASH_SHORTAGE",
          amount: shortage.amount,
          note: shortage.computation,
          acknowledged: shift.vendorAcknowledged,
          businessDate: shift.businessDate,
        },
      });
    }
  }

  return result;
}

/** Which shifts a payroll run may include, and which are held back and why. */
export async function payablePeriod(
  db: ScopedDb,
  periodStart: Date,
  periodEnd: Date,
  branchId?: string | null,
) {
  const shifts = await db.cartShift.findMany({
    where: {
      businessDate: { gte: periodStart, lte: periodEnd },
      ...(branchId ? { branchId } : {}),
    },
    orderBy: { businessDate: "asc" },
  });

  const compensations = await db.shiftCompensation.findMany({
    where: { businessDate: { gte: periodStart, lte: periodEnd } },
  });
  const compByShift = new Map(compensations.map((c) => [c.shiftId, c]));

  const payable = shifts.filter((s) => s.status === "APPROVED" && compByShift.has(s.id));
  const held = shifts.filter((s) => s.status !== "APPROVED");

  return { shifts, payable, held, compByShift };
}
