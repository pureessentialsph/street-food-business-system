"use server";

import { z } from "zod";
import { dec } from "@/lib/money";
import { decimalString } from "@/lib/validation/masterdata";
import { assertScope } from "@/lib/rbac";
import { audit, parseForm, refresh, toActionError, withPermission, type ActionResult } from "./helpers";

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const categorySchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(60),
  kind: z.enum(["COGS", "OPEX", "CAPEX"]),
  isOverhead: z.coerce.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.coerce.boolean().default(true),
});

export async function saveExpenseCategory(
  id: string | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("expense.write");
    const parsed = parseForm(categorySchema, formData);
    if (!parsed.ok) return parsed.result;

    if (id) {
      const before = await ctx.db.expenseCategory.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That category no longer exists." };
      const after = await ctx.db.expenseCategory.update({ where: { id }, data: parsed.data });
      await audit(ctx, "UPDATE", "ExpenseCategory", id, before, after);
      refresh("/expenses");
      return { ok: true, id, message: `${after.name} saved.` };
    }
    const created = await ctx.db.expenseCategory.create({
      data: { ...parsed.data, companyId: ctx.db.$companyId },
    });
    await audit(ctx, "CREATE", "ExpenseCategory", created.id, null, created);
    refresh("/expenses");
    return { ok: true, id: created.id, message: `${created.name} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

const expenseSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  categoryId: z.string().min(1, "Choose a category"),
  scopeType: z.enum(["COMPANY", "BRANCH", "CART"]),
  scopeId: z.string().optional().or(z.literal("").transform(() => undefined)),
  amount: decimalString("Amount", { min: 0, allowZero: false }),
  paymentMethod: z.enum(["CASH", "GCASH", "BANK", "CREDIT"]),
  description: z.string().trim().min(3, "Say what this was for"),
  attachmentKey: z.string().trim().max(300).optional().or(z.literal("").transform(() => undefined)),
});

export async function saveExpense(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("expense.write");
    const parsed = parseForm(expenseSchema, formData);
    if (!parsed.ok) return parsed.result;
    const data = parsed.data;

    if (data.scopeType !== "COMPANY" && !data.scopeId) {
      return { ok: false, error: "Choose which branch or cart this expense belongs to." };
    }
    // A supervisor can only spend against their own branch.
    if (data.scopeType === "BRANCH" && data.scopeId) assertScope(ctx.user, data.scopeId);
    if (data.scopeType === "CART" && data.scopeId) {
      const cart = await ctx.db.cart.findUnique({ where: { id: data.scopeId } });
      if (cart) assertScope(ctx.user, cart.branchId);
    }

    const payload = {
      businessDate: toDate(data.businessDate),
      categoryId: data.categoryId,
      scopeType: data.scopeType,
      scopeId: data.scopeType === "COMPANY" ? null : data.scopeId ?? null,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      description: data.description,
      attachmentKey: data.attachmentKey ?? null,
    };

    if (id) {
      const before = await ctx.db.expense.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That expense no longer exists." };
      if (before.status === "APPROVED") {
        return { ok: false, error: "An approved expense cannot be edited. Reject it first, or raise a correcting entry." };
      }
      const after = await ctx.db.expense.update({ where: { id }, data: payload });
      await audit(ctx, "UPDATE", "Expense", id, before, after);
      refresh("/expenses", "/reports");
      return { ok: true, id, message: "Expense saved." };
    }

    const created = await ctx.db.expense.create({
      data: { ...payload, companyId: ctx.db.$companyId, createdById: ctx.user.id },
    });
    await audit(ctx, "CREATE", "Expense", created.id, null, created);
    refresh("/expenses", "/reports");
    return { ok: true, id: created.id, message: `₱${dec(data.amount).toFixed(2)} expense recorded.` };
  } catch (error) {
    return toActionError(error);
  }
}

/** Approval is what lets an expense reach the P&L. */
export async function setExpenseStatus(
  id: string,
  status: "APPROVED" | "REJECTED" | "DRAFT",
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("expense.approve");
    const before = await ctx.db.expense.findUnique({ where: { id } });
    if (!before) return { ok: false, error: "That expense no longer exists." };

    // Whoever recorded it should not be the one waving it through.
    if (status === "APPROVED" && before.createdById === ctx.user.id) {
      return {
        ok: false,
        error: "You recorded this expense, so someone else has to approve it.",
      };
    }

    const after = await ctx.db.expense.update({
      where: { id },
      data: {
        status,
        approvedAt: status === "APPROVED" ? new Date() : null,
        approvedById: status === "APPROVED" ? ctx.user.id : null,
      },
    });
    await audit(ctx, "UPDATE", "Expense", id, before, after);
    refresh("/expenses", "/reports");
    return { ok: true, message: `Expense ${status.toLowerCase()}.` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("expense.write");
    const before = await ctx.db.expense.findUnique({ where: { id } });
    if (!before) return { ok: false, error: "That expense is already gone." };
    if (before.status === "APPROVED") {
      return { ok: false, error: "An approved expense stays on the record. Reject it instead." };
    }
    await audit(ctx, "DELETE", "Expense", id, before, null);
    await ctx.db.expense.delete({ where: { id } });
    refresh("/expenses", "/reports");
    return { ok: true, message: "Expense removed." };
  } catch (error) {
    return toActionError(error);
  }
}

const recurringSchema = z.object({
  categoryId: z.string().min(1, "Choose a category"),
  scopeType: z.enum(["COMPANY", "BRANCH", "CART"]),
  scopeId: z.string().optional().or(z.literal("").transform(() => undefined)),
  amount: decimalString("Amount", { min: 0, allowZero: false }),
  description: z.string().trim().min(3, "Say what this is"),
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  nextRunDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the next due date"),
});

export async function saveRecurringExpense(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("expense.write");
    const parsed = parseForm(recurringSchema, formData);
    if (!parsed.ok) return parsed.result;

    const created = await ctx.db.recurringExpense.create({
      data: {
        companyId: ctx.db.$companyId,
        categoryId: parsed.data.categoryId,
        scopeType: parsed.data.scopeType,
        scopeId: parsed.data.scopeType === "COMPANY" ? null : parsed.data.scopeId ?? null,
        amount: parsed.data.amount,
        description: parsed.data.description,
        frequency: parsed.data.frequency,
        nextRunDate: toDate(parsed.data.nextRunDate),
        createdById: ctx.user.id,
      },
    });
    await audit(ctx, "CREATE", "RecurringExpense", created.id, null, created);
    refresh("/expenses");
    return { ok: true, message: `${created.description} will post ${created.frequency.toLowerCase()}.` };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Post everything due. Rent and permits should not depend on someone remembering.
 * Posted as DRAFT so they still pass an approval before reaching the P&L.
 */
export async function postDueRecurringExpenses(): Promise<ActionResult> {
  try {
    const ctx = await withPermission("expense.write");
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const due = await ctx.db.recurringExpense.findMany({
      where: { isActive: true, nextRunDate: { lte: today } },
    });

    let posted = 0;
    for (const item of due) {
      await ctx.db.expense.create({
        data: {
          companyId: ctx.db.$companyId,
          businessDate: item.nextRunDate,
          categoryId: item.categoryId,
          scopeType: item.scopeType,
          scopeId: item.scopeId,
          amount: item.amount,
          paymentMethod: "CASH",
          description: `${item.description} (recurring)`,
          recurringId: item.id,
          createdById: ctx.user.id,
        },
      });

      const next = new Date(item.nextRunDate);
      if (item.frequency === "DAILY") next.setUTCDate(next.getUTCDate() + 1);
      if (item.frequency === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7);
      if (item.frequency === "MONTHLY") next.setUTCMonth(next.getUTCMonth() + 1);

      await ctx.db.recurringExpense.update({
        where: { id: item.id },
        data: { nextRunDate: next },
      });
      posted += 1;
    }

    refresh("/expenses");
    return {
      ok: true,
      message: posted
        ? `${posted} recurring expense${posted === 1 ? "" : "s"} posted as drafts awaiting approval.`
        : "Nothing was due.",
    };
  } catch (error) {
    return toActionError(error);
  }
}
