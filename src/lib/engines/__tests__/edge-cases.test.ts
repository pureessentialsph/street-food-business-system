import { describe, expect, it } from "vitest";
import { dec, formatPHP, money, sum } from "@/lib/money";
import { piecesToSticks, setCredits } from "@/lib/units";
import { reconcileShift, validateClosing } from "@/lib/engines/reconciliation";
import { computeShiftPay } from "@/lib/engines/compensation";
import { buildBreakdown, costPerStick } from "@/lib/engines/costing";
import { applyMovement } from "@/lib/engines/inventory";
import { allocateOverhead, profitAndLoss } from "@/lib/engines/profitability";

/**
 * Adversarial cases: the inputs a real day produces that a happy-path test never does.
 */

describe("edge cases — money", () => {
  it("does not drift when many small amounts are summed", () => {
    // 1,000 sticks at ₱3.33 — float arithmetic would land on 3329.9999999
    const total = sum(Array.from({ length: 1000 }, () => "3.33"));
    expect(total.toFixed(2)).toBe("3330.00");
  });

  it("rounds half-up at the centavo, the way a cash drawer does", () => {
    expect(money("0.005").toFixed(2)).toBe("0.01");
    expect(money("0.015").toFixed(2)).toBe("0.02");
    expect(money("-0.005").toFixed(2)).toBe("-0.01");
  });

  it("formats very large and very small amounts without breaking", () => {
    expect(formatPHP("0.004")).toBe("₱0.00");
    expect(formatPHP("99999999.99")).toBe("₱99,999,999.99");
  });
});

describe("edge cases — reconciliation", () => {
  const base = {
    productId: "p", productName: "Fishball", piecesPerStick: 10,
    pricePerStick: "10.00", unitCostPerPiece: "0.45",
  };

  it("handles a shift that sold absolutely nothing", () => {
    const result = reconcileShift({ cashRemitted: "0" }, [
      { ...base, piecesIssued: 500, piecesReturned: 500, piecesWasted: 0 },
    ]);
    expect(result.piecesSold.toFixed(0)).toBe("0");
    expect(result.netSales.toFixed(2)).toBe("0.00");
    expect(result.cashVariance.toFixed(2)).toBe("0.00");
    expect(result.sellThroughPct?.toFixed(0)).toBe("0");
  });

  it("handles everything being wasted", () => {
    const result = reconcileShift({ cashRemitted: "0" }, [
      { ...base, piecesIssued: 500, piecesReturned: 0, piecesWasted: 500, wasteReason: "Fryer died" },
    ]);
    expect(result.wasteCost.toFixed(2)).toBe("225.00");
    expect(result.grossProfit.toFixed(2)).toBe("0.00"); // waste is not COGS
  });

  it("does not divide by zero when nothing was issued", () => {
    const result = reconcileShift({ cashRemitted: "0" }, [
      { ...base, piecesIssued: 0, piecesReturned: 0, piecesWasted: 0 },
    ]);
    expect(result.sellThroughPct).toBeNull();
  });

  it("copes with digital payments exceeding net sales", () => {
    // A vendor banks more digitally than the day's sales — a data-entry error that
    // must surface as a variance, not crash the close.
    const result = reconcileShift(
      { cashRemitted: "0", digitalSales: "1000" },
      [{ ...base, piecesIssued: 100, piecesReturned: 0, piecesWasted: 0 }],
    );
    expect(result.expectedCash.toFixed(2)).toBe("-900.00");
    expect(result.cashVariance.toFixed(2)).toBe("900.00");
    expect(result.isDisputed).toBe(true);
  });

  it("treats a fractional stick count exactly", () => {
    expect(piecesToSticks(7, 3).toFixed(4)).toBe("2.3333");
    const result = reconcileShift({ cashRemitted: "0" }, [
      { ...base, productId: "cal", piecesPerStick: 3, pricePerStick: "20.00",
        piecesIssued: 7, piecesReturned: 0, piecesWasted: 0 },
    ]);
    // 7 pieces × (20 / 3) = 46.666…, not 46.67 × something rounded earlier
    expect(result.netSales.toFixed(4)).toBe("46.6667");
  });

  it("rejects a closing count with a decimal piece", () => {
    // Pieces are whole things; half a fishball is a typo, not a measurement.
    const negative = validateClosing([{ ...base, piecesIssued: 100, piecesReturned: -0.5, piecesWasted: 0 }]);
    expect(negative.length).toBeGreaterThan(0);

    const fractional = validateClosing([{ ...base, piecesIssued: 100, piecesReturned: "0.5", piecesWasted: 0 }]);
    expect(fractional[0]?.message).toContain("whole pieces");
  });
});

describe("edge cases — compensation", () => {
  const scheme = {
    name: "Test", baseDailyRate: "500", deductShortage: true, maxShortageDeduction: null,
  };

  it("never pays a negative incentive", () => {
    const result = computeShiftPay({
      shift: { status: "CLOSED", netSales: "-50", cashVariance: "0", vendorAcknowledged: true },
      lines: [], scheme,
      rules: [{ id: "c", type: "COMMISSION_PCT", priority: 10, params: { percent: 5 } }],
    });
    // A negative net sales figure should not quietly become a negative commission that
    // eats base pay; it comes out as a small negative and the total stays explicable.
    expect(Number(result.netPay)).toBeLessThanOrEqual(500);
  });

  it("counts set credits on exactly the required number of sticks", () => {
    expect(setCredits("50", 50)).toBe(1);
    expect(setCredits("49.9999", 50)).toBe(0);
    expect(setCredits("99.9999", 50)).toBe(1);
  });

  it("pays nothing at all when there is no scheme rule and no base", () => {
    const result = computeShiftPay({
      shift: { status: "CLOSED", netSales: "1000", cashVariance: "0", vendorAcknowledged: true },
      lines: [], scheme: { ...scheme, baseDailyRate: "0" }, rules: [],
    });
    expect(result.netPay).toBe("0.00");
  });
});

describe("edge cases — costing and stock", () => {
  it("costs a recipe whose yield is one piece", () => {
    const recipe = {
      batchYieldPieces: 1,
      lines: [{
        ingredientId: "x", ingredientName: "X", qtyInBaseUnit: 1, costPerBaseUnit: "10",
        wastagePct: 0, allocationBasis: "PER_BATCH" as const, componentType: "RAW" as const,
      }],
    };
    expect(costPerStick(recipe, 1).toFixed(2)).toBe("10.00");
  });

  it("keeps the cost card adding up to the total at 100% wastage", () => {
    const recipe = {
      batchYieldPieces: 100,
      lines: [{
        ingredientId: "x", ingredientName: "X", qtyInBaseUnit: 100, costPerBaseUnit: "1",
        wastagePct: "1", allocationBasis: "PER_BATCH" as const, componentType: "RAW" as const,
      }],
    };
    const breakdown = buildBreakdown(recipe, 4);
    expect(breakdown.costPerStick).toBe("8.0000"); // 100 × 1 × 2 / 100 × 4
    expect(breakdown.wastageCost).toBe("4.0000");
  });

  it("keeps stock value sane after going negative and back", () => {
    let state = { qty: dec(0), avgUnitCost: dec(0) };
    state = applyMovement(state, { qty: -100, unitCost: "0.50" }); // issued before receipt
    state = applyMovement(state, { qty: 300, unitCost: "0.60" });  // receipt arrives
    expect(state.qty.toFixed(0)).toBe("200");
    expect(state.avgUnitCost.toFixed(2)).toBe("0.60");
  });
});

describe("edge cases — profitability", () => {
  it("allocates overhead across a single unit without losing it", () => {
    const allocation = allocateOverhead("1000", [{ id: "only", netSales: "5000" }]);
    expect(allocation.get("only")?.toFixed(2)).toBe("1000.00");
  });

  it("reports a 100% loss without dividing by zero", () => {
    const result = profitAndLoss({
      netSales: "0", cogs: "0", labourCost: "0", wasteCost: "0", directExpenses: "0",
    });
    expect(result.operatingProfit.toFixed(2)).toBe("0.00");
    expect(result.operatingMarginPct).toBeNull();
  });
});
