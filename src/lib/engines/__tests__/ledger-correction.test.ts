import { describe, expect, it } from "vitest";
import { replay, type LedgerMovement } from "../inventory";
import {
  afterCorrection, balanceOf, correctionEntries, targetWithout,
} from "../ledger-correction";

/** The real case: a genuine purchase, then a zero-cost entry typed by mistake. */
const kikiam: LedgerMovement[] = [
  { qty: "230", unitCost: "2.1304" },
  { qty: "20", unitCost: "0" },
];

describe("undoing a mistaken ledger entry", () => {
  it("shows why the plain opposite is not enough", () => {
    const current = replay(kikiam);
    expect(current.qty.toFixed(0)).toBe("250");
    expect(current.avgUnitCost.toFixed(4)).toBe("1.9600");

    // the tempting fix: just take the 20 back out
    const naive = replay([...kikiam, { qty: "-20", unitCost: "1.96" }]);
    expect(naive.qty.toFixed(0)).toBe("230");
    // quantity is right, and the cost is still wrong — this is the trap
    expect(naive.avgUnitCost.toFixed(4)).toBe("1.9600");
  });

  it("restores both the quantity and the cost the purchase actually carried", () => {
    const current = replay(kikiam);
    const target = targetWithout(kikiam, 1);
    expect(target.qty.toFixed(0)).toBe("230");
    expect(target.avgUnitCost.toFixed(4)).toBe("2.1304");

    const plan = correctionEntries(current, target);
    const result = afterCorrection(current, plan);
    expect(result.qty.toFixed(0)).toBe("230");
    expect(result.avgUnitCost.toFixed(4)).toBe("2.1304");
  });

  it("clears and re-enters when the cost has to move, and says so", () => {
    const plan = correctionEntries(replay(kikiam), targetWithout(kikiam, 1));
    expect(plan).toHaveLength(2);
    expect(plan[0]!.qty).toBe("-250.0000");
    expect(plan[1]!.qty).toBe("230.0000");
    expect(plan[1]!.unitCost).toBe("2.1304");
  });

  it("uses a single movement when only the quantity is wrong", () => {
    const movements: LedgerMovement[] = [
      { qty: "100", unitCost: "5" },
      { qty: "20", unitCost: "5" },
    ];
    const plan = correctionEntries(replay(movements), targetWithout(movements, 1));
    expect(plan).toHaveLength(1);
    expect(plan[0]!.qty).toBe("-20.0000");
    expect(afterCorrection(replay(movements), plan).avgUnitCost.toFixed(4)).toBe("5.0000");
  });

  it("undoes an outbound entry too, putting the stock back", () => {
    const movements: LedgerMovement[] = [
      { qty: "100", unitCost: "5" },
      { qty: "-30", unitCost: "5" },
    ];
    const plan = correctionEntries(replay(movements), targetWithout(movements, 1));
    const result = afterCorrection(replay(movements), plan);
    expect(result.qty.toFixed(0)).toBe("100");
    expect(result.avgUnitCost.toFixed(4)).toBe("5.0000");
  });

  it("empties the balance when the mistake was the only entry", () => {
    const movements: LedgerMovement[] = [{ qty: "22", unitCost: "0" }];
    const plan = correctionEntries(replay(movements), targetWithout(movements, 0));
    const result = afterCorrection(replay(movements), plan);
    expect(result.qty.toFixed(0)).toBe("0");
  });

  it("does nothing when the entry changed nothing", () => {
    const movements: LedgerMovement[] = [{ qty: "100", unitCost: "5" }, { qty: "0", unitCost: "9" }];
    expect(correctionEntries(replay(movements), targetWithout(movements, 1))).toEqual([]);
  });

  it("always lands exactly on the target, over a spread of ledgers", () => {
    const ledgers: LedgerMovement[][] = [
      [{ qty: "500", unitCost: "1.25" }, { qty: "10", unitCost: "0" }],
      [{ qty: "40", unitCost: "3" }, { qty: "-15", unitCost: "3" }, { qty: "60", unitCost: "7" }],
      [{ qty: "80", unitCost: "2" }, { qty: "80", unitCost: "4" }, { qty: "-100", unitCost: "3" }],
    ];
    for (const ledger of ledgers) {
      for (let i = 0; i < ledger.length; i++) {
        const current = replay(ledger);
        const target = targetWithout(ledger, i);
        const result = afterCorrection(current, correctionEntries(current, target));
        expect(result.qty.toFixed(4)).toBe(target.qty.toFixed(4));
        // An empty balance is worth nothing whatever its average says, so that case
        // only has to match on quantity.
        if (!target.qty.isZero()) {
          expect(result.avgUnitCost.toFixed(4)).toBe(target.avgUnitCost.toFixed(4));
        }
      }
    }
  });

  it("treats a balance already at the target as needing nothing", () => {
    const state = balanceOf("10", "3");
    expect(correctionEntries(state, balanceOf("10", "3"))).toEqual([]);
  });

  it("handles undoing a receipt that a later issue already drew on", () => {
    // received 80, issued 100 — undoing the receipt leaves the branch owing 20
    const movements: LedgerMovement[] = [
      { qty: "80", unitCost: "2" },
      { qty: "80", unitCost: "4" },
      { qty: "-100", unitCost: "3" },
    ];
    const current = replay(movements);
    const target = targetWithout(movements, 0);
    expect(target.qty.toFixed(0)).toBe("-20");

    const result = afterCorrection(current, correctionEntries(current, target));
    expect(result.qty.toFixed(0)).toBe("-20");
    expect(result.avgUnitCost.toFixed(4)).toBe(target.avgUnitCost.toFixed(4));
  });
});
