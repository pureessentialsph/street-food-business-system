import { Decimal, dec, divide, ZERO } from "@/lib/money";

/**
 * Inventory arithmetic (spec §5.4). PURE — no database.
 *
 * Stock is valued at weighted average cost. Cost moves only when stock comes IN; taking
 * stock out never changes the average, it just reduces the quantity.
 */

export type BalanceState = { qty: Decimal; avgUnitCost: Decimal };

export type LedgerMovement = {
  qty: Decimal | string | number;
  unitCost: Decimal | string | number;
};

/**
 * Apply one signed movement to a balance.
 *
 * Going negative is allowed and deliberate: a cart can be issued stock the system has
 * not recorded receiving yet, and a negative balance is a visible problem rather than a
 * silently swallowed one. Phase 4 blocks issuing more than is on hand at the point of
 * entry, where the operator can still fix it.
 */
export function applyMovement(current: BalanceState, movement: LedgerMovement): BalanceState {
  const qty = dec(movement.qty);
  const unitCost = dec(movement.unitCost);

  if (qty.isZero()) return current;

  // Outbound: quantity falls, the average cost of what remains is unchanged.
  if (qty.isNegative()) {
    return { qty: current.qty.plus(qty), avgUnitCost: current.avgUnitCost };
  }

  // Inbound into a negative or empty balance: the new cost simply becomes the average.
  if (current.qty.lessThanOrEqualTo(0)) {
    return { qty: current.qty.plus(qty), avgUnitCost: unitCost };
  }

  const currentValue = current.qty.times(current.avgUnitCost);
  const incomingValue = qty.times(unitCost);
  const newQty = current.qty.plus(qty);
  const newAvg = divide(currentValue.plus(incomingValue), newQty) ?? unitCost;

  return { qty: newQty, avgUnitCost: newAvg };
}

/** Replay a whole ledger for one item at one location. Used by rebuild:balances. */
export function replay(movements: LedgerMovement[]): BalanceState {
  return movements.reduce<BalanceState>(applyMovement, { qty: ZERO, avgUnitCost: ZERO });
}

export function stockValue(balance: BalanceState): Decimal {
  return balance.qty.times(balance.avgUnitCost);
}

/**
 * Beginning + in − out = ending, the identity management reconciles against (spec §4).
 */
export function movementSummary(movements: (LedgerMovement & { type: string })[]): {
  inQty: Decimal;
  outQty: Decimal;
  netQty: Decimal;
} {
  let inQty = ZERO;
  let outQty = ZERO;
  for (const movement of movements) {
    const qty = dec(movement.qty);
    if (qty.isPositive()) inQty = inQty.plus(qty);
    else outQty = outQty.plus(qty.abs());
  }
  return { inQty, outQty, netQty: inQty.minus(outQty) };
}

/**
 * What a manual adjustment values a piece at.
 *
 * Cost is an input on the way IN and never on the way OUT: under weighted-average
 * costing what leaves is worth the running average by definition, so naming a cost for
 * departing stock would be a way to write any cost-of-goods figure you liked. An
 * entered cost is therefore reported as ignored rather than half-obeyed.
 *
 * Blank means "value it at the average". That is meaningless when there is no average
 * yet — it would book stock at zero and every piece sold from it would report no cost
 * of goods — so the first stock of an item has to say what it cost. An explicit 0 is
 * still accepted, for goods that really were free.
 */
export type AdjustmentCosting =
  | { ok: true; unitCost: Decimal; enteredCostIgnored: boolean }
  | { ok: false; needsUnitCost: true };

export function adjustmentUnitCost({
  direction, enteredCost, runningAverage,
}: {
  direction: "IN" | "OUT";
  /** undefined = the field was left blank. */
  enteredCost: Decimal | string | number | undefined | null;
  runningAverage: Decimal | string | number;
}): AdjustmentCosting {
  const average = dec(runningAverage);
  const blank = enteredCost === undefined || enteredCost === null || enteredCost === "";

  if (direction === "OUT") {
    return { ok: true, unitCost: average, enteredCostIgnored: !blank };
  }
  if (!blank) {
    return { ok: true, unitCost: dec(enteredCost), enteredCostIgnored: false };
  }
  if (average.isZero()) return { ok: false, needsUnitCost: true };
  return { ok: true, unitCost: average, enteredCostIgnored: false };
}

/** A transfer must move the same quantity out of one place and into another. */
export function transferPair(
  qty: Decimal | string | number,
  unitCost: Decimal | string | number,
): { out: LedgerMovement; in: LedgerMovement } {
  const amount = dec(qty);
  if (amount.lessThanOrEqualTo(0)) throw new Error("Transfer quantity must be greater than zero");
  return {
    out: { qty: amount.negated(), unitCost },
    in: { qty: amount, unitCost },
  };
}

export { Decimal };
