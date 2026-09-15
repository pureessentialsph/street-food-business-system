import { Decimal, dec, divide, percentOf, sum, ZERO } from "@/lib/money";
import { assertPiecesPerStick } from "@/lib/units";

/**
 * Costing engine (spec §6). PURE: plain inputs, plain outputs, no database.
 *
 * The three allocation bases are what make oil, sauce and packaging cost correctly:
 *   PER_BATCH — flour, eggs, seasoning: divided by batchYieldPieces
 *   PER_PIECE — cooking oil: attributed to every piece fried
 *   PER_STICK — stick, sauce, cup: charged once per stick sold
 */

export type AllocationBasis = "PER_BATCH" | "PER_PIECE" | "PER_STICK";
export type ComponentType = "RAW" | "PACKAGING" | "CONDIMENT" | "OIL" | "CONSUMABLE";

export type CostingLine = {
  ingredientId: string;
  ingredientName: string;
  baseUnit?: string;
  qtyInBaseUnit: Decimal | string | number;
  /** Fraction, not percent: 0.05 means 5% trim or spillage on this line. */
  wastagePct: Decimal | string | number;
  allocationBasis: AllocationBasis;
  componentType: ComponentType;
  costPerBaseUnit: Decimal | string | number;
};

export type CostingRecipe = {
  batchYieldPieces: Decimal | string | number;
  lines: CostingLine[];
};

export type LineCost = {
  ingredientId: string;
  ingredientName: string;
  allocationBasis: AllocationBasis;
  componentType: ComponentType;
  /** Cost of the line as written, before it is spread over the batch. */
  rawCost: string;
  /** Wastage uplift only, so the operator can see what spillage is costing. */
  wastageCost: string;
  /** rawCost + wastageCost. */
  totalCost: string;
  /** This line's contribution to one stick. */
  perStick: string;
};

export type CostBreakdown = {
  batchYieldPieces: string;
  piecesPerStick: string;
  perBatchTotal: string;
  perPieceTotal: string;
  perStickTotal: string;
  costPerPiece: string;
  costPerStick: string;
  /** Totals by component type, per stick — the cost card the owner reads. */
  byComponent: Record<ComponentType, string>;
  wastageCost: string;
  lines: LineCost[];
};

/** qty × unit cost, plus this line's wastage allowance. */
export function lineCost(line: CostingLine): Decimal {
  const base = dec(line.qtyInBaseUnit).times(dec(line.costPerBaseUnit));
  return base.times(dec(1).plus(dec(line.wastagePct)));
}

function linesOf(recipe: CostingRecipe, basis: AllocationBasis): CostingLine[] {
  return recipe.lines.filter((line) => line.allocationBasis === basis);
}

export function perBatchTotal(recipe: CostingRecipe): Decimal {
  return sum(linesOf(recipe, "PER_BATCH").map(lineCost));
}

export function perPieceTotal(recipe: CostingRecipe): Decimal {
  return sum(linesOf(recipe, "PER_PIECE").map(lineCost));
}

export function perStickTotal(recipe: CostingRecipe): Decimal {
  return sum(linesOf(recipe, "PER_STICK").map(lineCost));
}

export function costPerPiece(recipe: CostingRecipe): Decimal {
  const yieldPieces = dec(recipe.batchYieldPieces);
  if (yieldPieces.lessThanOrEqualTo(0)) {
    throw new Error("batchYieldPieces must be greater than zero");
  }
  const spread = divide(perBatchTotal(recipe), yieldPieces) ?? ZERO;
  return spread.plus(perPieceTotal(recipe));
}

export function costPerStick(
  recipe: CostingRecipe,
  piecesPerStick: Decimal | string | number,
): Decimal {
  const per = assertPiecesPerStick(piecesPerStick);
  return costPerPiece(recipe).times(per).plus(perStickTotal(recipe));
}

/** Gross profit and margin for one stick. */
export function margin(
  pricePerStick: Decimal | string | number,
  costOfStick: Decimal | string | number,
): { grossProfit: Decimal; marginPct: Decimal | null } {
  const price = dec(pricePerStick);
  const cost = dec(costOfStick);
  const grossProfit = price.minus(cost);
  return { grossProfit, marginPct: percentOf(grossProfit, price) };
}

/** What one full set costs to put on a cart, and what it is worth sold out. */
export function setEconomics(
  components: { costPerStick: Decimal | string | number; pricePerStick: Decimal | string | number; requiredSticks: Decimal | string | number }[],
): { cost: Decimal; revenue: Decimal; grossProfit: Decimal; marginPct: Decimal | null } {
  const cost = sum(components.map((c) => dec(c.costPerStick).times(dec(c.requiredSticks))));
  const revenue = sum(components.map((c) => dec(c.pricePerStick).times(dec(c.requiredSticks))));
  const grossProfit = revenue.minus(cost);
  return { cost, revenue, grossProfit, marginPct: percentOf(grossProfit, revenue) };
}

const EMPTY_COMPONENTS: Record<ComponentType, string> = {
  RAW: "0.0000",
  PACKAGING: "0.0000",
  CONDIMENT: "0.0000",
  OIL: "0.0000",
  CONSUMABLE: "0.0000",
};

/**
 * The full cost card: every line, what it contributes to one stick, and the totals by
 * component type. Stored as ProductCostVersion.breakdown so a historical cost can always
 * be explained, not just quoted.
 */
export function buildBreakdown(
  recipe: CostingRecipe,
  piecesPerStick: Decimal | string | number,
): CostBreakdown {
  const per = assertPiecesPerStick(piecesPerStick);
  const yieldPieces = dec(recipe.batchYieldPieces);
  if (yieldPieces.lessThanOrEqualTo(0)) {
    throw new Error("batchYieldPieces must be greater than zero");
  }

  const byComponent: Record<ComponentType, Decimal> = {
    RAW: ZERO, PACKAGING: ZERO, CONDIMENT: ZERO, OIL: ZERO, CONSUMABLE: ZERO,
  };
  let wastage = ZERO;

  const lines: LineCost[] = recipe.lines.map((line) => {
    const raw = dec(line.qtyInBaseUnit).times(dec(line.costPerBaseUnit));
    const total = lineCost(line);
    const wastageCost = total.minus(raw);
    wastage = wastage.plus(contributionPerStick(wastageCost, line.allocationBasis, yieldPieces, per));

    const perStick = contributionPerStick(total, line.allocationBasis, yieldPieces, per);
    byComponent[line.componentType] = byComponent[line.componentType].plus(perStick);

    return {
      ingredientId: line.ingredientId,
      ingredientName: line.ingredientName,
      allocationBasis: line.allocationBasis,
      componentType: line.componentType,
      rawCost: raw.toFixed(4),
      wastageCost: wastageCost.toFixed(4),
      totalCost: total.toFixed(4),
      perStick: perStick.toFixed(4),
    };
  });

  return {
    batchYieldPieces: yieldPieces.toFixed(4),
    piecesPerStick: per.toFixed(4),
    perBatchTotal: perBatchTotal(recipe).toFixed(4),
    perPieceTotal: perPieceTotal(recipe).toFixed(4),
    perStickTotal: perStickTotal(recipe).toFixed(4),
    costPerPiece: costPerPiece(recipe).toFixed(4),
    costPerStick: costPerStick(recipe, per).toFixed(4),
    byComponent: {
      ...EMPTY_COMPONENTS,
      ...Object.fromEntries(
        Object.entries(byComponent).map(([key, value]) => [key, value.toFixed(4)]),
      ),
    } as Record<ComponentType, string>,
    wastageCost: wastage.toFixed(4),
    lines,
  };
}

/** How much of one line lands on a single stick, given how it is allocated. */
function contributionPerStick(
  amount: Decimal,
  basis: AllocationBasis,
  batchYieldPieces: Decimal,
  piecesPerStick: Decimal,
): Decimal {
  switch (basis) {
    case "PER_BATCH":
      return (divide(amount, batchYieldPieces) ?? ZERO).times(piecesPerStick);
    case "PER_PIECE":
      return amount.times(piecesPerStick);
    case "PER_STICK":
      return amount;
  }
}
