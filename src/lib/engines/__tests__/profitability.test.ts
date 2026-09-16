import { describe, expect, it } from "vitest";
import { dec, sum } from "@/lib/money";
import { allocateOverhead, profitAndLoss, rank, strongSalesWeakProfit } from "../profitability";

describe("profitability — the P&L ladder", () => {
  const result = profitAndLoss({
    netSales: "1415.00",
    cogs: "353.50",
    labourCost: "538.00",
    wasteCost: "5.47",
    directExpenses: "120.00",
  });

  it("takes gross profit as net sales minus COGS", () => {
    expect(result.grossProfit.toFixed(2)).toBe("1061.50");
    expect(result.grossMarginPct?.toFixed(2)).toBe("75.02");
  });

  it("subtracts labour, wastage and direct expenses to reach operating profit", () => {
    // 1061.50 − 538.00 − 5.47 − 120.00
    expect(result.operatingProfit.toFixed(2)).toBe("398.03");
  });

  it("keeps wastage below gross profit so product margins stay comparable", () => {
    const withoutWaste = profitAndLoss({
      netSales: "1415.00", cogs: "353.50", labourCost: "538.00",
      wasteCost: "0", directExpenses: "120.00",
    });
    // Gross profit is identical; only operating profit moves.
    expect(withoutWaste.grossProfit.toFixed(2)).toBe(result.grossProfit.toFixed(2));
    expect(withoutWaste.operatingProfit.minus(result.operatingProfit).toFixed(2)).toBe("5.47");
  });

  it("reaches net profit once overhead is allocated", () => {
    const withOverhead = profitAndLoss({
      netSales: "1415.00", cogs: "353.50", labourCost: "538.00",
      wasteCost: "5.47", directExpenses: "120.00", allocatedOverhead: "98.03",
    });
    expect(withOverhead.netProfit.toFixed(2)).toBe("300.00");
  });

  it("reports a loss rather than hiding one", () => {
    const loss = profitAndLoss({
      netSales: "500.00", cogs: "200.00", labourCost: "500.00",
      wasteCost: "20.00", directExpenses: "50.00",
    });
    expect(loss.operatingProfit.toFixed(2)).toBe("-270.00");
    expect(loss.operatingMarginPct?.toFixed(2)).toBe("-54.00");
  });

  it("returns null margins instead of dividing by zero on a day with no sales", () => {
    const quiet = profitAndLoss({
      netSales: "0", cogs: "0", labourCost: "500.00", wasteCost: "0", directExpenses: "0",
    });
    expect(quiet.grossMarginPct).toBeNull();
    expect(quiet.operatingProfit.toFixed(2)).toBe("-500.00");
  });
});

describe("profitability — overhead allocation", () => {
  const carts = [
    { id: "a", netSales: "5000" },
    { id: "b", netSales: "3000" },
    { id: "c", netSales: "2000" },
  ];

  it("splits overhead by share of sales", () => {
    const allocation = allocateOverhead("1000", carts);
    expect(allocation.get("a")?.toFixed(2)).toBe("500.00");
    expect(allocation.get("b")?.toFixed(2)).toBe("300.00");
    expect(allocation.get("c")?.toFixed(2)).toBe("200.00");
  });

  it("never loses a centavo to rounding", () => {
    const allocation = allocateOverhead("1000", [
      { id: "a", netSales: "1" }, { id: "b", netSales: "1" }, { id: "c", netSales: "1" },
    ]);
    expect(sum([...allocation.values()]).toFixed(2)).toBe("1000.00");
  });

  it("charges nothing to a cart that did not trade", () => {
    const allocation = allocateOverhead("1000", [
      { id: "a", netSales: "5000" }, { id: "idle", netSales: "0" },
    ]);
    expect(allocation.get("idle")?.toFixed(2)).toBe("0.00");
    expect(allocation.get("a")?.toFixed(2)).toBe("1000.00");
  });

  it("allocates nothing when nobody sold anything", () => {
    const allocation = allocateOverhead("1000", [
      { id: "a", netSales: "0" }, { id: "b", netSales: "0" },
    ]);
    expect(sum([...allocation.values()]).toFixed(2)).toBe("0.00");
  });
});

describe("profitability — finding the problems", () => {
  it("ranks best and worst by any metric", () => {
    const carts = [
      { id: "a", profit: "100" }, { id: "b", profit: "300" }, { id: "c", profit: "-50" },
    ];
    expect(rank(carts, (c) => c.profit).map((c) => c.id)).toEqual(["b", "a", "c"]);
    expect(rank(carts, (c) => c.profit, "worst").map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("surfaces carts that sell well but keep little", () => {
    const flagged = strongSalesWeakProfit([
      { id: "busy-thin", name: "Recto", netSales: "8000", operatingProfit: "400" },   // 5%
      { id: "busy-fat", name: "Divisoria", netSales: "8000", operatingProfit: "2400" }, // 30%
      { id: "quiet-thin", name: "Concepcion", netSales: "500", operatingProfit: "10" }, // low sales
    ]);
    expect(flagged.map((f) => f.id)).toEqual(["busy-thin"]);
    expect(flagged[0]!.marginPct.toFixed(2)).toBe("5.00");
  });
});
