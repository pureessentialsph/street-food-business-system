import Decimal from "decimal.js";

// Half-up, because that is how a cash drawer and a payslip round (spec §3 rule 1).
Decimal.set({ rounding: Decimal.ROUND_HALF_UP, precision: 28 });

export type Numeric = Decimal | number | string | bigint | { toString(): string };

/** Build a Decimal from anything the DB or a form hands us. Never use floats for money. */
export function dec(value: Numeric | null | undefined): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  if (value instanceof Decimal) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number: ${value}`);
    return new Decimal(value);
  }
  return new Decimal(value.toString());
}

export const ZERO = new Decimal(0);

export function sum(values: Numeric[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), ZERO);
}

/** Round to 2 decimals — display and payroll settlement only, never mid-calculation. */
export function money(value: Numeric): Decimal {
  return dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Quantities keep 4 decimals in storage; sticks are the only fractional quantity we show. */
export function qty(value: Numeric, places = 4): Decimal {
  return dec(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}

/** `₱1,234.56` — the only money format in the UI (spec §13). */
export function formatPHP(value: Numeric): string {
  const d = money(value);
  const negative = d.isNegative();
  const [whole = "0", frac = "00"] = d.abs().toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}₱${grouped}.${frac}`;
}

export function formatPct(value: Numeric, places = 2): string {
  return `${dec(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places)}%`;
}

/** Safe division: returns null instead of Infinity when the divisor is zero. */
export function divide(numerator: Numeric, denominator: Numeric): Decimal | null {
  const d = dec(denominator);
  if (d.isZero()) return null;
  return dec(numerator).dividedBy(d);
}

export function percentOf(part: Numeric, whole: Numeric): Decimal | null {
  const ratio = divide(part, whole);
  return ratio === null ? null : ratio.times(100);
}

export { Decimal };
