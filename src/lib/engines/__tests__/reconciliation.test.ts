import { describe, expect, it } from "vitest";
import { dec } from "@/lib/money";
import {
  reconcileLine, reconcileShift, totalIssued, validateClosing,
  type ReconciliationLineInput,
} from "../reconciliation";

/**
 * Golden test 11.2 (reconciliation half), to the centavo.
 *
 * Vendor Ana, fishball: 10 pieces a stick, ₱10.00 a stick, ₱0.45 a piece to make.
 * 400 issued, refilled +200, 50 returned, 10 wasted, ₱528.00 remitted.
 */
const fishball: ReconciliationLineInput = {
  productId: "fishball",
  productName: "Fishball",
  piecesIssued: 600,
  piecesReturned: 50,
  piecesWasted: 10,
  piecesPerStick: 10,
  pricePerStick: "10.00",
  unitCostPerPiece: "0.45",
};

describe("reconciliation — spec 11.2, Cart-012", () => {
  const result = reconcileShift({ cashRemitted: "528.00" }, [fishball]);

  it("derives 540 pieces sold from the count, not from a till", () => {
    expect(result.piecesSold.toFixed(0)).toBe("540");
  });

  it("reports 54.0 sticks without flooring", () => {
    expect(result.lines[0]!.sticksSold.toFixed(1)).toBe("54.0");
  });

  it("nets ₱540.00 of sales", () => {
    expect(result.netSales.toFixed(2)).toBe("540.00");
  });

  it("expects ₱540.00 in cash and finds ₱12.00 short", () => {
    expect(result.expectedCash.toFixed(2)).toBe("540.00");
    expect(result.cashVariance.toFixed(2)).toBe("-12.00");
    expect(result.isShort).toBe(true);
  });

  it("does not dispute a ₱12 shortage against a ₱100 threshold", () => {
    expect(result.isDisputed).toBe(false);
  });

  it("costs ₱243.00 of goods and ₱4.50 of waste", () => {
    expect(result.cogs.toFixed(2)).toBe("243.00");
    expect(result.wasteCost.toFixed(2)).toBe("4.50");
  });

  it("keeps wastage out of COGS so margins stay comparable", () => {
    // ₱540.00 − ₱243.00. The ₱4.50 of waste is an operating expense (spec §15.8).
    expect(result.grossProfit.toFixed(2)).toBe("297.00");
  });

  it("sells through 90% of what was issued", () => {
    expect(result.sellThroughPct?.toFixed(2)).toBe("90.00");
  });
});

describe("reconciliation — cash", () => {
  it("expects less cash when some of it came in digitally", () => {
    const result = reconcileShift(
      { cashRemitted: "400.00", digitalSales: "140.00" },
      [fishball],
    );
    expect(result.expectedCash.toFixed(2)).toBe("400.00");
    expect(result.cashVariance.toFixed(2)).toBe("0.00");
  });

  it("disputes a shortage past the threshold and blocks payroll", () => {
    const result = reconcileShift({ cashRemitted: "400.00" }, [fishball]);
    expect(result.cashVariance.toFixed(2)).toBe("-140.00");
    expect(result.isDisputed).toBe(true);
  });

  it("flags an overage as disputed too — extra cash is also unexplained", () => {
    const result = reconcileShift({ cashRemitted: "700.00" }, [fishball]);
    expect(result.cashVariance.isPositive()).toBe(true);
    expect(result.isDisputed).toBe(true);
  });

  it("takes discounts off the cash the vendor owes", () => {
    const result = reconcileShift(
      { cashRemitted: "520.00" },
      [{ ...fishball, discountAmount: "20.00" }],
    );
    expect(result.netSales.toFixed(2)).toBe("520.00");
    expect(result.cashVariance.toFixed(2)).toBe("0.00");
  });
});

describe("reconciliation — pieces, not sticks", () => {
  it("prices leftover pieces exactly, with no rounding into or out of a peso", () => {
    // 543 pieces is 54.3 sticks — the 3 spare fishballs are still ₱3.00 of sales.
    const result = reconcileShift({ cashRemitted: "543.00" }, [
      { ...fishball, piecesIssued: 543, piecesReturned: 0, piecesWasted: 0 },
    ]);
    expect(result.netSales.toFixed(2)).toBe("543.00");
    expect(result.lines[0]!.sticksSold.toFixed(1)).toBe("54.3");
  });

  it("handles products with different pieces per stick in one shift", () => {
    const result = reconcileShift({ cashRemitted: "1000.00" }, [
      { ...fishball, piecesIssued: 200, piecesReturned: 0, piecesWasted: 0 },
      { productId: "kwek", productName: "Kwek-kwek", piecesIssued: 200, piecesReturned: 0,
        piecesWasted: 0, piecesPerStick: 4, pricePerStick: "15.00", unitCostPerPiece: "2.32" },
    ]);
    // 200 fishball = 20 sticks × ₱10 = ₱200; 200 kwek-kwek = 50 sticks × ₱15 = ₱750.
    expect(result.netSales.toFixed(2)).toBe("950.00");
  });
});

describe("reconciliation — validation", () => {
  it("rejects returns plus waste exceeding what was issued", () => {
    const issues = validateClosing([{ ...fishball, piecesReturned: 600, piecesWasted: 10 }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("more than the 600 issued");
  });

  it("rejects negative counts", () => {
    const issues = validateClosing([{ ...fishball, piecesReturned: -5 }]);
    expect(issues[0]!.message).toContain("cannot be negative");
  });

  it("demands a reason when wastage is over 10% of what was issued", () => {
    const issues = validateClosing([{ ...fishball, piecesWasted: 120 }]);
    expect(issues[0]!.field).toBe("wasteReason");
    expect(issues[0]!.message).toContain("over 10%");
  });

  it("accepts heavy wastage once it is explained", () => {
    const issues = validateClosing([
      { ...fishball, piecesWasted: 120, wasteReason: "Fryer broke down at 3pm" },
    ]);
    expect(issues).toHaveLength(0);
  });

  it("reports every problem at once rather than one at a time", () => {
    const issues = validateClosing([
      { ...fishball, piecesReturned: 700 },
      { ...fishball, productId: "kwek", productName: "Kwek-kwek", piecesWasted: 200 },
    ]);
    expect(issues).toHaveLength(2);
  });

  it("throws rather than silently inventing negative sales", () => {
    expect(() => reconcileLine({ ...fishball, piecesReturned: 700 })).toThrow();
  });
});

describe("reconciliation — issues and refills", () => {
  it("totals the morning load-out and every refill into one issued figure", () => {
    const totals = totalIssued([
      { lines: [{ productId: "fishball", qtyPieces: 400 }] },
      { lines: [{ productId: "fishball", qtyPieces: 200 }] },
    ]);
    expect(dec(totals.get("fishball")!).toFixed(0)).toBe("600");
  });
});
