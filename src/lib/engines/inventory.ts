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
