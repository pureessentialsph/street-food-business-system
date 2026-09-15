import type { ItemType, InventoryTxnType, StockLocationType } from "@prisma/client";
import type { ScopedDb } from "@/lib/db";
import { dec } from "@/lib/money";
import { applyMovement } from "@/lib/engines/inventory";

/**
 * Posting to the ledger (spec §5.4).
 *
 * Every write goes through postLedger, which writes the append-only rows and updates
 * the StockBalance cache inside ONE database transaction. Either all of it lands or
 * none of it does — a ledger row without its balance update is how stock silently
 * evaporates.
 */

export type LedgerEntry = {
  itemType: ItemType;
  itemId: string;
  locationType: StockLocationType;
  locationId: string;
  /** Signed: positive in, negative out. */
  qty: string;
  unitCost: string;
  type: InventoryTxnType;
  refType: string;
  refId: string;
  businessDate: Date;
  reason?: string;
};

export async function postLedger(
  db: ScopedDb,
  entries: LedgerEntry[],
  userId: string | null,
): Promise<number> {
  if (entries.length === 0) return 0;

  return db.$transaction(async (tx) => {
    for (const entry of entries) {
      await tx.inventoryTransaction.create({
        data: {
          companyId: db.$companyId,
          itemType: entry.itemType,
          itemId: entry.itemId,
          locationType: entry.locationType,
          locationId: entry.locationId,
          qty: entry.qty,
          unitCost: entry.unitCost,
          type: entry.type,
          refType: entry.refType,
          refId: entry.refId,
          businessDate: entry.businessDate,
          reason: entry.reason ?? null,
          createdById: userId,
        },
      });

      const existing = await tx.stockBalance.findFirst({
        where: {
          itemType: entry.itemType,
          itemId: entry.itemId,
          locationType: entry.locationType,
          locationId: entry.locationId,
        },
      });

      const next = applyMovement(
        {
          qty: dec(existing?.qty ?? 0),
          avgUnitCost: dec(existing?.avgUnitCost ?? 0),
        },
        { qty: entry.qty, unitCost: entry.unitCost },
      );

      if (existing) {
        await tx.stockBalance.update({
          where: { id: existing.id },
          data: { qty: next.qty.toFixed(4), avgUnitCost: next.avgUnitCost.toFixed(4) },
        });
      } else {
        await tx.stockBalance.create({
          data: {
            companyId: db.$companyId,
            itemType: entry.itemType,
            itemId: entry.itemId,
            locationType: entry.locationType,
            locationId: entry.locationId,
            qty: next.qty.toFixed(4),
            avgUnitCost: next.avgUnitCost.toFixed(4),
          },
        });
      }
    }
    return entries.length;
  });
}

/** What is on hand right now, straight from the cache. */
export async function onHand(
  db: ScopedDb,
  itemType: ItemType,
  itemId: string,
  locationType: StockLocationType,
  locationId: string,
): Promise<{ qty: string; avgUnitCost: string }> {
  const balance = await db.stockBalance.findFirst({
    where: { itemType, itemId, locationType, locationId },
  });
  return {
    qty: balance ? balance.qty.toString() : "0",
    avgUnitCost: balance ? balance.avgUnitCost.toString() : "0",
  };
}

/**
 * Rebuild every cached balance from the ledger. The ledger is the source of truth; if
 * these two ever disagree, the cache is wrong and this is the fix.
 */
export async function rebuildBalances(db: ScopedDb): Promise<{ rebuilt: number; drift: number }> {
  const grouped = await db.inventoryTransaction.groupBy({
    by: ["itemType", "itemId", "locationType", "locationId"],
    _sum: { qty: true },
  });

  let drift = 0;
  for (const group of grouped) {
    const movements = await db.inventoryTransaction.findMany({
      where: {
        itemType: group.itemType,
        itemId: group.itemId,
        locationType: group.locationType,
        locationId: group.locationId,
      },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
      select: { qty: true, unitCost: true },
    });

    const state = movements.reduce(
      (acc, movement) =>
        applyMovement(acc, { qty: movement.qty.toString(), unitCost: movement.unitCost.toString() }),
      { qty: dec(0), avgUnitCost: dec(0) },
    );

    const existing = await db.stockBalance.findFirst({
      where: {
        itemType: group.itemType,
        itemId: group.itemId,
        locationType: group.locationType,
        locationId: group.locationId,
      },
    });

    if (!existing || !existing.qty.equals(state.qty.toFixed(4))) drift += 1;

    if (existing) {
      await db.stockBalance.update({
        where: { id: existing.id },
        data: { qty: state.qty.toFixed(4), avgUnitCost: state.avgUnitCost.toFixed(4) },
      });
    } else {
      await db.stockBalance.create({
        data: {
          companyId: db.$companyId,
          itemType: group.itemType,
          itemId: group.itemId,
          locationType: group.locationType,
          locationId: group.locationId,
          qty: state.qty.toFixed(4),
          avgUnitCost: state.avgUnitCost.toFixed(4),
        },
      });
    }
  }

  /**
   * Any cached balance with no ledger rows behind it is stale and must go to zero.
   * The loop above only visits pairs the ledger still knows about, so without this a
   * balance could outlive the movements that created it and quietly overstate stock.
   */
  const known = new Set(
    grouped.map((g) => `${g.itemType}|${g.itemId}|${g.locationType}|${g.locationId}`),
  );
  const cached = await db.stockBalance.findMany();
  for (const balance of cached) {
    const key = `${balance.itemType}|${balance.itemId}|${balance.locationType}|${balance.locationId}`;
    if (known.has(key)) continue;
    if (!balance.qty.isZero()) drift += 1;
    await db.stockBalance.update({
      where: { id: balance.id },
      data: { qty: "0", avgUnitCost: "0" },
    });
  }

  return { rebuilt: grouped.length, drift };
}

/** Next reference in a per-company series, e.g. TRF-000004. */
export async function nextReference(
  db: ScopedDb,
  prefix: "TRF" | "BATCH" | "COUNT",
): Promise<string> {
  const counters = {
    TRF: () => db.stockTransfer.count(),
    BATCH: () => db.productionBatch.count(),
    COUNT: () => db.physicalCount.count(),
  } as const;
  const n = (await counters[prefix]()) + 1;
  return `${prefix}-${String(n).padStart(6, "0")}`;
}
