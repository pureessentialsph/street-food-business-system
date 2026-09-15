import type { Prisma } from "@prisma/client";
import type { ScopedDb } from "@/lib/db";
import { dec } from "@/lib/money";
import { buildBreakdown, costPerPiece, costPerStick, type CostingLine, type CostingRecipe } from "@/lib/engines/costing";

/**
 * The impure half of costing: reads recipes, calls the pure engine, and snapshots the
 * result as a ProductCostVersion.
 *
 * Cost versions are append-only. A price change writes a new row rather than editing
 * the old one, which is what keeps last week's reported profit from moving when an
 * ingredient goes up today (spec §3 rule 4).
 */

export type CostTrigger =
  | "RECIPE_CREATED" | "RECIPE_EDITED" | "INGREDIENT_COST_CHANGE" | "MANUAL_RECALC" | "SEED";

export type CostChange = {
  productId: string;
  productName: string;
  recipeVersion: number;
  previousCostPerStick: string | null;
  costPerStick: string;
  /** Positive means the product got more expensive. Null when there is nothing to compare. */
  deltaPct: string | null;
  pricePerStick: string | null;
  previousMarginPct: string | null;
  marginPct: string | null;
  versionId: string;
};

/** Load a product's active recipe in the shape the pure engine expects. */
async function loadRecipe(db: ScopedDb, productId: string) {
  const recipe = await db.recipe.findFirst({
    where: { productId, isActive: true },
    include: {
      lines: { include: { ingredient: { select: { name: true, baseUnit: true, currentCostPerBaseUnit: true } } } },
      product: { select: { id: true, name: true, piecesPerStick: true } },
    },
    orderBy: { version: "desc" },
  });
  if (!recipe || recipe.lines.length === 0) return null;

  const costing: CostingRecipe = {
    batchYieldPieces: recipe.batchYieldPieces.toString(),
    lines: recipe.lines.map<CostingLine>((line) => ({
      ingredientId: line.ingredientId,
      ingredientName: line.ingredient.name,
      baseUnit: line.ingredient.baseUnit,
      qtyInBaseUnit: line.qtyInBaseUnit.toString(),
      wastagePct: line.wastagePct.toString(),
      allocationBasis: line.allocationBasis,
      componentType: line.componentType,
      costPerBaseUnit: line.ingredient.currentCostPerBaseUnit.toString(),
    })),
  };
  return { recipe, costing };
}

async function currentPrice(db: ScopedDb, productId: string): Promise<string | null> {
  const item = await db.priceListItem.findFirst({
    where: { productId, priceList: { isActive: true, scopeType: "COMPANY" } },
  });
  return item ? item.pricePerStick.toString() : null;
}

function marginPctOf(price: string | null, cost: string): string | null {
  if (price === null) return null;
  const p = dec(price);
  if (p.isZero()) return null;
  return p.minus(dec(cost)).dividedBy(p).times(100).toFixed(2);
}

/**
 * Recompute one product and snapshot it if anything moved. Returns null when the cost
 * is unchanged — repeatedly saving the same recipe must not litter the history.
 */
export async function recomputeProduct(
  db: ScopedDb,
  productId: string,
  triggeredBy: CostTrigger,
  userId: string | null,
  note?: string,
): Promise<CostChange | null> {
  const loaded = await loadRecipe(db, productId);
  if (!loaded) return null;

  const { recipe, costing } = loaded;
  const piecesPerStick = recipe.product.piecesPerStick.toString();

  const newCostPerPiece = costPerPiece(costing).toFixed(4);
  const newCostPerStick = costPerStick(costing, piecesPerStick).toFixed(4);
  const breakdown = buildBreakdown(costing, piecesPerStick);

  const previous = await db.productCostVersion.findFirst({
    where: { productId },
    orderBy: { effectiveFrom: "desc" },
  });

  const previousCostPerStick = previous ? previous.costPerStick.toString() : null;
  if (previous && previous.costPerStick.equals(dec(newCostPerStick).toString()) &&
      previous.recipeVersion === recipe.version) {
    return null;
  }

  const version = await db.productCostVersion.create({
    data: {
      companyId: db.$companyId,
      productId,
      recipeVersion: recipe.version,
      effectiveFrom: new Date(),
      costPerPiece: newCostPerPiece,
      costPerStick: newCostPerStick,
      breakdown: breakdown as unknown as Prisma.InputJsonValue,
      triggeredBy,
      note: note ?? null,
      createdById: userId,
    },
  });

  const price = await currentPrice(db, productId);
  const deltaPct =
    previousCostPerStick && !dec(previousCostPerStick).isZero()
      ? dec(newCostPerStick).minus(previousCostPerStick).dividedBy(previousCostPerStick).times(100).toFixed(2)
      : null;

  return {
    productId,
    productName: recipe.product.name,
    recipeVersion: recipe.version,
    previousCostPerStick,
    costPerStick: newCostPerStick,
    deltaPct,
    pricePerStick: price,
    previousMarginPct: previousCostPerStick ? marginPctOf(price, previousCostPerStick) : null,
    marginPct: marginPctOf(price, newCostPerStick),
    versionId: version.id,
  };
}

/**
 * Every product whose recipe uses this ingredient. Called when a price changes, so the
 * owner learns which products just moved instead of discovering it at month end.
 */
export async function recomputeForIngredient(
  db: ScopedDb,
  ingredientId: string,
  userId: string | null,
  note?: string,
): Promise<CostChange[]> {
  const lines = await db.recipeLine.findMany({
    where: { ingredientId, recipe: { isActive: true } },
    select: { recipe: { select: { productId: true } } },
  });

  const productIds = [...new Set(lines.map((l) => l.recipe.productId))];
  const changes: CostChange[] = [];
  for (const productId of productIds) {
    const change = await recomputeProduct(db, productId, "INGREDIENT_COST_CHANGE", userId, note);
    if (change) changes.push(change);
  }
  return changes;
}

/** Recompute everything — used by the seed and the manual "Recalculate all" button. */
export async function recomputeAll(
  db: ScopedDb,
  triggeredBy: CostTrigger,
  userId: string | null,
): Promise<CostChange[]> {
  const recipes = await db.recipe.findMany({
    where: { isActive: true },
    select: { productId: true },
    distinct: ["productId"],
  });

  const changes: CostChange[] = [];
  for (const { productId } of recipes) {
    const change = await recomputeProduct(db, productId, triggeredBy, userId);
    if (change) changes.push(change);
  }
  return changes;
}

/**
 * The cost that applied on a given business date. Shift lines resolve their unit cost
 * through this, which is why changing a price today cannot rewrite last week (spec §6).
 */
export async function costAsOf(
  db: ScopedDb,
  productId: string,
  businessDate: Date,
): Promise<{ costPerPiece: string; costPerStick: string } | null> {
  /**
   * A business date is midnight; a cost version is stamped with the moment it was
   * written. Comparing them directly would exclude every cost created during the day
   * being costed — which silently produced zero COGS. Take everything in force by the
   * END of that business date instead.
   */
  const endOfBusinessDate = new Date(businessDate);
  endOfBusinessDate.setUTCDate(endOfBusinessDate.getUTCDate() + 1);

  const version = await db.productCostVersion.findFirst({
    where: { productId, effectiveFrom: { lt: endOfBusinessDate } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!version) return null;
  return {
    costPerPiece: version.costPerPiece.toString(),
    costPerStick: version.costPerStick.toString(),
  };
}

/** Human summary for the alert banner: "Quail egg cost rose 12%. 3 products affected." */
export function describeChanges(changes: CostChange[]): string {
  if (changes.length === 0) return "No product costs changed.";
  const worst = [...changes].sort(
    (a, b) => Number(b.deltaPct ?? 0) - Number(a.deltaPct ?? 0),
  )[0]!;
  const count = `${changes.length} product${changes.length === 1 ? "" : "s"}`;
  if (worst.deltaPct === null) return `${count} costed for the first time.`;
  const direction = Number(worst.deltaPct) >= 0 ? "rose" : "fell";
  const marginNote =
    worst.previousMarginPct && worst.marginPct
      ? ` ${worst.productName} margin went from ${worst.previousMarginPct}% to ${worst.marginPct}%.`
      : "";
  return `${count} affected: cost ${direction} up to ${Math.abs(Number(worst.deltaPct)).toFixed(1)}%.${marginNote}`;
}
