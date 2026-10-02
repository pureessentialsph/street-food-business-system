import { describe, expect, it } from "vitest";
import {
  DENOMINATIONS, DIRECTION, MANUAL_TYPES, TYPE_LABELS,
  balanceOf, countCash, denominationTotal, signedAmount, summarise,
  type CashMovementType, type Movement,
} from "../cash-book";

const move = (type: CashMovementType, amount: string | number): Movement => ({ type, amount });

describe("direction", () => {
  it("has a declared direction and a label for every type", () => {
    for (const type of Object.keys(DIRECTION) as CashMovementType[]) {
      expect(TYPE_LABELS[type]).toBeTruthy();
    }
    expect(Object.keys(TYPE_LABELS).sort()).toEqual(Object.keys(DIRECTION).sort());
  });

  it("takes money out of the box when it is banked, because the box is not the bank", () => {
    expect(DIRECTION.BANK_DEPOSIT).toBe(-1);
    expect(DIRECTION.BANK_WITHDRAWAL).toBe(1);
  });

  it("treats an owner's drawing as money out, not as an expense", () => {
    expect(DIRECTION.OWNER_DRAW).toBe(-1);
    expect(signedAmount(move("OWNER_DRAW", "500")).toFixed(2)).toBe("-500.00");
  });

  it("offers only hand-entered types for the form, never the posted ones", () => {
    expect(MANUAL_TYPES).not.toContain("SALES");
    expect(MANUAL_TYPES).not.toContain("EXPENSE");
    expect(MANUAL_TYPES).not.toContain("PAYROLL");
    expect(MANUAL_TYPES).not.toContain("COUNT_ADJUSTMENT");
    expect(MANUAL_TYPES).toContain("CAPITAL");
  });
});

describe("signedAmount", () => {
  it("ignores a sign typed into an outgoing amount rather than flipping it back", () => {
    expect(signedAmount(move("EXPENSE", "-120")).toFixed(2)).toBe("-120.00");
    expect(signedAmount(move("EXPENSE", "120")).toFixed(2)).toBe("-120.00");
  });

  it("ignores a sign typed into an incoming amount too", () => {
    expect(signedAmount(move("CAPITAL", "-10000")).toFixed(2)).toBe("10000.00");
  });

  it("lets a counted difference keep its own sign, since it goes either way", () => {
    expect(signedAmount(move("COUNT_ADJUSTMENT", "-50")).toFixed(2)).toBe("-50.00");
    expect(signedAmount(move("COUNT_ADJUSTMENT", "50")).toFixed(2)).toBe("50.00");
  });

  it("keeps centavos, because a cash book that rounds does not reconcile", () => {
    expect(signedAmount(move("SALES", "1246.3333")).toFixed(4)).toBe("1246.3333");
  });
});

describe("balanceOf", () => {
  it("is zero before anything happens", () => {
    expect(balanceOf([]).toFixed(2)).toBe("0.00");
  });

  it("adds capital and sales, and takes off wages and expenses", () => {
    const balance = balanceOf([
      move("CAPITAL", "10000"),
      move("SALES", "3176.33"),
      move("EXPENSE", "450"),
      move("PAYROLL", "1200"),
    ]);
    expect(balance.toFixed(2)).toBe("11526.33");
  });

  it("can go negative, which is a fact worth showing rather than clamping", () => {
    expect(balanceOf([move("CAPITAL", "100"), move("EXPENSE", "250")]).toFixed(2)).toBe("-150.00");
  });

  it("nets a reversal against the row it cancels", () => {
    // A reversal is the same type with the opposite effect, posted as its own row.
    const balance = balanceOf([
      move("CAPITAL", "5000"),
      move("OWNER_DRAW", "5000"),
    ]);
    expect(balance.toFixed(2)).toBe("0.00");
  });
});

describe("summarise", () => {
  const movements = [
    move("CAPITAL", "10000"),
    move("SALES", "650"),
    move("SALES", "1246.33"),
    move("EXPENSE", "450"),
    move("PAYROLL", "1200"),
  ];

  it("splits money in from money out, both as positive figures to read", () => {
    const summary = summarise(movements);
    expect(summary.in).toBe("11896.33");
    expect(summary.out).toBe("1650.00");
    expect(summary.balance).toBe("10246.33");
  });

  it("groups by type and counts the rows behind each total", () => {
    const sales = summarise(movements).byType.find((row) => row.type === "SALES");
    expect(sales).toEqual({ type: "SALES", label: "Sales remitted", amount: "1896.33", count: 2 });
  });

  it("puts the biggest mover first, whichever way it moved", () => {
    expect(summarise(movements).byType[0]!.type).toBe("CAPITAL");
  });

  it("says zero everywhere when nothing has happened", () => {
    expect(summarise([])).toEqual({ in: "0.00", out: "0.00", balance: "0.00", byType: [] });
  });
});

describe("countCash", () => {
  it("calls an exact match exact", () => {
    const outcome = countCash("5000", "5000");
    expect(outcome.variance).toBe("0.00");
    expect(outcome.verdict).toMatch(/matches the book exactly/);
    expect(outcome.needsExplaining).toBe(false);
  });

  it("says short, in pesos, when there is less in the box than the book says", () => {
    const outcome = countCash("5000", "4950");
    expect(outcome.variance).toBe("-50.00");
    expect(outcome.verdict).toBe("Short by ₱50.00.");
  });

  it("says over when there is more", () => {
    expect(countCash("5000", "5120").verdict).toBe("Over by ₱120.00.");
  });

  it("only asks for an explanation past the threshold", () => {
    expect(countCash("5000", "4995", "10").needsExplaining).toBe(false);
    expect(countCash("5000", "4985", "10").needsExplaining).toBe(true);
  });

  it("asks for an explanation of any difference when no threshold is set", () => {
    expect(countCash("5000", "4999.99").needsExplaining).toBe(true);
  });
});

describe("denominationTotal", () => {
  it("adds notes and coins the way a till is counted", () => {
    expect(denominationTotal([
      { denomination: 1000, count: 4 },
      { denomination: 100, count: 7 },
      { denomination: 20, count: 3 },
      { denomination: 1, count: 5 },
    ]).toFixed(2)).toBe("4765.00");
  });

  it("ignores a negative count rather than subtracting money that is not there", () => {
    expect(denominationTotal([{ denomination: 500, count: -2 }]).toFixed(2)).toBe("0.00");
  });

  it("is zero for an empty or untouched count", () => {
    expect(denominationTotal([]).toFixed(2)).toBe("0.00");
    expect(denominationTotal(DENOMINATIONS.map((d) => ({ denomination: d, count: 0 }))).toFixed(2))
      .toBe("0.00");
  });

  it("lists the peso denominations largest first", () => {
    expect([...DENOMINATIONS]).toEqual([...DENOMINATIONS].sort((a, b) => b - a));
    expect(DENOMINATIONS).toContain(1000);
    expect(DENOMINATIONS).toContain(1);
  });
});
