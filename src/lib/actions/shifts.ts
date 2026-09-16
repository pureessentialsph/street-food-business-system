"use server";

import { z } from "zod";
import { businessDateFor, toDateColumn } from "@/lib/businessDate";
import { dec } from "@/lib/money";
import { costAsOf } from "@/lib/costing-service";
import { postLedger, type LedgerEntry } from "@/lib/inventory-service";
import { reconcileShift, validateClosing, type ReconciliationLineInput } from "@/lib/engines/reconciliation";
import { assertCanApproveShift, assertScope } from "@/lib/rbac";
import { computeShiftCompensation } from "@/lib/payroll-service";
import { audit, refresh, toActionError, withPermission, type ActionResult } from "./helpers";

/**
 * The core loop (spec §2): open → issue → refill → close → approve.
 *
 * Closing is ONE database transaction: shift lines, ledger rows, balance updates and
 * shift totals all land together or not at all.
 */

async function companySettings(db: { company: { findFirst: (a: never) => Promise<unknown> } }, companyId: string) {
  const company = (await db.company.findFirst({ where: { id: companyId } } as never)) as
    | { businessDayCutoffHour: number; timezone: string; cashVarianceThreshold: unknown; defaultWastagePct: unknown }
    | null;
  return {
    cutoffHour: company?.businessDayCutoffHour ?? 4,
    timezone: company?.timezone ?? "Asia/Manila",
    varianceThreshold: company?.cashVarianceThreshold?.toString() ?? "100",
  };
}

/** Open today's shift for one cart, defaulting to the cart's usual vendor. */
export async function openShift(cartId: string, employeeId: string | null): Promise<ActionResult> {
  try {
    const ctx = await withPermission("shift.open");
    const settings = await companySettings(ctx.db as never, ctx.user.companyId);
    const businessDate = toDateColumn(businessDateFor(new Date(), settings.cutoffHour, settings.timezone));

    const cart = await ctx.db.cart.findUnique({ where: { id: cartId } });
    if (!cart) return { ok: false, error: "That cart no longer exists." };
    assertScope(ctx.user, cart.branchId);

    const vendorId = employeeId ?? cart.defaultVendorId;
    if (!vendorId) {
      return { ok: false, error: `${cart.code} has no vendor for today. Pick one, or set a usual vendor on the cart.` };
    }

    const existing = await ctx.db.cartShift.findFirst({ where: { cartId, businessDate } });
    if (existing) return { ok: true, id: existing.id, message: `${cart.code} is already open.` };

    const shift = await ctx.db.cartShift.create({
      data: {
        companyId: ctx.db.$companyId,
        cartId,
        employeeId: vendorId,
        branchId: cart.branchId,
        businessDate,
        status: "OPEN",
        openedById: ctx.user.id,
        createdById: ctx.user.id,
      },
    });
    await audit(ctx, "CREATE", "CartShift", shift.id, null, shift);
    refresh("/shifts");
    return { ok: true, id: shift.id, message: `${cart.code} opened.` };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Issue stock to a vendor. seq 1 is the morning load-out; anything later is a refill.
 * Quantities are pieces, and cost and price are snapshotted so this shift's numbers
 * cannot be rewritten by a price change tomorrow.
 */
export async function issueStock(
  shiftId: string,
  quantities: { productId: string; qtyPieces: string }[],
  note?: string,
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("shift.open");
    const wanted = quantities.filter((q) => dec(q.qtyPieces || "0").greaterThan(0));
    if (wanted.length === 0) return { ok: false, error: "Nothing to issue — every quantity is zero." };

    const shift = await ctx.db.cartShift.findUnique({
      where: { id: shiftId },
      include: { issues: true },
    });
    if (!shift) return { ok: false, error: "That shift no longer exists." };
    if (shift.status !== "OPEN") {
      return { ok: false, error: "That shift is already closed. Stock cannot be issued to it." };
    }
    assertScope(ctx.user, shift.branchId);

    const seq = shift.issues.length + 1;
    const isRefill = seq > 1;

    const products = await ctx.db.product.findMany({
      where: { id: { in: wanted.map((w) => w.productId) } },
    });
    const prices = await ctx.db.priceListItem.findMany({
      where: {
        productId: { in: wanted.map((w) => w.productId) },
        priceList: { isActive: true, scopeType: "COMPANY" },
      },
    });
    const priceOf = new Map(prices.map((p) => [p.productId, p.pricePerStick.toString()]));

    const missingPrice = products.filter((p) => !priceOf.has(p.id));
    if (missingPrice.length > 0) {
      return {
        ok: false,
        error: `No price set for ${missingPrice.map((p) => p.name).join(", ")}. Sales cannot be computed without one.`,
      };
    }

    const issue = await ctx.db.shiftIssue.create({
      data: {
        companyId: ctx.db.$companyId,
        shiftId,
        seq,
        isRefill,
        issuedById: ctx.user.id,
        note: note ?? null,
      },
    });

    const entries: LedgerEntry[] = [];

    for (const line of wanted) {
      const product = products.find((p) => p.id === line.productId);
      if (!product) continue;

      // The cost that applied on this shift's business date, not today's (spec §6).
      const cost = await costAsOf(ctx.db, product.id, shift.businessDate);
      const unitCost = cost?.costPerPiece ?? "0";

      await ctx.db.shiftIssueLine.create({
        data: {
          companyId: ctx.db.$companyId,
          issueId: issue.id,
          productId: product.id,
          qtyPieces: line.qtyPieces,
          unitCostPerPiece: unitCost,
          pricePerStick: priceOf.get(product.id)!,
          piecesPerStick: product.piecesPerStick.toString(),
        },
      });

      // Stock leaves the branch and lands with the vendor, so it can be traced to a person.
      entries.push({
        itemType: "PRODUCT", itemId: product.id,
        locationType: "BRANCH", locationId: shift.branchId,
        qty: dec(line.qtyPieces).negated().toFixed(4), unitCost,
        type: "ISSUE_TO_VENDOR", refType: "ShiftIssue", refId: issue.id,
        businessDate: shift.businessDate,
        reason: isRefill ? `Refill ${seq} to vendor` : "Morning load-out",
      });
      entries.push({
        itemType: "PRODUCT", itemId: product.id,
        locationType: "EMPLOYEE", locationId: shift.employeeId,
        qty: dec(line.qtyPieces).toFixed(4), unitCost,
        type: "ISSUE_TO_VENDOR", refType: "ShiftIssue", refId: issue.id,
        businessDate: shift.businessDate,
        reason: isRefill ? `Refill ${seq}` : "Morning load-out",
      });
    }

    await postLedger(ctx.db, entries, ctx.user.id);
    await audit(ctx, "CREATE", "ShiftIssue", issue.id, null, issue);
    refresh("/shifts", `/shifts/${shiftId}`);

    const total = wanted.reduce((acc, w) => acc.plus(w.qtyPieces), dec(0));
    return {
      ok: true,
      id: issue.id,
      message: `${isRefill ? `Refill ${seq}` : "Load-out"}: ${total.toFixed(0)} pieces issued.`,
    };
  } catch (error) {
    return toActionError(error);
  }
}

const closingSchema = z.object({
  cashRemitted: z.string().trim(),
  digitalSales: z.string().trim().optional(),
  otherPayments: z.string().trim().optional(),
  discountTotal: z.string().trim().optional(),
  notes: z.string().trim().max(500).optional(),
  vendorAcknowledged: z.string().optional(),
  acknowledgedVia: z.enum(["SIGNATURE", "VERBAL_CONFIRMED", "SMS_SENT", "NONE"]).optional(),
  acknowledgedNote: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().trim().optional(),
});

/**
 * Close a shift from the counted-back stock. One transaction, everything or nothing.
 */
export async function closeShift(shiftId: string, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("shift.close");

    const shift = await ctx.db.cartShift.findUnique({
      where: { id: shiftId },
      include: { issues: { include: { lines: true } } },
    });
    if (!shift) return { ok: false, error: "That shift no longer exists." };
    if (shift.status === "APPROVED") {
      return { ok: false, error: "This shift is approved and locked. Corrections need an adjustment." };
    }
    assertScope(ctx.user, shift.branchId);

    // Retrying the same close from a phone on bad signal must not double-post.
    const parsed = closingSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { ok: false, error: "Please check the figures and try again." };
    const form = parsed.data;

    if (form.idempotencyKey && shift.idempotencyKey === form.idempotencyKey && shift.status !== "OPEN") {
      return { ok: true, id: shift.id, message: "Already closed." };
    }

    const issued = new Map<string, { qty: ReturnType<typeof dec>; price: string; cost: string; pps: string }>();
    for (const issue of shift.issues) {
      for (const line of issue.lines) {
        const current = issued.get(line.productId);
        issued.set(line.productId, {
          qty: (current?.qty ?? dec(0)).plus(line.qtyPieces.toString()),
          price: line.pricePerStick.toString(),
          cost: line.unitCostPerPiece.toString(),
          pps: line.piecesPerStick.toString(),
        });
      }
    }
    if (issued.size === 0) {
      return { ok: false, error: "Nothing was issued to this shift, so there is nothing to count back." };
    }

    const products = await ctx.db.product.findMany({ where: { id: { in: [...issued.keys()] } } });
    const nameOf = new Map(products.map((p) => [p.id, p.name]));

    const lineInputs: ReconciliationLineInput[] = [...issued.entries()].map(([productId, data]) => ({
      productId,
      productName: nameOf.get(productId),
      piecesIssued: data.qty,
      piecesReturned: String(formData.get(`returned-${productId}`) ?? "0") || "0",
      piecesWasted: String(formData.get(`wasted-${productId}`) ?? "0") || "0",
      wasteReason: String(formData.get(`reason-${productId}`) ?? "") || null,
      piecesPerStick: data.pps,
      pricePerStick: data.price,
      unitCostPerPiece: data.cost,
    }));

    const issues = validateClosing(lineInputs);
    if (issues.length > 0) {
      return { ok: false, error: issues.map((i) => i.message).join(" ") };
    }

    const settings = await companySettings(ctx.db as never, ctx.user.companyId);
    const result = reconcileShift(
      {
        cashRemitted: form.cashRemitted || "0",
        digitalSales: form.digitalSales || "0",
        otherPayments: form.otherPayments || "0",
        cashVarianceThreshold: settings.varianceThreshold,
      },
      lineInputs,
    );

    const acknowledged = form.vendorAcknowledged === "on" || form.vendorAcknowledged === "true";

    await ctx.db.$transaction(async (tx) => {
      // Rebuilt from scratch: closing again replaces the previous count rather than
      // adding to it, so a corrected figure is the only figure.
      await tx.shiftLine.deleteMany({ where: { shiftId } });

      for (const line of result.lines) {
        await tx.shiftLine.create({
          data: {
            companyId: ctx.db.$companyId,
            shiftId,
            productId: line.productId,
            piecesIssued: line.piecesIssued.toFixed(4),
            piecesReturned: line.piecesReturned.toFixed(4),
            piecesWasted: line.piecesWasted.toFixed(4),
            wasteReason: lineInputs.find((l) => l.productId === line.productId)?.wasteReason ?? null,
            piecesSold: line.piecesSold.toFixed(4),
            sticksSold: line.sticksSold.toFixed(4),
            piecesPerStick: line.piecesPerStick.toFixed(4),
            pricePerStick: line.pricePerStick.toFixed(4),
            unitCostPerPiece: line.unitCostPerPiece.toFixed(4),
            discountAmount: line.discountAmount.toFixed(4),
            grossSales: line.grossSales.toFixed(4),
            netSales: line.netSales.toFixed(4),
            lineCogs: line.lineCogs.toFixed(4),
            lineWasteCost: line.lineWasteCost.toFixed(4),
          },
        });
      }

      await tx.cartShift.update({
        where: { id: shiftId },
        data: {
          status: result.isDisputed ? "DISPUTED" : "CLOSED",
          closedAt: new Date(),
          closedById: ctx.user.id,
          cashRemitted: form.cashRemitted || "0",
          digitalSales: form.digitalSales || "0",
          otherPayments: form.otherPayments || "0",
          grossSales: result.grossSales.toFixed(4),
          discountTotal: result.discountTotal.toFixed(4),
          netSales: result.netSales.toFixed(4),
          expectedCash: result.expectedCash.toFixed(4),
          cashVariance: result.cashVariance.toFixed(4),
          cogs: result.cogs.toFixed(4),
          wasteCost: result.wasteCost.toFixed(4),
          grossProfit: result.grossProfit.toFixed(4),
          vendorAcknowledged: acknowledged,
          acknowledgedAt: acknowledged ? new Date() : null,
          acknowledgedVia: acknowledged ? form.acknowledgedVia ?? "VERBAL_CONFIRMED" : "NONE",
          acknowledgedNote: form.acknowledgedNote || null,
          notes: form.notes || null,
          idempotencyKey: form.idempotencyKey ?? null,
        },
      });
    });

    // Stock leaves the vendor: sold, returned to the branch, or wasted.
    const entries: LedgerEntry[] = [];
    for (const line of result.lines) {
      const cost = line.unitCostPerPiece.toFixed(4);
      if (line.piecesSold.greaterThan(0)) {
        entries.push({
          itemType: "PRODUCT", itemId: line.productId,
          locationType: "EMPLOYEE", locationId: shift.employeeId,
          qty: line.piecesSold.negated().toFixed(4), unitCost: cost,
          type: "SALE_CONSUMPTION", refType: "CartShift", refId: shiftId,
          businessDate: shift.businessDate, reason: "Sold to customers",
        });
      }
      if (line.piecesReturned.greaterThan(0)) {
        entries.push({
          itemType: "PRODUCT", itemId: line.productId,
          locationType: "EMPLOYEE", locationId: shift.employeeId,
          qty: line.piecesReturned.negated().toFixed(4), unitCost: cost,
          type: "RETURN_FROM_VENDOR", refType: "CartShift", refId: shiftId,
          businessDate: shift.businessDate, reason: "Returned at closing",
        });
        entries.push({
          itemType: "PRODUCT", itemId: line.productId,
          locationType: "BRANCH", locationId: shift.branchId,
          qty: line.piecesReturned.toFixed(4), unitCost: cost,
          type: "RETURN_FROM_VENDOR", refType: "CartShift", refId: shiftId,
          businessDate: shift.businessDate, reason: "Returned at closing",
        });
      }
      if (line.piecesWasted.greaterThan(0)) {
        entries.push({
          itemType: "PRODUCT", itemId: line.productId,
          locationType: "EMPLOYEE", locationId: shift.employeeId,
          qty: line.piecesWasted.negated().toFixed(4), unitCost: cost,
          type: "WASTE", refType: "CartShift", refId: shiftId,
          businessDate: shift.businessDate,
          reason: lineInputs.find((l) => l.productId === line.productId)?.wasteReason ?? "Wasted on the cart",
        });
      }
    }

    /**
     * Re-closing must not double-count. Deleting the previous rows would be wrong twice
     * over: the ledger is append-only (spec §3 rule 3), and a raw delete bypasses the
     * balance cache, leaving stock overstated by whatever the first count said. So the
     * earlier postings are REVERSED with opposite entries, and the new count is posted
     * on top. The history then shows both counts and the correction between them.
     */
    const previous = await ctx.db.inventoryTransaction.findMany({
      where: { refType: "CartShift", refId: shiftId, type: { not: "ADJUSTMENT" } },
    });
    const reversals: LedgerEntry[] = previous.map((row) => ({
      itemType: row.itemType,
      itemId: row.itemId,
      locationType: row.locationType,
      locationId: row.locationId,
      qty: dec(row.qty).negated().toFixed(4),
      unitCost: row.unitCost.toFixed(4),
      type: "ADJUSTMENT",
      refType: "CartShift",
      refId: shiftId,
      businessDate: shift.businessDate,
      reason: `Reversing the previous count (${row.type.toLowerCase().replace(/_/g, " ")})`,
    }));

    await postLedger(ctx.db, [...reversals, ...entries], ctx.user.id);

    // Pay falls out of the same count — nobody keys it in separately (spec §8).
    const pay = await computeShiftCompensation(ctx.db, shiftId);

    await audit(ctx, "UPDATE", "CartShift", shiftId, shift, { status: result.isDisputed ? "DISPUTED" : "CLOSED" });

    refresh("/shifts", `/shifts/${shiftId}`, "/inventory", "/dashboard");

    const variance = result.cashVariance;
    return {
      ok: true,
      id: shiftId,
      message: result.isDisputed
        ? `Closed and flagged DISPUTED: cash is ₱${variance.abs().toFixed(2)} ${variance.isNegative() ? "short" : "over"}. Payroll is blocked until it is resolved.`
        : `Closed. ${result.piecesSold.toFixed(0)} pieces sold, ₱${result.netSales.toFixed(2)} net${
            variance.isZero() ? ", cash exact" : `, cash ₱${variance.abs().toFixed(2)} ${variance.isNegative() ? "short" : "over"}`
          }.${pay ? ` Vendor pay ₱${pay.netPay}${pay.shortageSuppressed ? " — shortage not deducted without acknowledgment" : ""}.` : ""}`,
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** Approve — never by the person who closed it (spec §7). Approval locks the shift. */
export async function approveShift(shiftId: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("shift.approve");
    const shift = await ctx.db.cartShift.findUnique({ where: { id: shiftId } });
    if (!shift) return { ok: false, error: "That shift no longer exists." };

    if (shift.status === "APPROVED") return { ok: true, message: "Already approved." };
    if (shift.status === "OPEN") return { ok: false, error: "Close the shift before approving it." };
    if (shift.status === "DISPUTED") {
      return { ok: false, error: "This shift is disputed. Resolve the cash variance before approving." };
    }

    assertCanApproveShift(ctx.user, { closedById: shift.closedById, status: shift.status });

    if (!shift.vendorAcknowledged && shift.cashVariance.isNegative()) {
      return {
        ok: false,
        error: "The vendor has not acknowledged this count, and it carries a shortage. Get the acknowledgment before approving, or no deduction can be applied.",
      };
    }

    const after = await ctx.db.cartShift.update({
      where: { id: shiftId },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: ctx.user.id },
    });
    await audit(ctx, "UPDATE", "CartShift", shiftId, shift, after);
    refresh("/shifts", `/shifts/${shiftId}`, "/dashboard");
    return { ok: true, message: "Approved and locked." };
  } catch (error) {
    return toActionError(error);
  }
}

/** Suggested load-out: what this cart actually issued on its last few working days. */
export async function suggestedQuantities(cartId: string): Promise<Record<string, string>> {
  const ctx = await withPermission("shift.open");
  const recent = await ctx.db.cartShift.findMany({
    where: { cartId, status: { in: ["CLOSED", "APPROVED"] } },
    include: { issues: { include: { lines: true } } },
    orderBy: { businessDate: "desc" },
    take: 7,
  });

  const totals = new Map<string, ReturnType<typeof dec>>();
  for (const shift of recent) {
    for (const issue of shift.issues) {
      for (const line of issue.lines) {
        totals.set(line.productId, (totals.get(line.productId) ?? dec(0)).plus(line.qtyPieces.toString()));
      }
    }
  }

  const days = Math.max(recent.length, 1);
  return Object.fromEntries(
    [...totals.entries()].map(([productId, total]) => [
      productId,
      total.dividedBy(days).toDecimalPlaces(0).toFixed(0),
    ]),
  );
}

/**
 * Cancel a shift that was opened by mistake.
 *
 * Only possible while nothing has been issued — once stock has moved to a vendor the
 * shift must be closed and counted, not made to disappear. Nothing has touched the
 * ledger at this point, so removing the row leaves no hole; the audit entry records
 * that it happened.
 */
export async function cancelShift(shiftId: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("shift.open");
    const shift = await ctx.db.cartShift.findUnique({
      where: { id: shiftId },
      include: { issues: true },
    });
    if (!shift) return { ok: false, error: "That shift no longer exists." };
    assertScope(ctx.user, shift.branchId);

    if (shift.status !== "OPEN") {
      return { ok: false, error: "Only an open shift can be cancelled. This one is already closed." };
    }
    if (shift.issues.length > 0) {
      return {
        ok: false,
        error: "Stock has already been issued on this shift, so it has to be counted back and closed rather than cancelled.",
      };
    }

    await audit(ctx, "DELETE", "CartShift", shiftId, shift, null);
    await ctx.db.cartShift.delete({ where: { id: shiftId } });

    refresh("/shifts", "/dashboard");
    return { ok: true, message: "Shift cancelled — the cart is back to not opened." };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Close a shift on which nothing was issued: the cart never traded today.
 *
 * Kept separate from cancelling because the two mean different things — a cancelled
 * shift never happened, while a zero close is a recorded day with no sales, which is
 * what you want when a vendor turned up and the cart broke down.
 */
export async function closeEmptyShift(shiftId: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("shift.close");
    const shift = await ctx.db.cartShift.findUnique({
      where: { id: shiftId },
      include: { issues: true },
    });
    if (!shift) return { ok: false, error: "That shift no longer exists." };
    assertScope(ctx.user, shift.branchId);

    if (shift.status !== "OPEN") return { ok: false, error: "This shift is already closed." };
    if (shift.issues.length > 0) {
      return { ok: false, error: "Stock was issued on this shift — use the closing count instead." };
    }
    if (!reason.trim()) return { ok: false, error: "Say why the cart did not trade." };

    const after = await ctx.db.cartShift.update({
      where: { id: shiftId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedById: ctx.user.id,
        notes: reason.trim(),
      },
    });

    // No stock moved and nothing was sold, so there is nothing to post to the ledger.
    await computeShiftCompensation(ctx.db, shiftId);
    await audit(ctx, "UPDATE", "CartShift", shiftId, shift, after);
    refresh("/shifts", `/shifts/${shiftId}`, "/dashboard");
    return { ok: true, message: "Closed with no trade recorded." };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Issue supplies — sauce, cups, bags, sticks, oil — to a cart.
 *
 * These are ingredients, not products: their cost is already inside each product's
 * per-stick cost (spec §5.3), so issuing them moves stock for traceability WITHOUT
 * charging the shift a second time. They are therefore posted branch → cart rather
 * than to the vendor, and the closing count never touches them.
 */
export async function issueSupplies(
  shiftId: string,
  items: { ingredientId: string; qty: string }[],
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("shift.open");
    const wanted = items.filter((i) => dec(i.qty || "0").greaterThan(0));
    if (wanted.length === 0) return { ok: false, error: "Nothing to issue — every quantity is zero." };

    const shift = await ctx.db.cartShift.findUnique({ where: { id: shiftId } });
    if (!shift) return { ok: false, error: "That shift no longer exists." };
    if (shift.status === "APPROVED") return { ok: false, error: "This shift is approved and locked." };
    assertScope(ctx.user, shift.branchId);

    const ingredients = await ctx.db.ingredient.findMany({
      where: { id: { in: wanted.map((w) => w.ingredientId) } },
    });

    const entries: LedgerEntry[] = [];
    for (const item of wanted) {
      const ingredient = ingredients.find((i) => i.id === item.ingredientId);
      if (!ingredient) continue;
      const unitCost = ingredient.currentCostPerBaseUnit.toFixed(4);

      // A line per supply per shift, so the day's load-out reads as one list and the
      // supervisor can count the leftovers back at closing.
      const existing = await ctx.db.shiftSupply.findFirst({
        where: { shiftId, ingredientId: ingredient.id },
      });
      if (existing) {
        await ctx.db.shiftSupply.update({
          where: { id: existing.id },
          data: { qtyIssued: dec(existing.qtyIssued).plus(item.qty).toFixed(4), unitCost },
        });
      } else {
        await ctx.db.shiftSupply.create({
          data: {
            companyId: ctx.db.$companyId,
            shiftId,
            ingredientId: ingredient.id,
            qtyIssued: dec(item.qty).toFixed(4),
            unitCost,
            createdById: ctx.user.id,
          },
        });
      }

      entries.push({
        itemType: "INGREDIENT", itemId: ingredient.id,
        locationType: "BRANCH", locationId: shift.branchId,
        qty: dec(item.qty).negated().toFixed(4), unitCost,
        type: "TRANSFER_OUT", refType: "CartShift", refId: shiftId,
        businessDate: shift.businessDate, reason: "Cart supplies issued",
      });
      entries.push({
        itemType: "INGREDIENT", itemId: ingredient.id,
        locationType: "CART", locationId: shift.cartId,
        qty: dec(item.qty).toFixed(4), unitCost,
        type: "TRANSFER_IN", refType: "CartShift", refId: shiftId,
        businessDate: shift.businessDate, reason: "Cart supplies issued",
      });
    }

    await postLedger(ctx.db, entries, ctx.user.id);
    await audit(ctx, "CREATE", "CartSupplies", shiftId, null, { items: wanted });
    refresh("/shifts", `/shifts/${shiftId}`, "/inventory");

    return {
      ok: true,
      message: `${wanted.length} suppl${wanted.length === 1 ? "y" : "ies"} issued to the cart. Their cost is already inside each product, so nothing is charged twice.`,
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Count supplies back at closing. What did not come back was consumed, which is how a
 * cart getting through twice the cups of its neighbour becomes visible.
 *
 * Consumption is posted out of the cart so its balance does not grow for ever, but it
 * is NEVER added to the shift's COGS — that cost is already inside the products sold.
 */
export async function countSuppliesBack(
  shiftId: string,
  counts: { ingredientId: string; qtyReturned: string }[],
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("shift.close");
    const shift = await ctx.db.cartShift.findUnique({
      where: { id: shiftId },
      include: { supplies: true },
    });
    if (!shift) return { ok: false, error: "That shift no longer exists." };
    if (shift.status === "APPROVED") return { ok: false, error: "This shift is approved and locked." };
    assertScope(ctx.user, shift.branchId);

    const entries: LedgerEntry[] = [];
    let consumedLines = 0;

    for (const count of counts) {
      const supply = shift.supplies.find((s) => s.ingredientId === count.ingredientId);
      if (!supply) continue;

      const returned = dec(count.qtyReturned || "0");
      if (returned.isNegative()) return { ok: false, error: "Returned quantities cannot be negative." };
      if (returned.greaterThan(supply.qtyIssued)) {
        return { ok: false, error: "More came back than went out. Recount, or post an adjustment." };
      }
      const consumed = dec(supply.qtyIssued).minus(returned);

      await ctx.db.shiftSupply.update({
        where: { id: supply.id },
        data: { qtyReturned: returned.toFixed(4), qtyConsumed: consumed.toFixed(4) },
      });

      if (returned.greaterThan(0)) {
        entries.push({
          itemType: "INGREDIENT", itemId: supply.ingredientId,
          locationType: "CART", locationId: shift.cartId,
          qty: returned.negated().toFixed(4), unitCost: supply.unitCost.toFixed(4),
          type: "TRANSFER_OUT", refType: "CartShift", refId: shiftId,
          businessDate: shift.businessDate, reason: "Supplies returned to branch",
        });
        entries.push({
          itemType: "INGREDIENT", itemId: supply.ingredientId,
          locationType: "BRANCH", locationId: shift.branchId,
          qty: returned.toFixed(4), unitCost: supply.unitCost.toFixed(4),
          type: "TRANSFER_IN", refType: "CartShift", refId: shiftId,
          businessDate: shift.businessDate, reason: "Supplies returned to branch",
        });
      }

      if (consumed.greaterThan(0)) {
        consumedLines += 1;
        entries.push({
          itemType: "INGREDIENT", itemId: supply.ingredientId,
          locationType: "CART", locationId: shift.cartId,
          qty: consumed.negated().toFixed(4), unitCost: supply.unitCost.toFixed(4),
          type: "SALE_CONSUMPTION", refType: "CartShift", refId: shiftId,
          businessDate: shift.businessDate,
          reason: "Used on the cart — already costed inside the products sold",
        });
      }
    }

    await postLedger(ctx.db, entries, ctx.user.id);
    await audit(ctx, "UPDATE", "ShiftSupplies", shiftId, null, { counts });
    refresh(`/shifts/${shiftId}`, "/inventory");
    return {
      ok: true,
      message: `Supplies counted back — ${consumedLines} item${consumedLines === 1 ? "" : "s"} consumed on the cart.`,
    };
  } catch (error) {
    return toActionError(error);
  }
}
