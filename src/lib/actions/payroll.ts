"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { dec, sum } from "@/lib/money";
import { aggregatePay } from "@/lib/engines/compensation";
import { computeShiftCompensation, payablePeriod } from "@/lib/payroll-service";
import { decimalString } from "@/lib/validation/masterdata";
import { audit, parseForm, refresh, toActionError, withPermission, type ActionResult } from "./helpers";

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const runSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date"),
  branchId: z.string().optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(500).optional(),
});

/**
 * Build a payroll run from approved shifts. Nothing is typed in: every peso comes from
 * a ShiftCompensation row, which came from a closing count.
 */
export async function createPayrollRun(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("payroll.run");
    const parsed = parseForm(runSchema, formData);
    if (!parsed.ok) return parsed.result;

    const periodStart = toDate(parsed.data.periodStart);
    const periodEnd = toDate(parsed.data.periodEnd);
    if (periodEnd < periodStart) return { ok: false, error: "The end date is before the start date." };

    const { payable, held, compByShift } = await payablePeriod(
      ctx.db, periodStart, periodEnd, parsed.data.branchId ?? null,
    );

    if (payable.length === 0) {
      return {
        ok: false,
        error: held.length
          ? `No approved shifts in that period. ${held.length} shift${held.length === 1 ? " is" : "s are"} still open, closed-but-unapproved or disputed.`
          : "No shifts at all in that period.",
      };
    }

    const count = await ctx.db.payrollRun.count();
    const reference = `PAY-${String(count + 1).padStart(5, "0")}`;

    const byEmployee = new Map<string, { basePay: string; incentiveTotal: string; deductionTotal: string; netPay: string }[]>();
    const shiftIdsByEmployee = new Map<string, string[]>();

    for (const shift of payable) {
      const comp = compByShift.get(shift.id)!;
      const list = byEmployee.get(shift.employeeId) ?? [];
      list.push({
        basePay: comp.basePay.toString(),
        incentiveTotal: comp.incentiveTotal.toString(),
        deductionTotal: comp.deductionTotal.toString(),
        netPay: comp.netPay.toString(),
      });
      byEmployee.set(shift.employeeId, list);
      shiftIdsByEmployee.set(shift.employeeId, [...(shiftIdsByEmployee.get(shift.employeeId) ?? []), shift.id]);
    }

    const run = await ctx.db.payrollRun.create({
      data: {
        companyId: ctx.db.$companyId,
        reference,
        periodStart,
        periodEnd,
        branchId: parsed.data.branchId ?? null,
        status: "DRAFT",
        notes: parsed.data.notes || null,
        createdById: ctx.user.id,
      },
    });

    for (const [employeeId, shifts] of byEmployee) {
      const totals = aggregatePay(shifts);
      const comps = await ctx.db.shiftCompensation.findMany({
        where: { shiftId: { in: shiftIdsByEmployee.get(employeeId) ?? [] } },
        orderBy: { businessDate: "asc" },
      });

      const item = await ctx.db.payrollItem.create({
        data: {
          companyId: ctx.db.$companyId,
          payrollRunId: run.id,
          employeeId,
          daysWorked: totals.daysWorked,
          basePayTotal: totals.basePayTotal,
          incentiveTotal: totals.incentiveTotal,
          deductionTotal: totals.deductionTotal,
          netPay: totals.netPay,
          breakdown: {
            days: comps.map((c) => ({
              businessDate: c.businessDate.toISOString().slice(0, 10),
              shiftId: c.shiftId,
              basePay: c.basePay.toString(),
              incentiveTotal: c.incentiveTotal.toString(),
              deductionTotal: c.deductionTotal.toString(),
              netPay: c.netPay.toString(),
              lines: (c.breakdown as { lines?: unknown })?.lines ?? [],
            })),
          } as unknown as Prisma.InputJsonValue,
        },
      });

      await ctx.db.shiftCompensation.updateMany({
        where: { shiftId: { in: shiftIdsByEmployee.get(employeeId) ?? [] } },
        data: { payrollItemId: item.id },
      });
    }

    const items = await ctx.db.payrollItem.findMany({ where: { payrollRunId: run.id } });
    await ctx.db.payrollRun.update({
      where: { id: run.id },
      data: {
        totals: {
          employees: items.length,
          shifts: payable.length,
          heldBack: held.length,
          basePay: sum(items.map((i) => i.basePayTotal)).toFixed(2),
          incentives: sum(items.map((i) => i.incentiveTotal)).toFixed(2),
          deductions: sum(items.map((i) => i.deductionTotal)).toFixed(2),
          netPay: sum(items.map((i) => i.netPay)).toFixed(2),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await audit(ctx, "CREATE", "PayrollRun", run.id, null, run);
    refresh("/payroll");
    return {
      ok: true,
      id: run.id,
      message: `${reference}: ${items.length} employees, ${payable.length} shifts${held.length ? `, ${held.length} held back` : ""}.`,
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** DRAFT → REVIEWED → APPROVED → PAID. Approval locks the figures. */
export async function advancePayrollRun(
  runId: string,
  to: "REVIEWED" | "APPROVED" | "PAID",
): Promise<ActionResult> {
  try {
    const ctx = await withPermission(to === "APPROVED" ? "payroll.approve" : "payroll.run");
    const run = await ctx.db.payrollRun.findUnique({ where: { id: runId } });
    if (!run) return { ok: false, error: "That payroll run no longer exists." };

    const order = ["DRAFT", "REVIEWED", "APPROVED", "PAID"] as const;
    if (order.indexOf(to) !== order.indexOf(run.status) + 1) {
      return { ok: false, error: `A ${run.status.toLowerCase()} run cannot go straight to ${to.toLowerCase()}.` };
    }

    // Segregation of duties: whoever built the run should not also approve it.
    if (to === "APPROVED" && run.createdById === ctx.user.id) {
      return {
        ok: false,
        error: "You created this run, so someone else must approve it. Ask an owner, admin or area manager.",
      };
    }

    const after = await ctx.db.payrollRun.update({
      where: { id: runId },
      data: {
        status: to,
        ...(to === "REVIEWED" ? { reviewedAt: new Date(), reviewedById: ctx.user.id } : {}),
        ...(to === "APPROVED" ? { approvedAt: new Date(), approvedById: ctx.user.id } : {}),
        ...(to === "PAID" ? { paidAt: new Date(), paidById: ctx.user.id } : {}),
      },
    });

    if (to === "APPROVED" || to === "PAID") {
      await ctx.db.shiftCompensation.updateMany({
        where: { payrollItemId: { in: (await ctx.db.payrollItem.findMany({ where: { payrollRunId: runId }, select: { id: true } })).map((i) => i.id) } },
        data: { status: to === "PAID" ? "PAID" : "APPROVED" },
      });
    }

    await audit(ctx, "UPDATE", "PayrollRun", runId, run, after);
    refresh("/payroll", `/payroll/${runId}`);
    return { ok: true, message: `${run.reference} is now ${to.toLowerCase()}.` };
  } catch (error) {
    return toActionError(error);
  }
}

const deductionSchema = z.object({
  employeeId: z.string().min(1, "Choose an employee"),
  type: z.enum(["CASH_ADVANCE", "UNRETURNED_ITEM", "DAMAGE", "OTHER"]),
  amount: decimalString("Amount", { min: 0, allowZero: false }),
  note: z.string().trim().min(3, "Say what this is for"),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function recordDeduction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("payroll.run");
    const parsed = parseForm(deductionSchema, formData);
    if (!parsed.ok) return parsed.result;

    const deduction = await ctx.db.deduction.create({
      data: {
        companyId: ctx.db.$companyId,
        employeeId: parsed.data.employeeId,
        type: parsed.data.type,
        amount: parsed.data.amount,
        note: parsed.data.note,
        businessDate: toDate(parsed.data.businessDate),
        approvedById: ctx.user.id,
        createdById: ctx.user.id,
      },
    });
    await audit(ctx, "CREATE", "Deduction", deduction.id, null, deduction);
    refresh("/payroll");
    return { ok: true, message: `₱${dec(parsed.data.amount).toFixed(2)} deduction recorded.` };
  } catch (error) {
    return toActionError(error);
  }
}

/** Recompute pay for every closed shift in a period — after a rule change, say. */
export async function recomputePeriodPay(
  periodStart: string,
  periodEnd: string,
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("payroll.run");
    const shifts = await ctx.db.cartShift.findMany({
      where: {
        businessDate: { gte: toDate(periodStart), lte: toDate(periodEnd) },
        status: { in: ["CLOSED", "APPROVED", "DISPUTED"] },
      },
      select: { id: true },
    });

    let computed = 0;
    for (const shift of shifts) {
      const result = await computeShiftCompensation(ctx.db, shift.id);
      if (result) computed += 1;
    }
    refresh("/payroll");
    return { ok: true, message: `Recomputed pay for ${computed} shift${computed === 1 ? "" : "s"}.` };
  } catch (error) {
    return toActionError(error);
  }
}
