import { describe, expect, it } from "vitest";
import { costPerBaseUnit, newAverageCost, replenish, roundUpToPack } from "../replenishment";

/** Golden test 11.5 from the spec, in pieces. */
const fishballAtCart = {
  itemName: "Fishball",
  onHand: 600,
  soldInWindow: 7000,
  activeDays: 14,
  leadTimeDays: 2,
  safetyStock: 1000,
  coverDays: 7,
  packSize: 250,
};

describe("replenishment — spec 11.5", () => {
  const result = replenish(fishballAtCart);

  it("averages 500 a day over the trading days", () => {
    expect(result.avgDailyUsage.toFixed(0)).toBe("500");
  });

  it("sets the reorder point at 2,000 and triggers on 600 on hand", () => {
    expect(result.reorderPoint.toFixed(0)).toBe("2000");
    expect(result.triggered).toBe(true);
  });

  it("reports 1.2 days of cover", () => {
    expect(result.daysOfCover?.toFixed(1)).toBe("1.2");
  });

  it("suggests 5,000 — 4,900 needed, rounded up to the 250 pack", () => {
    expect(result.suggestedQty.toFixed(0)).toBe("5000");
  });

  it("explains itself in words the owner can judge", () => {
    expect(result.reason).toBe(
      "Projected to run out in about 1.2 days at 500 a day (600 on hand, 2-day lead time). Recommended order: 5,000.",
    );
  });
});

describe("replenishment — the arithmetic", () => {
  it("divides by trading days, not calendar days", () => {
    // 7,000 sold over 10 trading days is 700 a day, not 500.
    const result = replenish({ ...fishballAtCart, activeDays: 10 });
    expect(result.avgDailyUsage.toFixed(0)).toBe("700");
  });

  it("subtracts what is already on order", () => {
    const result = replenish({ ...fishballAtCart, onOrder: 2000 });
    // 4,900 − 2,000 = 2,900 → rounded up to the 250 pack = 3,000
    expect(result.suggestedQty.toFixed(0)).toBe("3000");
    expect(result.reason).toContain("2,000 is already on order");
  });

  it("suggests nothing when there is plenty on hand", () => {
    const result = replenish({ ...fishballAtCart, onHand: 8000 });
    expect(result.suggestedQty.toFixed(0)).toBe("0");
    expect(result.triggered).toBe(false);
  });

  it("flags overstock on more than a month of cover", () => {
    const result = replenish({ ...fishballAtCart, onHand: 20000 });
    expect(result.overstocked).toBe(true);
    expect(result.reason).toContain("more than a month");
  });

  it("suggests nothing for an item that has not sold, even below safety stock", () => {
    // 600 on hand against 1,000 safety stock: the bare formula would top it up, which
    // is buying stock that does not move. No demand, no order.
    const result = replenish({ ...fishballAtCart, soldInWindow: 0 });
    expect(result.avgDailyUsage.toFixed(0)).toBe("0");
    expect(result.suggestedQty.toFixed(0)).toBe("0");
    expect(result.triggered).toBe(false);
    expect(result.daysOfCover).toBeNull();
    expect(result.reason).toContain("has not sold in this window");
  });

  it("handles a location with no trading days without dividing by zero", () => {
    const result = replenish({ ...fishballAtCart, activeDays: 0, soldInWindow: 0 });
    expect(result.avgDailyUsage.toFixed(0)).toBe("0");
    expect(result.suggestedQty.toFixed(0)).toBe("0");
  });

  it("says 'out of stock' rather than negative days of cover", () => {
    // A negative balance means a receipt or production batch was never recorded.
    // "Runs out in −1.5 days" would be nonsense to whoever reads the order list.
    const result = replenish({ ...fishballAtCart, onHand: -300, soldInWindow: 1200, activeDays: 6 });
    expect(result.reason).toContain("is out of stock");
    expect(result.reason).toContain("300 more went out than came in");
    expect(result.reason).not.toContain("-1.5");
    expect(result.suggestedQty.greaterThan(0)).toBe(true);
  });

  it("rounds up to whole packs, never down", () => {
    expect(roundUpToPack(4900, 250).toFixed(0)).toBe("5000");
    expect(roundUpToPack(5000, 250).toFixed(0)).toBe("5000");
    expect(roundUpToPack(1, 250).toFixed(0)).toBe("250");
    expect(roundUpToPack("10.2", 1).toFixed(0)).toBe("11");
  });
});

describe("replenishment — cost on receipt", () => {
  it("blends the new price into what is on hand", () => {
    // 100 @ ₱1.20 plus 100 @ ₱1.50 → ₱1.35
    expect(newAverageCost(100, "1.20", 100, "1.50").toFixed(4)).toBe("1.3500");
  });

  it("takes the new price outright when nothing is on hand", () => {
    expect(newAverageCost(0, "1.20", 300, "1.50").toFixed(4)).toBe("1.5000");
  });

  it("does not blend a negative balance's phantom cost", () => {
    expect(newAverageCost(-50, "1.20", 300, "1.50").toFixed(4)).toBe("1.5000");
  });

  it("converts a supplier's pack price to cost per base unit", () => {
    // A ₱360 tray of 300 quail eggs is ₱1.20 an egg.
    expect(costPerBaseUnit("360", 300).toFixed(4)).toBe("1.2000");
    // A ₱1,500 sack of 25 kg is ₱0.06 a gram.
    expect(costPerBaseUnit("1500", 25000).toFixed(4)).toBe("0.0600");
  });

  it("refuses a zero conversion rather than dividing by zero", () => {
    expect(() => costPerBaseUnit("360", 0)).toThrow();
  });
});
