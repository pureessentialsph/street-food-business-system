"use server";

import { z } from "zod";
import { businessDateFor, toDateColumn } from "@/lib/businessDate";
import { dec, sum } from "@/lib/money";
import { costPerBaseUnit, newAverageCost } from "@/lib/engines/replenishment";
import { describeChanges, recomputeForIngredient } from "@/lib/costing-service";
import { onHand, postLedger, type LedgerEntry } from "@/lib/inventory-service";
import { generateSuggestions, storeSuggestions } from "@/lib/procurement-service";
import { decimalString } from "@/lib/validation/masterdata";
import { audit, parseForm, refresh, toActionError, withPermission, type ActionResult } from "./helpers";

/** Regenerate the order list. Also runs nightly via /api/cron/replenishment. */
export async function regenerateSuggestions(): Promise<ActionResult> {
  try {
    const ctx = await withPermission("procurement.approve");
    const count = await storeSuggestions(ctx.db);
    refresh("/procurement");
    return {
      ok: true,
      message: count
        ? `${count} item${count === 1 ? "" : "s"} need attention.`
        : "Nothing needs reordering — every item is above its reorder point.",
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function dismissSuggestion(id: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("procurement.approve");
    if (!reason.trim()) return { ok: false, error: "Say why you are dismissing it." };
    const before = await ctx.db.replenishmentSuggestion.findUnique({ where: { id } });
    if (!before) return { ok: false, error: "That suggestion is no longer there." };

    const after = await ctx.db.replenishmentSuggestion.update({
      where: { id },
      data: { status: "DISMISSED", dismissReason: reason.trim() },
    });
    await audit(ctx, "UPDATE", "ReplenishmentSuggestion", id, before, after);
    refresh("/procurement");
    return { ok: true, message: "Dismissed — it will not come back today." };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Turn the suggestions for one supplier into a purchase order.
 *
 * Quantities are always editable before this point; the order records what was actually
 * decided, not what the formula proposed.
 */
export async function createPurchaseOrder(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("procurement.approve");

    const supplierId = String(formData.get("supplierId") ?? "");
    const destinationBranchId = String(formData.get("destinationBranchId") ?? "");
    if (!supplierId || !destinationBranchId) {
      return { ok: false, error: "Choose a supplier and where the delivery goes." };
    }

    const suggestions = await generateSuggestions(ctx.db);
    const chosen = suggestions.filter(
      (s) =>
        s.preferredSupplierId === supplierId &&
        s.locationId === destinationBranchId &&
        dec(String(formData.get(`qty-${s.itemId}`) ?? "0")).greaterThan(0),
    );

    if (chosen.length === 0) {
      return { ok: false, error: "Nothing to order — every quantity is zero." };
    }

    const count = await ctx.db.purchaseOrder.count();
    const reference = `PO-${String(count + 1).padStart(5, "0")}`;
    const expectedDays = chosen[0] ? 2 : 2;

    const expectedAt = new Date();
    expectedAt.setUTCDate(expectedAt.getUTCDate() + expectedDays);
    expectedAt.setUTCHours(0, 0, 0, 0);

    const po = await ctx.db.purchaseOrder.create({
      data: {
        companyId: ctx.db.$companyId,
        reference,
        supplierId,
        destinationBranchId,
        status: "APPROVED",
        expectedAt,
        approvedAt: new Date(),
        approvedById: ctx.user.id,
        createdById: ctx.user.id,
      },
    });

    let total = dec(0);
    for (const item of chosen) {
      const baseQty = dec(String(formData.get(`qty-${item.itemId}`) ?? "0"));
      const perUnit = dec(item.baseUnitsPerPurchaseUnit ?? "1");
      const packs = perUnit.greaterThan(0) ? baseQty.dividedBy(perUnit) : baseQty;
      const price = dec(item.lastPurchasePrice ?? "0");

      await ctx.db.purchaseOrderLine.create({
        data: {
          companyId: ctx.db.$companyId,
          poNo: po.poNo,
          ingredientId: item.itemId,
          qtyPurchaseUnit: packs.toFixed(4),
          purchaseUnitName: item.purchaseUnitName ?? "unit",
          baseUnitsPerPurchaseUnit: perUnit.toFixed(4),
          unitPrice: price.toFixed(4),
        },
      });
      total = total.plus(packs.times(price));

      await ctx.db.replenishmentSuggestion.updateMany({
        where: { itemId: item.itemId, locationId: item.locationId, status: "NEW" },
        data: { status: "ACCEPTED" },
      });
    }

    await ctx.db.purchaseOrder.update({
      where: { poNo: po.poNo },
      data: { totalAmount: total.toFixed(4) },
    });

    await audit(ctx, "CREATE", "PurchaseOrder", po.poNo, null, po);
    refresh("/procurement");
    return {
      ok: true,
      id: po.poNo,
      message: `${reference} raised: ${chosen.length} line${chosen.length === 1 ? "" : "s"}, ₱${total.toFixed(2)}.`,
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function markOrdered(poNo: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("procurement.approve");
    const po = await ctx.db.purchaseOrder.findUnique({ where: { poNo } });
    if (!po) return { ok: false, error: "That order no longer exists." };
    if (po.status !== "APPROVED") return { ok: false, error: `A ${po.status.toLowerCase()} order cannot be placed again.` };

    const after = await ctx.db.purchaseOrder.update({
      where: { poNo },
      data: { status: "ORDERED", orderedAt: new Date() },
    });
    await audit(ctx, "UPDATE", "PurchaseOrder", poNo, po, after);
    refresh("/procurement", `/procurement/${poNo}`);
    return { ok: true, message: `${po.reference} placed with the supplier.` };
  } catch (error) {
    return toActionError(error);
  }
}

const receiveSchema = z.object({ note: z.string().trim().max(300).optional() });

/**
 * Receive a delivery. This is the step that closes the loop (spec §5.7):
 *
 *   stock in → ingredient cost updated (weighted average) → cost history row →
 *   a new cost version for every product whose recipe uses it.
 *
 * So a supplier putting up their price shows up in product margins the same day.
 */
export async function receivePurchaseOrder(poNo: string, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("inventory.write");
    const parsed = parseForm(receiveSchema, formData);
    if (!parsed.ok) return parsed.result;

    const po = await ctx.db.purchaseOrder.findUnique({
      where: { poNo },
      include: { lines: true },
    });
    if (!po) return { ok: false, error: "That order no longer exists." };
    if (po.status === "RECEIVED" || po.status === "CANCELLED") {
      return { ok: false, error: `This order is already ${po.status.toLowerCase()}.` };
    }

    const businessDate = toDateColumn(businessDateFor());
    const entries: LedgerEntry[] = [];
    const costNotes: string[] = [];
    let fullyReceived = true;

    for (const line of po.lines) {
      const orderedBase = dec(line.qtyPurchaseUnit).times(line.baseUnitsPerPurchaseUnit);
      const raw = formData.get(`received-${line.id}`);
      const receivedPacks = raw === null || raw === "" ? dec(line.qtyPurchaseUnit) : dec(String(raw));
      if (receivedPacks.isNegative()) return { ok: false, error: "Received quantities cannot be negative." };

      const priceRaw = formData.get(`price-${line.id}`);
      const unitPrice = priceRaw === null || priceRaw === "" ? dec(line.unitPrice) : dec(String(priceRaw));

      const receivedBase = receivedPacks.times(line.baseUnitsPerPurchaseUnit);
      if (receivedBase.lessThan(orderedBase)) fullyReceived = false;
      if (receivedBase.isZero()) continue;

      const perBaseUnit = costPerBaseUnit(unitPrice, line.baseUnitsPerPurchaseUnit);

      const ingredient = await ctx.db.ingredient.findUnique({ where: { id: line.ingredientId } });
      if (!ingredient) continue;

      const balance = await onHand(ctx.db, "INGREDIENT", line.ingredientId, "BRANCH", po.destinationBranchId);
      const blended = newAverageCost(
        balance.qty, ingredient.currentCostPerBaseUnit.toString(), receivedBase, perBaseUnit,
      );

      entries.push({
        itemType: "INGREDIENT",
        itemId: line.ingredientId,
        locationType: "BRANCH",
        locationId: po.destinationBranchId,
        qty: receivedBase.toFixed(4),
        unitCost: perBaseUnit.toFixed(4),
        type: "PURCHASE_RECEIPT",
        refType: "PurchaseOrder",
        refId: po.poNo,
        businessDate,
        reason: `${po.reference} — ${receivedPacks.toFixed(2)} × ${line.purchaseUnitName}`,
      });

      await ctx.db.purchaseOrderLine.update({
        where: { id: line.id },
        data: {
          qtyReceivedBase: dec(line.qtyReceivedBase).plus(receivedBase).toFixed(4),
          unitPrice: unitPrice.toFixed(4),
        },
      });

      // The price the supplier actually charged becomes the cost of what is on hand.
      if (!ingredient.currentCostPerBaseUnit.equals(blended.toFixed(4))) {
        await ctx.db.ingredient.update({
          where: { id: line.ingredientId },
          data: { currentCostPerBaseUnit: blended.toFixed(4) },
        });
        await ctx.db.ingredientCostHistory.create({
          data: {
            companyId: ctx.db.$companyId,
            ingredientId: line.ingredientId,
            costPerBaseUnit: blended.toFixed(4),
            effectiveFrom: new Date(),
            source: "PURCHASE_RECEIPT",
            refId: po.poNo,
          },
        });

        const changes = await recomputeForIngredient(
          ctx.db, line.ingredientId, ctx.user.id, `${po.reference} received`,
        );
        if (changes.length > 0) costNotes.push(describeChanges(changes));
      }

      // Remember what this supplier charges, for the next order.
      const link = await ctx.db.supplierIngredient.findFirst({
        where: { supplierId: po.supplierId, ingredientId: line.ingredientId },
      });
      if (link) {
        await ctx.db.supplierIngredient.update({
          where: { id: link.id },
          data: { lastPurchasePrice: unitPrice.toFixed(4) },
        });
      }
    }

    if (entries.length === 0) {
      return { ok: false, error: "Nothing was received — every quantity is zero." };
    }

    await postLedger(ctx.db, entries, ctx.user.id);

    const after = await ctx.db.purchaseOrder.update({
      where: { poNo },
      data: {
        status: fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED",
        receivedAt: new Date(),
        notes: parsed.data.note || po.notes,
      },
    });
    await audit(ctx, "UPDATE", "PurchaseOrder", poNo, po, after);
    refresh("/procurement", `/procurement/${poNo}`, "/inventory", "/costing");

    return {
      ok: true,
      message: `${po.reference} ${fullyReceived ? "received in full" : "partially received"}. ${
        costNotes.length ? costNotes.join(" ") : "Ingredient costs unchanged."
      }`,
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function cancelPurchaseOrder(poNo: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("procurement.approve");
    const po = await ctx.db.purchaseOrder.findUnique({ where: { poNo } });
    if (!po) return { ok: false, error: "That order no longer exists." };
    if (po.status === "RECEIVED" || po.status === "PARTIALLY_RECEIVED") {
      return { ok: false, error: "Stock has already been received against this order." };
    }
    const after = await ctx.db.purchaseOrder.update({ where: { poNo }, data: { status: "CANCELLED" } });
    await audit(ctx, "UPDATE", "PurchaseOrder", poNo, po, after);
    refresh("/procurement");
    return { ok: true, message: `${po.reference} cancelled.` };
  } catch (error) {
    return toActionError(error);
  }
}

/** Add a line by hand — not everything comes from a suggestion. */
const manualLineSchema = z.object({
  ingredientId: z.string().min(1, "Choose an ingredient"),
  qtyPurchaseUnit: decimalString("Quantity", { min: 0, allowZero: false }),
  purchaseUnitName: z.string().trim().min(1, "Name the unit, e.g. sack 25kg"),
  baseUnitsPerPurchaseUnit: decimalString("Base units per unit", { min: 0, allowZero: false }),
  unitPrice: decimalString("Price per unit"),
});

export async function addPoLine(poNo: string, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("procurement.approve");
    const parsed = parseForm(manualLineSchema, formData);
    if (!parsed.ok) return parsed.result;

    const po = await ctx.db.purchaseOrder.findUnique({ where: { poNo } });
    if (!po) return { ok: false, error: "That order no longer exists." };
    if (po.status !== "APPROVED" && po.status !== "SUGGESTED") {
      return { ok: false, error: "This order has already been placed. Raise a new one." };
    }

    await ctx.db.purchaseOrderLine.upsert({
      where: { poNo_ingredientId: { poNo, ingredientId: parsed.data.ingredientId } },
      update: parsed.data,
      create: { ...parsed.data, poNo, companyId: ctx.db.$companyId },
    });

    const lines = await ctx.db.purchaseOrderLine.findMany({ where: { poNo } });
    await ctx.db.purchaseOrder.update({
      where: { poNo },
      data: {
        totalAmount: sum(lines.map((l) => dec(l.qtyPurchaseUnit).times(l.unitPrice))).toFixed(4),
      },
    });

    refresh("/procurement", `/procurement/${poNo}`);
    return { ok: true, message: "Line added." };
  } catch (error) {
    return toActionError(error);
  }
}
