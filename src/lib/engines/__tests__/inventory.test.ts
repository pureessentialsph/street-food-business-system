import { describe, expect, it } from "vitest";
import { dec } from "@/lib/money";
import { applyMovement, movementSummary, replay, stockValue, transferPair } from "../inventory";

const empty = { qty: dec(0), avgUnitCost: dec(0) };

describe("inventory — weighted average cost", () => {
  it("takes the incoming cost when there is nothing on hand", () => {
    const after = applyMovement(empty, { qty: 100, unitCost: "0.45" });
    expect(after.qty.toFixed(0)).toBe("100");
    expect(after.avgUnitCost.toFixed(4)).toBe("0.4500");
  });

  it("blends costs when stock arrives at a new price", () => {
    // 100 @ ₱0.45 then 100 @ ₱0.55 → 200 @ ₱0.50
    const first = applyMovement(empty, { qty: 100, unitCost: "0.45" });
    const second = applyMovement(first, { qty: 100, unitCost: "0.55" });
    expect(second.qty.toFixed(0)).toBe("200");
    expect(second.avgUnitCost.toFixed(4)).toBe("0.5000");
  });

  it("leaves the average alone when stock goes out", () => {
    const stocked = applyMovement(empty, { qty: 200, unitCost: "0.50" });
    const issued = applyMovement(stocked, { qty: -150, unitCost: "0.50" });
    expect(issued.qty.toFixed(0)).toBe("50");
    expect(issued.avgUnitCost.toFixed(4)).toBe("0.5000");
  });

  it("values stock at quantity times average cost", () => {
    const state = applyMovement(empty, { qty: 300, unitCost: "0.45" });
    expect(stockValue(state).toFixed(2)).toBe("135.00");
  });

  it("allows a negative balance rather than hiding one", () => {
    // A cart issued stock the system has not recorded receiving is a visible problem.
    const over = applyMovement(empty, { qty: -50, unitCost: "0.45" });
    expect(over.qty.toFixed(0)).toBe("-50");
  });
});

describe("inventory — replay and reconciliation", () => {
  it("replays a ledger to the same balance it was built from", () => {
    const movements = [
      { qty: 600, unitCost: "0.45" },
      { qty: -540, unitCost: "0.45" },
      { qty: -50, unitCost: "0.45" },
      { qty: -10, unitCost: "0.45" },
    ];
    const state = replay(movements);
    expect(state.qty.toFixed(0)).toBe("0");
  });

  it("summarises in, out and net for the beginning-plus-in-minus-out identity", () => {
    const summary = movementSummary([
      { qty: 400, unitCost: "0.45", type: "ISSUE_TO_VENDOR" },
      { qty: 200, unitCost: "0.45", type: "ISSUE_TO_VENDOR" },
      { qty: -540, unitCost: "0.45", type: "SALE_CONSUMPTION" },
      { qty: -50, unitCost: "0.45", type: "RETURN_FROM_VENDOR" },
      { qty: -10, unitCost: "0.45", type: "WASTE" },
    ]);
    expect(summary.inQty.toFixed(0)).toBe("600");
    expect(summary.outQty.toFixed(0)).toBe("600");
    expect(summary.netQty.toFixed(0)).toBe("0");
  });
});

describe("inventory — transfers", () => {
  it("pairs every movement so nothing evaporates in transit", () => {
    const { out, in: inbound } = transferPair(500, "0.45");
    expect(dec(out.qty).plus(dec(inbound.qty)).toFixed(0)).toBe("0");
  });

  it("refuses a zero or negative transfer", () => {
    expect(() => transferPair(0, "0.45")).toThrow();
    expect(() => transferPair(-10, "0.45")).toThrow();
  });
});
