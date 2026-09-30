import { Decimal, dec, ZERO } from "@/lib/money";
import { applyMovement, replay, type BalanceState, type LedgerMovement } from "./inventory";

/**
 * Undoing a ledger entry. PURE — no database.
 *
 * Posting the plain opposite of a mistaken entry is NOT enough, and the reason is
 * worth stating because it is easy to get wrong. Under weighted-average costing an
 * outbound movement leaves the average untouched — rightly, because goods leaving do
 * not change what the rest cost. So cancelling a bogus "+20 pieces at ₱0" with a
 * "−20 pieces" restores the quantity and leaves the average permanently dragged down
 * by the zero.
 *
 * Instead: work out what the balance WOULD be if the entry had never happened, and
 * post whatever movements reach that state. Clearing to nothing and re-entering at the
 * corrected cost is the only combination that fixes quantity and average together,
 * while keeping the ledger append-only.
 */

export type Correction = { qty: string; unitCost: string; note: string };

export function targetWithout(
  movements: readonly LedgerMovement[],
  excludeIndex: number,
): BalanceState {
  return replay(movements.filter((_, i) => i !== excludeIndex));
}

/** The movements that take `current` to `target`, or none if it is already there. */
export function correctionEntries(current: BalanceState, target: BalanceState): Correction[] {
  const sameQty = current.qty.equals(target.qty);
  const sameCost = current.avgUnitCost.equals(target.avgUnitCost);
  if (sameQty && sameCost) return [];

  /**
   * Quantity alone is wrong: one movement settles it, and the average is already
   * right — either because nothing is left to be wrong, or because an outbound does
   * not disturb it.
   */
  if (sameCost) {
    const delta = target.qty.minus(current.qty);
    return [{
      qty: delta.toFixed(4),
      unitCost: target.avgUnitCost.toFixed(4),
      note: delta.isNegative() ? "removing the quantity" : "restoring the quantity",
    }];
  }

  /**
   * The average is wrong, and ONLY an inbound can move it — an outbound leaves it
   * alone by definition. So clear what is there, then put back what should be there
   * at the cost it should carry.
   */
  const entries: Correction[] = [];
  if (!current.qty.isZero()) {
    entries.push({
      qty: current.qty.negated().toFixed(4),
      unitCost: current.avgUnitCost.toFixed(4),
      note: "clearing the balance so the cost can be restored",
    });
  }

  if (target.qty.isPositive()) {
    entries.push({
      qty: target.qty.toFixed(4),
      unitCost: target.avgUnitCost.toFixed(4),
      note: "re-entering at the cost it had before the mistake",
    });
    return entries;
  }

  /**
   * A negative target — undoing a receipt that a later issue had already drawn on,
   * leaving the location owing stock. It cannot be reached by an outbound alone,
   * because an outbound would carry the cleared average forward. Go up to the right
   * cost first, then straight back down through zero.
   */
  if (target.qty.isNegative()) {
    const size = target.qty.abs();
    entries.push({
      qty: size.toFixed(4),
      unitCost: target.avgUnitCost.toFixed(4),
      note: "setting the cost the shortfall is carried at",
    });
    entries.push({
      qty: size.times(2).negated().toFixed(4),
      unitCost: target.avgUnitCost.toFixed(4),
      note: "taking it back below zero, where the balance belongs",
    });
  }

  // target.qty is zero: an empty balance carries no value, so nothing more is needed.
  return entries;
}

/** Apply a correction plan, for tests and for showing an operator the outcome first. */
export function afterCorrection(current: BalanceState, entries: readonly Correction[]): BalanceState {
  return entries.reduce<BalanceState>(
    (state, e) => applyMovement(state, { qty: e.qty, unitCost: e.unitCost }),
    current,
  );
}

export function balanceOf(qty: Decimal | string | number, avg: Decimal | string | number): BalanceState {
  return { qty: dec(qty as never), avgUnitCost: dec(avg as never) };
}

export const EMPTY: BalanceState = { qty: ZERO, avgUnitCost: ZERO };
