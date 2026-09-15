"use server";

import { z } from "zod";
import { businessDateFor, toDateColumn } from "@/lib/businessDate";
import { dec } from "@/lib/money";
import { costPerPiece } from "@/lib/engines/costing";
import { nextReference, onHand, postLedger, rebuildBalances, type LedgerEntry } from "@/lib/inventory-service";
import { decimalString } from "@/lib/validation/masterdata";
import { assertScope } from "@/lib/rbac";
import { audit, parseForm, refresh, toActionError, withPermission, type ActionResult } from "./helpers";

const today = () => toDateColumn(businessDateFor());

const locationSchema = z.object({
  locationType: z.enum(["WAREHOUSE", "BRANCH", "CART", "EMPLOYEE"]),
  locationId: z.string().min(1, "Choose a location"),
});

/**
 * Production: the commissary consumes ingredients and produces countable pieces.
 * Ingredient consumption and finished-goods receipt post together, so a batch can never
 * create stock out of nothing.
 */
const productionSchema = z.object({
  branchId: z.string().min(1, "Choose a commissary"),
  productId: z.string().min(1, "Choose a product"),
  actualQty: decimalString("Pieces produced", { min: 0, allowZero: false }),
  wasteQty: decimalString("Pieces wasted"),
  notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

export async function runProductionBatch(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("inventory.write");
    const parsed = parseForm(productionSchema, formData);
    if (!parsed.ok) return parsed.result;
    const { branchId, productId, actualQty, wasteQty, notes } = parsed.data;
    assertScope(ctx.user, branchId);

    const recipe = await ctx.db.recipe.findFirst({
      where: { productId, isActive: true },
      include: { lines: { include: { ingredient: true } } },
      orderBy: { version: "desc" },
    });
    if (!recipe || recipe.lines.length === 0) {
      return { ok: false, error: "That product has no recipe, so a batch cannot be costed. Add one under Costing first." };
    }

    const produced = dec(actualQty);
    const wasted = dec(wasteQty);
    const totalPieces = produced.plus(wasted);
    const batches = totalPieces.dividedBy(recipe.batchYieldPieces);

    // Unit cost of what was produced: everything consumed, spread over what survived.
    const perPiece = costPerPiece({
      batchYieldPieces: recipe.batchYieldPieces.toString(),
      lines: recipe.lines
        .filter((line) => line.allocationBasis !== "PER_STICK")
        .map((line) => ({
          ingredientId: line.ingredientId,
          ingredientName: line.ingredient.name,
          qtyInBaseUnit: line.qtyInBaseUnit.toString(),
          wastagePct: line.wastagePct.toString(),
          allocationBasis: line.allocationBasis,
          componentType: line.componentType,
          costPerBaseUnit: line.ingredient.currentCostPerBaseUnit.toString(),
        })),
    });

    const reference = await nextReference(ctx.db, "BATCH");
    const businessDate = today();

    const batch = await ctx.db.productionBatch.create({
      data: {
        companyId: ctx.db.$companyId,
        reference,
        branchId,
        productId,
        recipeVersion: recipe.version,
        plannedQty: totalPieces.toFixed(4),
        actualQty: produced.toFixed(4),
        wasteQty: wasted.toFixed(4),
        unitCost: perPiece.toFixed(4),
        status: "COMPLETED",
        businessDate,
        producedAt: new Date(),
        notes: notes ?? null,
        createdById: ctx.user.id,
      },
    });

    const entries: LedgerEntry[] = [];

    // Ingredients leave the commissary.
    for (const line of recipe.lines) {
      if (line.allocationBasis === "PER_STICK") continue; // charged at the point of sale
      const qtyPerBatch = dec(line.qtyInBaseUnit).times(dec(1).plus(line.wastagePct));
      const consumed =
        line.allocationBasis === "PER_BATCH"
          ? qtyPerBatch.times(batches)
          : qtyPerBatch.times(totalPieces);

      entries.push({
        itemType: "INGREDIENT",
        itemId: line.ingredientId,
        locationType: "BRANCH",
        locationId: branchId,
        qty: consumed.negated().toFixed(4),
        unitCost: line.ingredient.currentCostPerBaseUnit.toFixed(4),
        type: "PRODUCTION_CONSUME",
        refType: "ProductionBatch",
        refId: batch.id,
        businessDate,
        reason: `${reference} — ${recipe.lines.length} ingredients`,
      });
    }

    // Finished pieces arrive.
    entries.push({
      itemType: "PRODUCT",
      itemId: productId,
      locationType: "BRANCH",
      locationId: branchId,
      qty: produced.toFixed(4),
      unitCost: perPiece.toFixed(4),
      type: "PRODUCTION_IN",
      refType: "ProductionBatch",
      refId: batch.id,
      businessDate,
      reason: reference,
    });

    if (wasted.greaterThan(0)) {
      entries.push({
        itemType: "PRODUCT",
        itemId: productId,
        locationType: "BRANCH",
        locationId: branchId,
        qty: wasted.negated().toFixed(4),
        unitCost: perPiece.toFixed(4),
        type: "WASTE",
        refType: "ProductionBatch",
        refId: batch.id,
        businessDate,
        reason: `${reference} — spoiled in production`,
      });
      entries.push({
        itemType: "PRODUCT",
        itemId: productId,
        locationType: "BRANCH",
        locationId: branchId,
        qty: wasted.toFixed(4),
        unitCost: perPiece.toFixed(4),
        type: "PRODUCTION_IN",
        refType: "ProductionBatch",
        refId: batch.id,
        businessDate,
        reason: `${reference} — produced then wasted`,
      });
    }

    await postLedger(ctx.db, entries, ctx.user.id);
    await audit(ctx, "CREATE", "ProductionBatch", batch.id, null, batch);
    refresh("/inventory", "/inventory/production");
    return {
      ok: true,
      id: batch.id,
      message: `${reference}: ${produced.toFixed(0)} pieces at ₱${perPiece.toFixed(4)} each.`,
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** Create a transfer in DRAFT. Stock does not move until it is dispatched. */
const transferSchema = z.object({
  fromLocationType: z.enum(["WAREHOUSE", "BRANCH", "CART", "EMPLOYEE"]),
  fromLocationId: z.string().min(1, "Choose a source"),
  toLocationType: z.enum(["WAREHOUSE", "BRANCH", "CART", "EMPLOYEE"]),
  toLocationId: z.string().min(1, "Choose a destination"),
  notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

export async function createTransfer(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("inventory.write");
    const parsed = parseForm(transferSchema, formData);
    if (!parsed.ok) return parsed.result;
    const data = parsed.data;

    if (data.fromLocationType === data.toLocationType && data.fromLocationId === data.toLocationId) {
      return { ok: false, error: "Source and destination are the same place." };
    }

    const reference = await nextReference(ctx.db, "TRF");
    const transfer = await ctx.db.stockTransfer.create({
      data: {
        companyId: ctx.db.$companyId,
        reference,
        ...data,
        notes: data.notes ?? null,
        businessDate: today(),
        createdById: ctx.user.id,
      },
    });
    await audit(ctx, "CREATE", "StockTransfer", transfer.id, null, transfer);
    refresh("/inventory/transfers");
    return { ok: true, id: transfer.id, message: `${reference} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

const transferLineSchema = z.object({
  itemType: z.enum(["INGREDIENT", "PRODUCT"]),
  itemId: z.string().min(1, "Choose an item"),
  qtySent: decimalString("Quantity", { min: 0, allowZero: false }),
});

export async function addTransferLine(transferId: string, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("inventory.write");
    const parsed = parseForm(transferLineSchema, formData);
    if (!parsed.ok) return parsed.result;

    const transfer = await ctx.db.stockTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) return { ok: false, error: "That transfer no longer exists." };
    if (transfer.status !== "DRAFT") {
      return { ok: false, error: "Only a draft transfer can be changed. Create a new one instead." };
    }

    const balance = await onHand(
      ctx.db, parsed.data.itemType, parsed.data.itemId,
      transfer.fromLocationType, transfer.fromLocationId,
    );

    if (dec(parsed.data.qtySent).greaterThan(balance.qty)) {
      return {
        ok: false,
        error: `Only ${dec(balance.qty).toFixed(0)} on hand at the source. Reduce the quantity or receive stock there first.`,
      };
    }

    const line = await ctx.db.stockTransferLine.upsert({
      where: {
        transferId_itemType_itemId: {
          transferId,
          itemType: parsed.data.itemType,
          itemId: parsed.data.itemId,
        },
      },
      update: { qtySent: parsed.data.qtySent, unitCost: balance.avgUnitCost },
      create: {
        companyId: ctx.db.$companyId,
        transferId,
        itemType: parsed.data.itemType,
        itemId: parsed.data.itemId,
        qtySent: parsed.data.qtySent,
        unitCost: balance.avgUnitCost,
      },
    });
    await audit(ctx, "UPDATE", "StockTransferLine", line.id, null, line);
    refresh("/inventory/transfers", `/inventory/transfers/${transferId}`);
    return { ok: true, message: "Line saved." };
  } catch (error) {
    return toActionError(error);
  }
}

/** Dispatch: stock leaves the source now and is in transit until received. */
export async function dispatchTransfer(transferId: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("inventory.write");
    const transfer = await ctx.db.stockTransfer.findUnique({
      where: { id: transferId },
      include: { lines: true },
    });
    if (!transfer) return { ok: false, error: "That transfer no longer exists." };
    if (transfer.status !== "DRAFT") return { ok: false, error: `Already ${transfer.status.toLowerCase()}.` };
    if (transfer.lines.length === 0) return { ok: false, error: "Add at least one line before dispatching." };

    const entries: LedgerEntry[] = transfer.lines.map((line) => ({
      itemType: line.itemType,
      itemId: line.itemId,
      locationType: transfer.fromLocationType,
      locationId: transfer.fromLocationId,
      qty: dec(line.qtySent).negated().toFixed(4),
      unitCost: line.unitCost.toFixed(4),
      type: "TRANSFER_OUT",
      refType: "StockTransfer",
      refId: transfer.id,
      businessDate: transfer.businessDate,
      reason: transfer.reference,
    }));

    await postLedger(ctx.db, entries, ctx.user.id);
    const after = await ctx.db.stockTransfer.update({
      where: { id: transferId },
      data: { status: "IN_TRANSIT", dispatchedAt: new Date(), dispatchedById: ctx.user.id },
    });
    await audit(ctx, "UPDATE", "StockTransfer", transferId, transfer, after);
    refresh("/inventory", "/inventory/transfers", `/inventory/transfers/${transferId}`);
    return { ok: true, message: `${transfer.reference} dispatched — ${transfer.lines.length} lines in transit.` };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Receive: the paired TRANSFER_IN rows land at the destination. A shortfall against
 * what was sent posts as an ADJUSTMENT so the difference is visible, not absorbed.
 */
export async function receiveTransfer(transferId: string, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("inventory.write");
    const transfer = await ctx.db.stockTransfer.findUnique({
      where: { id: transferId },
      include: { lines: true },
    });
    if (!transfer) return { ok: false, error: "That transfer no longer exists." };
    if (transfer.status !== "IN_TRANSIT") {
      return { ok: false, error: "Only a transfer in transit can be received." };
    }

    const entries: LedgerEntry[] = [];
    let shortfalls = 0;

    for (const line of transfer.lines) {
      const raw = formData.get(`received-${line.id}`);
      const received = raw === null || raw === "" ? dec(line.qtySent) : dec(String(raw));
      if (received.isNegative()) return { ok: false, error: "Received quantities cannot be negative." };
      if (received.greaterThan(line.qtySent)) {
        return { ok: false, error: "You cannot receive more than was sent. Post an adjustment instead." };
      }

      await ctx.db.stockTransferLine.update({
        where: { id: line.id },
        data: { qtyReceived: received.toFixed(4) },
      });

      entries.push({
        itemType: line.itemType,
        itemId: line.itemId,
        locationType: transfer.toLocationType,
        locationId: transfer.toLocationId,
        qty: received.toFixed(4),
        unitCost: line.unitCost.toFixed(4),
        type: "TRANSFER_IN",
        refType: "StockTransfer",
        refId: transfer.id,
        businessDate: transfer.businessDate,
        reason: transfer.reference,
      });

      // Nothing evaporates: what left the source but never arrived is written off here.
      const missing = dec(line.qtySent).minus(received);
      if (missing.greaterThan(0)) {
        shortfalls += 1;
        entries.push({
          itemType: line.itemType,
          itemId: line.itemId,
          locationType: transfer.toLocationType,
          locationId: transfer.toLocationId,
          qty: missing.toFixed(4),
          unitCost: line.unitCost.toFixed(4),
          type: "TRANSFER_IN",
          refType: "StockTransfer",
          refId: transfer.id,
          businessDate: transfer.businessDate,
          reason: `${transfer.reference} — short on arrival`,
        });
        entries.push({
          itemType: line.itemType,
          itemId: line.itemId,
          locationType: transfer.toLocationType,
          locationId: transfer.toLocationId,
          qty: missing.negated().toFixed(4),
          unitCost: line.unitCost.toFixed(4),
          type: "ADJUSTMENT",
          refType: "StockTransfer",
          refId: transfer.id,
          businessDate: transfer.businessDate,
          reason: `${transfer.reference} — ${missing.toFixed(0)} missing in transit`,
        });
      }
    }

    await postLedger(ctx.db, entries, ctx.user.id);
    const after = await ctx.db.stockTransfer.update({
      where: { id: transferId },
      data: { status: "RECEIVED", receivedAt: new Date(), receivedById: ctx.user.id },
    });
    await audit(ctx, "UPDATE", "StockTransfer", transferId, transfer, after);
    refresh("/inventory", "/inventory/transfers", `/inventory/transfers/${transferId}`);
    return {
      ok: true,
      message: shortfalls
        ? `${transfer.reference} received with ${shortfalls} shortfall${shortfalls === 1 ? "" : "s"} written off.`
        : `${transfer.reference} received in full.`,
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** Wastage, spoilage, damage and manual corrections — each needs a reason. */
const adjustmentSchema = locationSchema.extend({
  itemType: z.enum(["INGREDIENT", "PRODUCT"]),
  itemId: z.string().min(1, "Choose an item"),
  qty: decimalString("Quantity", { min: 0, allowZero: false }),
  direction: z.enum(["IN", "OUT"]),
  type: z.enum(["WASTE", "SPOILAGE", "DAMAGE", "ADJUSTMENT"]),
  reason: z.string().trim().min(3, "Say what happened — this is the audit trail"),
});

export async function postAdjustment(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("inventory.write");
    const parsed = parseForm(adjustmentSchema, formData);
    if (!parsed.ok) return parsed.result;
    const data = parsed.data;

    const balance = await onHand(ctx.db, data.itemType, data.itemId, data.locationType, data.locationId);
    const qty = data.direction === "OUT" ? dec(data.qty).negated() : dec(data.qty);

    await postLedger(ctx.db, [{
      itemType: data.itemType,
      itemId: data.itemId,
      locationType: data.locationType,
      locationId: data.locationId,
      qty: qty.toFixed(4),
      unitCost: balance.avgUnitCost,
      type: data.type,
      refType: "Manual",
      refId: ctx.user.id,
      businessDate: today(),
      reason: data.reason,
    }], ctx.user.id);

    refresh("/inventory");
    return { ok: true, message: `${data.type.toLowerCase()} of ${dec(data.qty).toFixed(0)} posted.` };
  } catch (error) {
    return toActionError(error);
  }
}

/** Rebuild the cache from the ledger. The ledger is the truth; this fixes the cache. */
export async function rebuildStockBalances(): Promise<ActionResult> {
  try {
    const ctx = await withPermission("inventory.write");
    const { rebuilt, drift } = await rebuildBalances(ctx.db);
    refresh("/inventory");
    return {
      ok: true,
      message: drift
        ? `Rebuilt ${rebuilt} balances. ${drift} disagreed with the ledger and were corrected.`
        : `Rebuilt ${rebuilt} balances. Every one already agreed with the ledger.`,
    };
  } catch (error) {
    return toActionError(error);
  }
}
