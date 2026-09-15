import { describe, expect, it } from "vitest";
import {
  buildBreakdown, costPerPiece, costPerStick, lineCost, margin,
  perBatchTotal, setEconomics, type CostingRecipe,
} from "../costing";

/**
 * Golden test 11.1 from the spec, to the centavo. If this drifts, every margin,
 * every COGS figure and every profit report in the system is wrong.
 */
const kwekKwek: CostingRecipe = {
  batchYieldPieces: 200,
  lines: [
    { ingredientId: "egg", ingredientName: "Quail egg", qtyInBaseUnit: 200, costPerBaseUnit: "1.20", wastagePct: 0, allocationBasis: "PER_BATCH", componentType: "RAW" },
    { ingredientId: "flour", ingredientName: "Flour", qtyInBaseUnit: 500, costPerBaseUnit: "0.06", wastagePct: 0, allocationBasis: "PER_BATCH", componentType: "RAW" },
    { ingredientId: "starch", ingredientName: "Cornstarch", qtyInBaseUnit: 200, costPerBaseUnit: "0.08", wastagePct: 0, allocationBasis: "PER_BATCH", componentType: "RAW" },
    { ingredientId: "season", ingredientName: "Seasoning", qtyInBaseUnit: 50, costPerBaseUnit: "0.20", wastagePct: 0, allocationBasis: "PER_BATCH", componentType: "RAW" },
    { ingredientId: "colour", ingredientName: "Food colouring", qtyInBaseUnit: 1, costPerBaseUnit: "5.00", wastagePct: 0, allocationBasis: "PER_BATCH", componentType: "RAW" },
    { ingredientId: "oil", ingredientName: "Cooking oil", qtyInBaseUnit: 1, costPerBaseUnit: "0.35", wastagePct: 0, allocationBasis: "PER_PIECE", componentType: "OIL" },
    { ingredientId: "pack", ingredientName: "Cup and stick", qtyInBaseUnit: 1, costPerBaseUnit: "0.80", wastagePct: 0, allocationBasis: "PER_STICK", componentType: "PACKAGING" },
    { ingredientId: "sauce", ingredientName: "Sauce", qtyInBaseUnit: 1, costPerBaseUnit: "1.20", wastagePct: 0, allocationBasis: "PER_STICK", componentType: "CONDIMENT" },
  ],
};

describe("costing — spec 11.1, kwek-kwek", () => {
  it("totals the per-batch lines at ₱301.00", () => {
    expect(perBatchTotal(kwekKwek).toFixed(2)).toBe("301.00");
  });

  it("costs a piece at ₱1.8550 — batch spread plus the oil it is fried in", () => {
    expect(costPerPiece(kwekKwek).toFixed(4)).toBe("1.8550");
  });

  it("costs a 4-piece stick at ₱9.4200", () => {
    // 1.8550 × 4 = 7.42, plus ₱0.80 packaging and ₱1.20 sauce charged once per stick.
    expect(costPerStick(kwekKwek, 4).toFixed(4)).toBe("9.4200");
  });

  it("earns ₱5.58 a stick at ₱15.00 — a 37.20% margin", () => {
    const { grossProfit, marginPct } = margin("15.00", costPerStick(kwekKwek, 4));
    expect(grossProfit.toFixed(4)).toBe("5.5800");
    expect(marginPct?.toFixed(2)).toBe("37.20");
  });

  it("matches the spec's 6-piece serving figure of ₱13.13", () => {
    // The spec's original worked example used a 6-piece serving before the owner
    // confirmed 4 pieces per kwek-kwek stick. Same engine, same answer.
    expect(costPerStick(kwekKwek, 6).toFixed(4)).toBe("13.1300");
  });
});

describe("costing — allocation bases", () => {
  it("spreads PER_BATCH over the yield, but never PER_STICK", () => {
    const halfYield: CostingRecipe = { ...kwekKwek, batchYieldPieces: 100 };
    // Doubling the per-piece share of the batch: 301/100 + 0.35 = 3.36
    expect(costPerPiece(halfYield).toFixed(4)).toBe("3.3600");
    // Packaging and sauce are unchanged — they are charged per stick sold.
    expect(costPerStick(halfYield, 4).toFixed(4)).toBe("15.4400");
  });

  it("charges PER_PIECE oil for every piece on the stick", () => {
    const noOil: CostingRecipe = {
      ...kwekKwek,
      lines: kwekKwek.lines.filter((l) => l.allocationBasis !== "PER_PIECE"),
    };
    // Dropping ₱0.35/piece saves ₱1.40 on a 4-piece stick.
    expect(costPerStick(kwekKwek, 4).minus(costPerStick(noOil, 4)).toFixed(4)).toBe("1.4000");
  });

  it("refuses a zero batch yield instead of dividing by zero", () => {
    expect(() => costPerPiece({ ...kwekKwek, batchYieldPieces: 0 })).toThrow();
  });
});

describe("costing — wastage", () => {
  it("adds the wastage allowance on top of the line", () => {
    const line = {
      ingredientId: "egg", ingredientName: "Quail egg", qtyInBaseUnit: 200,
      costPerBaseUnit: "1.20", wastagePct: "0.05",
      allocationBasis: "PER_BATCH" as const, componentType: "RAW" as const,
    };
    // 240 × 1.05 — five per cent of quail eggs crack before they are cooked.
    expect(lineCost(line).toFixed(4)).toBe("252.0000");
  });

  it("reports wastage separately so spillage is visible, not buried", () => {
    const withWastage: CostingRecipe = {
      ...kwekKwek,
      lines: kwekKwek.lines.map((l) =>
        l.ingredientId === "egg" ? { ...l, wastagePct: "0.05" } : l),
    };
    const breakdown = buildBreakdown(withWastage, 4);
    // ₱12 of cracked eggs over a 200-piece batch, on a 4-piece stick.
    expect(breakdown.wastageCost).toBe("0.2400");
    expect(breakdown.costPerStick).toBe("9.6600");
  });
});

describe("costing — the cost card", () => {
  const breakdown = buildBreakdown(kwekKwek, 4);

  it("attributes every centavo of the stick to a component type", () => {
    const { RAW, OIL, PACKAGING, CONDIMENT, CONSUMABLE } = breakdown.byComponent;
    expect(RAW).toBe("6.0200");        // 301/200 × 4
    expect(OIL).toBe("1.4000");        // 0.35 × 4
    expect(PACKAGING).toBe("0.8000");
    expect(CONDIMENT).toBe("1.2000");
    expect(CONSUMABLE).toBe("0.0000");

    const total = [RAW, OIL, PACKAGING, CONDIMENT, CONSUMABLE]
      .reduce((acc, v) => acc + Number(v), 0);
    expect(total.toFixed(4)).toBe(Number(breakdown.costPerStick).toFixed(4));
  });

  it("explains each line's contribution to one stick", () => {
    const egg = breakdown.lines.find((l) => l.ingredientId === "egg");
    expect(egg?.totalCost).toBe("240.0000");
    expect(egg?.perStick).toBe("4.8000"); // 240 / 200 × 4
    const sauce = breakdown.lines.find((l) => l.ingredientId === "sauce");
    expect(sauce?.perStick).toBe("1.2000"); // once per stick, whatever the piece count
  });
});

describe("costing — set economics", () => {
  it("prices one full standard set", () => {
    // 50 sticks each of five products, using the spec's kwek-kwek cost for all of them
    // so the arithmetic is checkable by hand.
    const components = Array.from({ length: 5 }, () => ({
      costPerStick: "9.42", pricePerStick: "15.00", requiredSticks: 50,
    }));
    const { cost, revenue, grossProfit, marginPct } = setEconomics(components);
    expect(cost.toFixed(2)).toBe("2355.00");      // 9.42 × 250
    expect(revenue.toFixed(2)).toBe("3750.00");   // 15.00 × 250
    expect(grossProfit.toFixed(2)).toBe("1395.00");
    expect(marginPct?.toFixed(2)).toBe("37.20");
  });
});
