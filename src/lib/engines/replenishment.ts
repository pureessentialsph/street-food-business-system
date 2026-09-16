import { Decimal, dec, divide, ZERO } from "@/lib/money";

/**
 * Replenishment engine (spec §9). PURE — no database.
 *
 *   avgDailyUsage = sold over the window / days it actually traded
 *   daysOfCover   = onHand / avgDailyUsage
 *   reorderPoint  = avgDailyUsage × leadTimeDays + safetyStock
 *   suggestedQty  = max(0, avgDailyUsage × (leadTimeDays + coverDays)
 *                          + safetyStock − onHand − onOrder)  rounded UP to packSize
 *
 * Dividing by TRADING days rather than calendar days matters: a cart that rests on
 * Sundays would otherwise look like it sells a seventh less than it does.
 */

export type ReplenishmentInput = {
  itemName: string;
  onHand: Decimal | string | number;
  onOrder?: Decimal | string | number;
  /** Total sold across the window, in base units. */
  soldInWindow: Decimal | string | number;
  /** Days within the window on which this location actually traded. */
  activeDays: number;
  leadTimeDays: number;
  safetyStock: Decimal | string | number;
  coverDays?: number;
  packSize?: Decimal | string | number;
};

export type ReplenishmentResult = {
  itemName: string;
  onHand: Decimal;
  avgDailyUsage: Decimal;
  daysOfCover: Decimal | null;
  reorderPoint: Decimal;
  suggestedQty: Decimal;
  triggered: boolean;
  overstocked: boolean;
  reason: string;
};

const DEFAULT_COVER_DAYS = 7;
const OVERSTOCK_DAYS = 30;

/** Round up to a whole number of packs — suppliers do not sell 4,900 of a 250-pack. */
export function roundUpToPack(
  quantity: Decimal | string | number,
  packSize: Decimal | string | number = 1,
): Decimal {
  const qty = dec(quantity);
  const pack = dec(packSize);
  if (pack.lessThanOrEqualTo(1)) return qty.ceil();
  return qty.dividedBy(pack).ceil().times(pack);
}

export function replenish(input: ReplenishmentInput): ReplenishmentResult {
  const onHand = dec(input.onHand);
  const onOrder = dec(input.onOrder ?? 0);
  const safetyStock = dec(input.safetyStock);
  const coverDays = input.coverDays ?? DEFAULT_COVER_DAYS;
  const leadTimeDays = input.leadTimeDays;

  const avgDailyUsage = input.activeDays > 0
    ? divide(dec(input.soldInWindow), input.activeDays) ?? ZERO
    : ZERO;

  const daysOfCover = avgDailyUsage.greaterThan(0) ? divide(onHand, avgDailyUsage) : null;
  const reorderPoint = avgDailyUsage.times(leadTimeDays).plus(safetyStock);

  const rawNeed = avgDailyUsage
    .times(leadTimeDays + coverDays)
    .plus(safetyStock)
    .minus(onHand)
    .minus(onOrder);

  /**
   * Deliberate departure from the literal formula: an item that has not sold at all in
   * the window gets no suggestion, even when it sits below safety stock. The formula
   * alone would top it up — which is buying stock that does not move. Safety stock is
   * protection against demand, and there is no demand to protect against.
   */
  const suggestedQty = avgDailyUsage.isZero() || rawNeed.lessThanOrEqualTo(0)
    ? ZERO
    : roundUpToPack(rawNeed, input.packSize ?? 1);

  const triggered = onHand.lessThanOrEqualTo(reorderPoint) && avgDailyUsage.greaterThan(0);
  const overstocked = daysOfCover !== null && daysOfCover.greaterThan(OVERSTOCK_DAYS);

  return {
    itemName: input.itemName,
    onHand,
    avgDailyUsage,
    daysOfCover,
    reorderPoint,
    suggestedQty,
    triggered,
    overstocked,
    reason: describe({
      itemName: input.itemName, onHand, avgDailyUsage, daysOfCover,
      reorderPoint, suggestedQty, triggered, overstocked,
      onOrder, leadTimeDays,
    }),
  };
}

function describe(input: {
  itemName: string;
  onHand: Decimal;
  avgDailyUsage: Decimal;
  daysOfCover: Decimal | null;
  reorderPoint: Decimal;
  suggestedQty: Decimal;
  triggered: boolean;
  overstocked: boolean;
  onOrder: Decimal;
  leadTimeDays: number;
}): string {
  const qty = (value: Decimal) => value.toDecimalPlaces(0).toNumber().toLocaleString("en-PH");

  if (input.avgDailyUsage.isZero()) {
    return `${input.itemName} has not sold in this window, so no order is suggested. ${qty(input.onHand)} on hand.`;
  }

  /**
   * A negative balance means stock went out that was never recorded coming in. Saying
   * "runs out in −1.5 days" is nonsense to a reader, so say what is actually true and
   * point at the cause.
   */
  if (input.onHand.lessThanOrEqualTo(0)) {
    const shortfall = input.onHand.isNegative()
      ? ` The books show ${qty(input.onHand.abs())} more went out than came in, so a receipt or production batch is missing.`
      : "";
    return `${input.itemName} is out of stock at ${qty(input.avgDailyUsage)} a day. Recommended order: ${qty(input.suggestedQty)}.${shortfall}`;
  }

  if (input.overstocked) {
    return `${input.itemName} has ${qty(input.onHand)} on hand — about ${input.daysOfCover!.toFixed(0)} days of cover at ${qty(input.avgDailyUsage)} a day. That is more than a month; consider holding off.`;
  }

  if (!input.triggered) {
    return `${input.itemName} is above its reorder point of ${qty(input.reorderPoint)} with ${qty(input.onHand)} on hand — roughly ${input.daysOfCover!.toFixed(1)} days of cover.`;
  }

  const onOrderNote = input.onOrder.greaterThan(0)
    ? ` ${qty(input.onOrder)} is already on order.`
    : "";

  return `Projected to run out in about ${input.daysOfCover!.toFixed(1)} days at ${qty(input.avgDailyUsage)} a day (${qty(input.onHand)} on hand, ${input.leadTimeDays}-day lead time). Recommended order: ${qty(input.suggestedQty)}.${onOrderNote}`;
}

/**
 * Weighted average cost after a receipt (spec §5.7).
 *
 * Receiving at a new price moves the cost of what is on hand, which is what then
 * ripples into every recipe using it.
 */
export function newAverageCost(
  onHand: Decimal | string | number,
  currentCost: Decimal | string | number,
  receivedQty: Decimal | string | number,
  receivedUnitCost: Decimal | string | number,
): Decimal {
  const existing = dec(onHand);
  const incoming = dec(receivedQty);
  const total = existing.plus(incoming);

  if (total.lessThanOrEqualTo(0)) return dec(receivedUnitCost);
  // A negative or empty balance carries no cost worth blending in.
  if (existing.lessThanOrEqualTo(0)) return dec(receivedUnitCost);

  return divide(
    existing.times(dec(currentCost)).plus(incoming.times(dec(receivedUnitCost))),
    total,
  ) ?? dec(receivedUnitCost);
}

/** Cost per base unit from what the supplier charges for their pack. */
export function costPerBaseUnit(
  pricePerPurchaseUnit: Decimal | string | number,
  baseUnitsPerPurchaseUnit: Decimal | string | number,
): Decimal {
  const per = dec(baseUnitsPerPurchaseUnit);
  if (per.lessThanOrEqualTo(0)) {
    throw new Error("baseUnitsPerPurchaseUnit must be greater than zero");
  }
  return dec(pricePerPurchaseUnit).dividedBy(per);
}
