/**
 * The cash book arithmetic. PURE — no database.
 *
 * A cash balance is a sum of signed amounts, which sounds too simple to need a file of
 * its own. It needs one because the sign is the whole question: whether a payroll run
 * adds or removes money is a business fact, not an accident of how a form was filled
 * in, and it must give the same answer on the dashboard, in the count, and in the
 * correction that reverses a row. So the direction of every kind of movement is
 * declared once, here, and everything else reads it.
 */

import { dec, sum, ZERO } from "@/lib/money";

export type CashMovementType =
  | "CAPITAL"
  | "OWNER_DRAW"
  | "SALES"
  | "EXPENSE"
  | "PAYROLL"
  | "PURCHASE"
  | "BANK_DEPOSIT"
  | "BANK_WITHDRAWAL"
  | "COUNT_ADJUSTMENT"
  | "OTHER_IN"
  | "OTHER_OUT";

/**
 * Which way each kind of movement pushes the balance. BANK_DEPOSIT is negative because
 * this is the cash box, not the bank: money banked has left the box.
 *
 * COUNT_ADJUSTMENT is the one type whose amount may be either way, so it carries its
 * own sign; see `signedAmount`.
 */
export const DIRECTION: Record<CashMovementType, 1 | -1 | 0> = {
  CAPITAL: 1,
  OWNER_DRAW: -1,
  SALES: 1,
  EXPENSE: -1,
  PAYROLL: -1,
  PURCHASE: -1,
  BANK_DEPOSIT: -1,
  BANK_WITHDRAWAL: 1,
  COUNT_ADJUSTMENT: 0,
  OTHER_IN: 1,
  OTHER_OUT: -1,
};

export const TYPE_LABELS: Record<CashMovementType, string> = {
  CAPITAL: "Capital put in",
  OWNER_DRAW: "Owner's drawing",
  SALES: "Sales remitted",
  EXPENSE: "Expense paid",
  PAYROLL: "Wages paid",
  PURCHASE: "Supplier paid",
  BANK_DEPOSIT: "Banked",
  BANK_WITHDRAWAL: "Drawn from bank",
  COUNT_ADJUSTMENT: "Counted difference",
  OTHER_IN: "Other money in",
  OTHER_OUT: "Other money out",
};

/** The types an owner may enter by hand. The rest are posted by the system. */
export const MANUAL_TYPES: CashMovementType[] = [
  "CAPITAL",
  "OWNER_DRAW",
  "PURCHASE",
  "BANK_DEPOSIT",
  "BANK_WITHDRAWAL",
  "OTHER_IN",
  "OTHER_OUT",
];

export type Movement = {
  type: CashMovementType;
  /** Positive, except on a COUNT_ADJUSTMENT, which carries its own sign. */
  amount: string | number;
};

/** What this movement does to the balance: positive adds, negative removes. */
export function signedAmount(movement: Movement): ReturnType<typeof dec> {
  const direction = DIRECTION[movement.type];
  const amount = dec(movement.amount);
  // An adjustment is signed by whoever recorded it: short is negative, over is positive.
  if (direction === 0) return amount;
  return direction === 1 ? amount.abs() : amount.abs().negated();
}

export function balanceOf(movements: readonly Movement[]): ReturnType<typeof dec> {
  return movements.reduce((total, movement) => total.plus(signedAmount(movement)), ZERO);
}

export type CashSummary = {
  in: string;
  out: string;
  balance: string;
  byType: { type: CashMovementType; label: string; amount: string; count: number }[];
};

/**
 * The balance broken down, which is the thing an owner actually reads: not "₱4,000" but
 * "₱10,000 put in, ₱3,176 sold, ₱1,200 of wages and expenses out".
 */
export function summarise(movements: readonly Movement[]): CashSummary {
  const totals = new Map<CashMovementType, { amount: ReturnType<typeof dec>; count: number }>();
  for (const movement of movements) {
    const current = totals.get(movement.type) ?? { amount: ZERO, count: 0 };
    totals.set(movement.type, {
      amount: current.amount.plus(signedAmount(movement)),
      count: current.count + 1,
    });
  }

  const signed = movements.map(signedAmount);
  return {
    in: sum(signed.filter((v) => v.greaterThan(0))).toFixed(2),
    out: sum(signed.filter((v) => v.isNegative())).abs().toFixed(2),
    balance: sum(signed).toFixed(2),
    byType: [...totals.entries()]
      .map(([type, totalsForType]) => ({
        type,
        label: TYPE_LABELS[type],
        amount: totalsForType.amount.toFixed(2),
        count: totalsForType.count,
      }))
      .sort((a, b) => dec(b.amount).abs().comparedTo(dec(a.amount).abs())),
  };
}

export type CountOutcome = {
  expected: string;
  counted: string;
  /** counted − expected. Negative is short. */
  variance: string;
  /** Said plainly, because "variance: -50" is not what a person wants to read. */
  verdict: string;
  /** Whether the difference is big enough to be worth an explanation. */
  needsExplaining: boolean;
};

export function countCash(
  expected: string | number,
  counted: string | number,
  threshold: string | number = 0,
): CountOutcome {
  const expectedDec = dec(expected);
  const countedDec = dec(counted);
  const variance = countedDec.minus(expectedDec);
  const over = variance.greaterThan(0);

  return {
    expected: expectedDec.toFixed(2),
    counted: countedDec.toFixed(2),
    variance: variance.toFixed(2),
    verdict: variance.isZero()
      ? "The box matches the book exactly."
      : `${over ? "Over" : "Short"} by ₱${variance.abs().toFixed(2)}.`,
    needsExplaining: variance.abs().greaterThan(dec(threshold)),
  };
}

export type DenominationLine = { denomination: number; count: number };

/** Notes and coins to a total, so a count can be keyed in the way it is counted. */
export function denominationTotal(lines: readonly DenominationLine[]): ReturnType<typeof dec> {
  return lines.reduce(
    (total, line) => total.plus(dec(line.denomination).times(Math.max(line.count, 0))),
    ZERO,
  );
}

/** Philippine notes and coins, largest first — the order a till is counted in. */
export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1] as const;
