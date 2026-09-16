import type { ScopedDb } from "@/lib/db";
import { businessDateFor, toDateColumn, trailingBusinessDates } from "@/lib/businessDate";
import { dec, sum, ZERO } from "@/lib/money";
import { replenish, type ReplenishmentResult } from "@/lib/engines/replenishment";

/**
 * Turns closed shifts and the stock ledger into an order list (spec §9).
 *
 * Product usage comes from what carts actually sold; ingredient usage comes from what
 * the commissary consumed producing it. Both are read from the ledger rather than
 * guessed, and both are always overridable.
 */

const WINDOW_DAYS = 14;

export type Suggestion = ReplenishmentResult & {
  itemType: "PRODUCT" | "INGREDIENT";
  itemId: string;
  locationType: "BRANCH";
  locationId: string;
  locationName: string;
  packSize: string;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  purchaseUnitName: string | null;
  baseUnitsPerPurchaseUnit: string | null;
  lastPurchasePrice: string | null;
};

export async function generateSuggestions(db: ScopedDb): Promise<Suggestion[]> {
  const company = await db.company.findFirst({ where: { id: db.$companyId } });
  const todayDate = businessDateFor(new Date(), company?.businessDayCutoffHour ?? 4, company?.timezone ?? "Asia/Manila");
  const window = trailingBusinessDates(todayDate, WINDOW_DAYS);
  const from = toDateColumn(window[0]!);
  const to = toDateColumn(todayDate);
  const coverDays = Number((company?.settings as { coverDays?: number } | null)?.coverDays ?? 7);

  const [branches, ingredients, balances, consumption, onOrderLines] = await Promise.all([
    db.branch.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, type: true } }),
    db.ingredient.findMany({
      where: { isActive: true },
      include: {
        suppliers: {
          where: { isPreferred: true },
          include: { supplier: { select: { id: true, name: true, leadTimeDays: true } } },
        },
      },
    }),
    db.stockBalance.findMany({ where: { locationType: "BRANCH" } }),
    // What the commissary actually consumed, straight from the ledger.
    db.inventoryTransaction.findMany({
      where: {
        itemType: "INGREDIENT",
        locationType: "BRANCH",
        businessDate: { gte: from, lte: to },
        type: { in: ["PRODUCTION_CONSUME", "SALE_CONSUMPTION", "WASTE", "SPOILAGE", "DAMAGE"] },
      },
      select: { itemId: true, locationId: true, qty: true, businessDate: true },
    }),
    db.purchaseOrderLine.findMany({
      where: { po: { status: { in: ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] } } },
      include: { po: { select: { destinationBranchId: true, status: true } } },
    }),
  ]);

  const branchName = new Map(branches.map((b) => [b.id, `${b.code} · ${b.name}`]));

  // Consumption and trading days per ingredient per branch.
  const used = new Map<string, { qty: ReturnType<typeof dec>; days: Set<string> }>();
  for (const row of consumption) {
    const key = `${row.itemId}|${row.locationId}`;
    const current = used.get(key) ?? { qty: ZERO, days: new Set<string>() };
    current.qty = current.qty.plus(dec(row.qty).abs());
    current.days.add(row.businessDate.toISOString());
    used.set(key, current);
  }

  const onOrder = new Map<string, ReturnType<typeof dec>>();
  for (const line of onOrderLines) {
    const outstanding = dec(line.qtyPurchaseUnit)
      .times(line.baseUnitsPerPurchaseUnit)
      .minus(line.qtyReceivedBase);
    if (outstanding.lessThanOrEqualTo(0)) continue;
    const key = `${line.ingredientId}|${line.po.destinationBranchId}`;
    onOrder.set(key, (onOrder.get(key) ?? ZERO).plus(outstanding));
  }

  const suggestions: Suggestion[] = [];

  for (const branch of branches) {
    for (const ingredient of ingredients) {
      const key = `${ingredient.id}|${branch.id}`;
      const usage = used.get(key);
      if (!usage || usage.qty.isZero()) continue;

      const balance = balances.find(
        (b) => b.itemId === ingredient.id && b.locationId === branch.id,
      );
      const preferred = ingredient.suppliers[0];

      const result = replenish({
        itemName: ingredient.name,
        onHand: balance?.qty ?? 0,
        onOrder: onOrder.get(key) ?? 0,
        soldInWindow: usage.qty,
        activeDays: usage.days.size,
        leadTimeDays: preferred?.supplier.leadTimeDays ?? 2,
        safetyStock: ingredient.safetyStock,
        coverDays,
        packSize: ingredient.packSize,
      });

      if (!result.triggered && !result.overstocked) continue;

      suggestions.push({
        ...result,
        itemType: "INGREDIENT",
        itemId: ingredient.id,
        locationType: "BRANCH",
        locationId: branch.id,
        locationName: branchName.get(branch.id) ?? branch.id,
        packSize: ingredient.packSize.toString(),
        preferredSupplierId: preferred?.supplier.id ?? null,
        preferredSupplierName: preferred?.supplier.name ?? null,
        purchaseUnitName: preferred?.purchaseUnitName ?? null,
        baseUnitsPerPurchaseUnit: preferred?.baseUnitsPerPurchaseUnit.toString() ?? null,
        lastPurchasePrice: preferred?.lastPurchasePrice.toString() ?? null,
      });
    }
  }

  return suggestions.sort((a, b) => {
    // Most urgent first: least cover remaining.
    const aCover = a.daysOfCover?.toNumber() ?? Number.POSITIVE_INFINITY;
    const bCover = b.daysOfCover?.toNumber() ?? Number.POSITIVE_INFINITY;
    return aCover - bCover;
  });
}

/** Persist the run so the morning list is stable and dismissals stick. */
export async function storeSuggestions(db: ScopedDb): Promise<number> {
  const suggestions = await generateSuggestions(db);

  // Replace only the untouched ones; an accepted or dismissed decision stands.
  await db.replenishmentSuggestion.deleteMany({ where: { status: "NEW" } });

  for (const suggestion of suggestions) {
    const alreadyDecided = await db.replenishmentSuggestion.findFirst({
      where: {
        itemType: suggestion.itemType,
        itemId: suggestion.itemId,
        locationType: suggestion.locationType,
        locationId: suggestion.locationId,
        status: { in: ["ACCEPTED", "DISMISSED"] },
        generatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (alreadyDecided) continue;

    await db.replenishmentSuggestion.create({
      data: {
        companyId: db.$companyId,
        itemType: suggestion.itemType,
        itemId: suggestion.itemId,
        locationType: suggestion.locationType,
        locationId: suggestion.locationId,
        onHand: suggestion.onHand.toFixed(4),
        avgDailyUsage: suggestion.avgDailyUsage.toFixed(4),
        daysOfCover: suggestion.daysOfCover ? suggestion.daysOfCover.toFixed(4) : null,
        reorderPoint: suggestion.reorderPoint.toFixed(4),
        suggestedQty: suggestion.suggestedQty.toFixed(4),
        reason: suggestion.reason,
      },
    });
  }

  return suggestions.length;
}

/** Supplier performance: are they actually delivering what was ordered, on time? */
export async function supplierPerformance(db: ScopedDb) {
  const orders = await db.purchaseOrder.findMany({
    where: { status: { in: ["RECEIVED", "PARTIALLY_RECEIVED"] } },
    include: { lines: true },
  });
  const suppliers = await db.supplier.findMany({ select: { id: true, name: true, leadTimeDays: true } });

  return suppliers.map((supplier) => {
    const theirs = orders.filter((o) => o.supplierId === supplier.id);
    const ordered = sum(theirs.flatMap((o) => o.lines.map((l) => dec(l.qtyPurchaseUnit).times(l.baseUnitsPerPurchaseUnit))));
    const received = sum(theirs.flatMap((o) => o.lines.map((l) => l.qtyReceivedBase)));
    const lateOrders = theirs.filter(
      (o) => o.expectedAt && o.receivedAt && o.receivedAt > o.expectedAt,
    ).length;

    return {
      id: supplier.id,
      name: supplier.name,
      orders: theirs.length,
      fillRatePct: ordered.greaterThan(0) ? received.dividedBy(ordered).times(100).toFixed(1) : null,
      lateOrders,
      leadTimeDays: supplier.leadTimeDays,
    };
  }).filter((s) => s.orders > 0);
}
