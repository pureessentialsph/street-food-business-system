import { Decimal, dec, percentOf, sum, ZERO } from "@/lib/money";
import { assertPiecesPerStick, piecesToSticks, pricePerPieceFrom } from "@/lib/units";

/**
 * Reconciliation engine (spec §7). PURE — no database.
 *
 * Everything the business reports comes out of here: sales, COGS, wastage, cash
 * accountability, sell-through and the basis for vendor pay. All quantities are in
 * PIECES; sticks are derived for display and for set counting.
 */

export type ReconciliationLineInput = {
  productId: string;
  productName?: string;
  piecesIssued: Decimal | string | number;
  piecesReturned: Decimal | string | number;
  piecesWasted: Decimal | string | number;
  piecesPerStick: Decimal | string | number;
  pricePerStick: Decimal | string | number;
  unitCostPerPiece: Decimal | string | number;
  discountAmount?: Decimal | string | number;
  wasteReason?: string | null;
};

export type ReconciliationShiftInput = {
  cashRemitted: Decimal | string | number;
  digitalSales?: Decimal | string | number;
  otherPayments?: Decimal | string | number;
  /** Beyond this, the shift is DISPUTED and cannot feed payroll. Default ₱100. */
  cashVarianceThreshold?: Decimal | string | number;
  /** Wastage above this share of what was issued needs a reason. Default 10%. */
  wastageThresholdPct?: Decimal | string | number;
};

export type ReconciliationLine = {
  productId: string;
  productName?: string;
  piecesIssued: Decimal;
  piecesReturned: Decimal;
  piecesWasted: Decimal;
  piecesSold: Decimal;
  sticksSold: Decimal;
  piecesPerStick: Decimal;
  pricePerStick: Decimal;
  pricePerPiece: Decimal;
  unitCostPerPiece: Decimal;
  discountAmount: Decimal;
  grossSales: Decimal;
  netSales: Decimal;
  lineCogs: Decimal;
  lineWasteCost: Decimal;
  sellThroughPct: Decimal | null;
  wastagePct: Decimal | null;
};

export type ReconciliationResult = {
  lines: ReconciliationLine[];
  piecesIssued: Decimal;
  piecesSold: Decimal;
  grossSales: Decimal;
  discountTotal: Decimal;
  netSales: Decimal;
  expectedCash: Decimal;
  cashVariance: Decimal;
  cogs: Decimal;
  /** Wastage is an operating expense, never COGS (spec §15.8). */
  wasteCost: Decimal;
  grossProfit: Decimal;
  sellThroughPct: Decimal | null;
  isDisputed: boolean;
  isShort: boolean;
};

export type ValidationIssue = { productId?: string; field: string; message: string };

const DEFAULT_VARIANCE_THRESHOLD = "100";
const DEFAULT_WASTAGE_THRESHOLD = "0.10";

/**
 * Check a closing count before anything is written. Returns every problem at once so
 * the supervisor fixes them in one pass, not one refresh at a time.
 */
export function validateClosing(
  lines: ReconciliationLineInput[],
  options: { wastageThresholdPct?: Decimal | string | number } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const threshold = dec(options.wastageThresholdPct ?? DEFAULT_WASTAGE_THRESHOLD);

  for (const line of lines) {
    const issued = dec(line.piecesIssued);
    const returned = dec(line.piecesReturned);
    const wasted = dec(line.piecesWasted);

    if (returned.isNegative() || wasted.isNegative()) {
      issues.push({
        productId: line.productId,
        field: "count",
        message: `${line.productName ?? "This product"}: counts cannot be negative.`,
      });
      continue;
    }

    if (returned.plus(wasted).greaterThan(issued)) {
      issues.push({
        productId: line.productId,
        field: "count",
        message: `${line.productName ?? "This product"}: ${returned.toFixed(0)} returned + ${wasted.toFixed(0)} wasted is more than the ${issued.toFixed(0)} issued.`,
      });
      continue;
    }

    if (issued.greaterThan(0) && wasted.dividedBy(issued).greaterThan(threshold) && !line.wasteReason?.trim()) {
      issues.push({
        productId: line.productId,
        field: "wasteReason",
        message: `${line.productName ?? "This product"}: ${wasted.toFixed(0)} wasted is over ${dec(threshold).times(100).toFixed(0)}% of what was issued — say what happened.`,
      });
    }
  }

  return issues;
}

export function reconcileLine(input: ReconciliationLineInput): ReconciliationLine {
  const piecesPerStick = assertPiecesPerStick(input.piecesPerStick);
  const piecesIssued = dec(input.piecesIssued);
  const piecesReturned = dec(input.piecesReturned);
  const piecesWasted = dec(input.piecesWasted);
  const piecesSold = piecesIssued.minus(piecesReturned).minus(piecesWasted);

  if (piecesSold.isNegative()) {
    throw new Error(
      `Returns and waste exceed what was issued for ${input.productName ?? input.productId}`,
    );
  }

  const pricePerStick = dec(input.pricePerStick);
  const pricePerPiece = pricePerPieceFrom(pricePerStick, piecesPerStick);
  const unitCostPerPiece = dec(input.unitCostPerPiece);
  const discountAmount = dec(input.discountAmount ?? 0);

  const grossSales = piecesSold.times(pricePerPiece);
  const netSales = grossSales.minus(discountAmount);

  return {
    productId: input.productId,
    productName: input.productName,
    piecesIssued,
    piecesReturned,
    piecesWasted,
    piecesSold,
    sticksSold: piecesToSticks(piecesSold, piecesPerStick),
    piecesPerStick,
    pricePerStick,
    pricePerPiece,
    unitCostPerPiece,
    discountAmount,
    grossSales,
    netSales,
    lineCogs: piecesSold.times(unitCostPerPiece),
    lineWasteCost: piecesWasted.times(unitCostPerPiece),
    sellThroughPct: percentOf(piecesSold, piecesIssued),
    wastagePct: percentOf(piecesWasted, piecesIssued),
  };
}

/** The whole shift, derived from the closing count. */
export function reconcileShift(
  shift: ReconciliationShiftInput,
  lineInputs: ReconciliationLineInput[],
): ReconciliationResult {
  const lines = lineInputs.map(reconcileLine);

  const grossSales = sum(lines.map((l) => l.grossSales));
  const discountTotal = sum(lines.map((l) => l.discountAmount));
  const netSales = grossSales.minus(discountTotal);
  const digitalSales = dec(shift.digitalSales ?? 0);
  const otherPayments = dec(shift.otherPayments ?? 0);

  const expectedCash = netSales.minus(digitalSales).minus(otherPayments);
  const cashVariance = dec(shift.cashRemitted).minus(expectedCash);
  const threshold = dec(shift.cashVarianceThreshold ?? DEFAULT_VARIANCE_THRESHOLD);

  const piecesIssued = sum(lines.map((l) => l.piecesIssued));
  const piecesSold = sum(lines.map((l) => l.piecesSold));
  const cogs = sum(lines.map((l) => l.lineCogs));

  return {
    lines,
    piecesIssued,
    piecesSold,
    grossSales,
    discountTotal,
    netSales,
    expectedCash,
    cashVariance,
    cogs,
    wasteCost: sum(lines.map((l) => l.lineWasteCost)),
    grossProfit: netSales.minus(cogs),
    sellThroughPct: percentOf(piecesSold, piecesIssued),
    isDisputed: cashVariance.abs().greaterThan(threshold),
    isShort: cashVariance.isNegative(),
  };
}

/** Totals a product's issues across the morning load-out and every refill. */
export function totalIssued(
  issues: { lines: { productId: string; qtyPieces: Decimal | string | number }[] }[],
): Map<string, Decimal> {
  const totals = new Map<string, Decimal>();
  for (const issue of issues) {
    for (const line of issue.lines) {
      totals.set(line.productId, (totals.get(line.productId) ?? ZERO).plus(dec(line.qtyPieces)));
    }
  }
  return totals;
}
