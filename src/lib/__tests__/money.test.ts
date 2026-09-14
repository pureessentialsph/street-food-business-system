import { describe, expect, it } from "vitest";
import { dec, divide, formatPHP, formatPct, money, percentOf, sum } from "../money";

describe("money", () => {
  it("never loses centavos to float arithmetic", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in plain JS.
    expect(sum([0.1, 0.2]).equals(dec("0.3"))).toBe(true);
    expect(money("13.125").toFixed(2)).toBe("13.13"); // half-up, not banker's
    expect(money("13.135").toFixed(2)).toBe("13.14");
  });

  it("formats pesos the way the UI must always show them", () => {
    expect(formatPHP("1234.56")).toBe("₱1,234.56");
    expect(formatPHP(0)).toBe("₱0.00");
    expect(formatPHP("-5")).toBe("-₱5.00");
    expect(formatPHP("1234567.891")).toBe("₱1,234,567.89");
  });

  it("returns null instead of Infinity when dividing by zero", () => {
    expect(divide(10, 0)).toBeNull();
    expect(percentOf(275, 0)).toBeNull();
    expect(divide(10, 4)?.toFixed(2)).toBe("2.50");
  });

  it("computes sell-through as a percentage", () => {
    expect(percentOf(540, 600)?.toFixed(2)).toBe("90.00");
    expect(formatPct(percentOf(275, 300)!)).toBe("91.67%");
  });

  it("rejects non-finite input rather than storing NaN", () => {
    expect(() => dec(Number.NaN)).toThrow();
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow();
  });
});
