import { Decimal, dec, divide, percentOf, sum, ZERO } from "@/lib/money";

/**
 * Profitability engine (spec §10). PURE — no database.
 *
 *   Net Sales − COGS = Gross Profit
 *     − Labour − Wastage − Direct Operating Expenses = Operating Profit
 *     − Allocated Overhead (optional) = Net Profit
 *
 * Wastage sits below gross profit on purpose: keeping it out of COGS is what makes one
 * cart's product margin comparable with another's (spec §15.8).
 */

export type ProfitInput = {
  netSales: Decimal | string | number;
  cogs: Decimal | string | number;
  labourCost: Decimal | string | number;
  wasteCost: Decimal | string | number;
  directExpenses: Decimal | string | number;
  allocatedOverhead?: Decimal | string | number;
};

export type ProfitResult = {
  netSales: Decimal;
  cogs: Decimal;
  grossProfit: Decimal;
  grossMarginPct: Decimal | null;
  labourCost: Decimal;
  wasteCost: Decimal;
  directExpenses: Decimal;
  operatingProfit: Decimal;
  operatingMarginPct: Decimal | null;
  allocatedOverhead: Decimal;
  netProfit: Decimal;
  netMarginPct: Decimal | null;
};

export function profitAndLoss(input: ProfitInput): ProfitResult {
  const netSales = dec(input.netSales);
  const cogs = dec(input.cogs);
  const grossProfit = netSales.minus(cogs);

  const labourCost = dec(input.labourCost);
  const wasteCost = dec(input.wasteCost);
  const directExpenses = dec(input.directExpenses);
  const operatingProfit = grossProfit.minus(labourCost).minus(wasteCost).minus(directExpenses);

  const allocatedOverhead = dec(input.allocatedOverhead ?? 0);
  const netProfit = operatingProfit.minus(allocatedOverhead);

  return {
    netSales, cogs, grossProfit,
    grossMarginPct: percentOf(grossProfit, netSales),
    labourCost, wasteCost, directExpenses,
    operatingProfit,
    operatingMarginPct: percentOf(operatingProfit, netSales),
    allocatedOverhead,
    netProfit,
    netMarginPct: percentOf(netProfit, netSales),
  };
}

/**
 * Spread company-level overhead across units by their share of sales.
 *
 * A unit with no sales carries no overhead — charging rent to a cart that did not trade
 * would make it look like the problem when the real problem is that it did not trade.
 */
export function allocateOverhead(
  overhead: Decimal | string | number,
  units: { id: string; netSales: Decimal | string | number }[],
): Map<string, Decimal> {
  const total = sum(units.map((u) => u.netSales));
  const result = new Map<string, Decimal>();
  const amount = dec(overhead);

  if (total.lessThanOrEqualTo(0) || amount.isZero()) {
    for (const unit of units) result.set(unit.id, ZERO);
    return result;
  }

  // Allocate all but the last unit, then give the remainder to the largest, so the
  // parts always add back to the whole rather than losing a centavo to rounding.
  let allocated = ZERO;
  const ordered = [...units].sort((a, b) => dec(b.netSales).comparedTo(dec(a.netSales)));

  for (const unit of ordered.slice(1)) {
    const share = divide(dec(unit.netSales), total) ?? ZERO;
    const value = amount.times(share).toDecimalPlaces(2);
    result.set(unit.id, value);
    allocated = allocated.plus(value);
  }
  if (ordered[0]) result.set(ordered[0].id, amount.minus(allocated));

  return result;
}

/** Rank units by a metric, for "best and worst" panels. */
export function rank<T extends { id: string }>(
  units: T[],
  metric: (unit: T) => Decimal | string | number,
  direction: "best" | "worst" = "best",
): T[] {
  return [...units].sort((a, b) => {
    const comparison = dec(metric(b)).comparedTo(dec(metric(a)));
    return direction === "best" ? comparison : -comparison;
  });
}

/**
 * Carts that sell well but keep little — the ones a sales-only report hides.
 */
export function strongSalesWeakProfit(
  units: { id: string; name: string; netSales: Decimal | string | number; operatingProfit: Decimal | string | number }[],
  marginFloorPct: Decimal | string | number = 15,
): { id: string; name: string; netSales: Decimal; operatingProfit: Decimal; marginPct: Decimal }[] {
  const salesFigures = units.map((u) => dec(u.netSales));
  const median = salesFigures.length
    ? salesFigures.sort((a, b) => a.comparedTo(b))[Math.floor(salesFigures.length / 2)]!
    : ZERO;

  return units
    .map((unit) => {
      const netSales = dec(unit.netSales);
      const operatingProfit = dec(unit.operatingProfit);
      return {
        id: unit.id,
        name: unit.name,
        netSales,
        operatingProfit,
        marginPct: percentOf(operatingProfit, netSales) ?? ZERO,
      };
    })
    .filter((unit) => unit.netSales.greaterThanOrEqualTo(median) && unit.marginPct.lessThan(dec(marginFloorPct)))
    .sort((a, b) => a.marginPct.comparedTo(b.marginPct));
}
