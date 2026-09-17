import { describe, expect, it } from "vitest";
import {
  aggregatePay, computeShiftPay,
  type CompensationRule, type PayLineInput, type PaySchemeInput, type SetDefinitionInput,
} from "../compensation";

const scheme: PaySchemeInput = {
  name: "Daily Rate + Set Incentive",
  baseDailyRate: "500",
  deductShortage: true,
  maxShortageDeduction: null, // uncapped, per the owner
};

const setRule: CompensationRule = {
  id: "r1", type: "SET_COMPLETION", priority: 10, params: {},
};

/** The owner's standard set: 50 sticks each of five products, ₱250 a set. */
function standardSet(
  mode: SetDefinitionInput["completionMode"] = "PER_COMPONENT",
  maxSetsPerComponent: number | null = null,
): SetDefinitionInput {
  return {
    code: "STD-SET",
    incentiveAmount: "250",
    completionMode: mode,
    maxSetsPerComponent,
    components: [
      { productId: "kwek", productName: "Kwek-kwek", requiredSticks: 50 },
      { productId: "calamares", productName: "Calamares", requiredSticks: 50 },
      { productId: "squidball", productName: "Squidball", requiredSticks: 50 },
      { productId: "fishball", productName: "Fishball", requiredSticks: 50 },
      { productId: "kikiam", productName: "Kikiam (big)", requiredSticks: 50 },
    ],
  };
}

/** Spec 11.6: four components sold through, fishball only 30 sticks. */
const lopsidedDay: PayLineInput[] = [
  { productId: "kwek", sticksSold: "60", piecesSold: 240 },
  { productId: "calamares", sticksSold: "60", piecesSold: 180 },
  { productId: "squidball", sticksSold: "55", piecesSold: 275 },
  { productId: "fishball", sticksSold: "30", piecesSold: 300 },
  { productId: "kikiam", sticksSold: "52", piecesSold: 208 },
];

/**
 * An uneven split. A cart shifts fishball far more easily than calamares, so the owner
 * can make calamares carry more of the money. These add to the same ₱250, but nothing
 * requires them to — the components are what pay, not the header figure.
 */
function weightedSet(): SetDefinitionInput {
  const set = standardSet();
  const worth: Record<string, string> = {
    kwek: "60", calamares: "80", squidball: "50", fishball: "20", kikiam: "40",
  };
  return {
    ...set,
    components: set.components.map((component) => ({
      ...component,
      creditValue: worth[component.productId]!,
    })),
  };
}

describe("compensation — an editable credit worth per component", () => {
  const shift = {
    status: "CLOSED" as const, netSales: "3000", cashVariance: "0", vendorAcknowledged: true,
  };

  it("pays each component its own worth, not an equal share", () => {
    const result = computeShiftPay({
      shift, lines: lopsidedDay, scheme, rules: [setRule], setDefinition: weightedSet(),
    });
    // fishball fell short at 30 sticks, so its ₱20 is the one not earned
    expect(result.incentiveTotal).toBe("230.00");
    expect(result.netPay).toBe("730.00");
  });

  it("names the component's own worth on the payslip line", () => {
    const result = computeShiftPay({
      shift, lines: lopsidedDay, scheme, rules: [setRule], setDefinition: weightedSet(),
    });
    const calamares = result.lines.find((line) => line.label.includes("Calamares"));
    expect(calamares?.computation).toContain("₱80.00");
    expect(calamares?.amount).toBe("80.00");
  });

  it("falls back to an equal share for a component with no worth of its own", () => {
    const set = weightedSet();
    set.components[0]!.creditValue = null;      // kwek-kwek
    set.components[1]!.creditValue = undefined; // calamares
    const result = computeShiftPay({
      shift, lines: lopsidedDay, scheme, rules: [setRule], setDefinition: set,
    });
    // kwek + calamares take ₱50 each; squidball ₱50 and kikiam ₱40 keep theirs
    expect(result.incentiveTotal).toBe("190.00");
  });

  it("treats a worth of zero as earning nothing, never as unset", () => {
    const set = weightedSet();
    set.components[0]!.creditValue = "0"; // kwek-kwek earns no incentive
    const result = computeShiftPay({
      shift, lines: lopsidedDay, scheme, rules: [setRule], setDefinition: set,
    });
    expect(result.incentiveTotal).toBe("170.00"); // 230 - 60
    const kwek = result.lines.find((line) => line.label.includes("Kwek-kwek"));
    expect(kwek?.amount).toBe("0.00");
  });

  it("still caps credits per component before applying the worth", () => {
    const set = { ...weightedSet(), maxSetsPerComponent: 1 };
    const heavyDay: PayLineInput[] = [
      { productId: "kwek", sticksSold: "150", piecesSold: 600 }, // 3 credits, capped to 1
      { productId: "calamares", sticksSold: "0", piecesSold: 0 },
      { productId: "squidball", sticksSold: "0", piecesSold: 0 },
      { productId: "fishball", sticksSold: "0", piecesSold: 0 },
      { productId: "kikiam", sticksSold: "0", piecesSold: 0 },
    ];
    const result = computeShiftPay({
      shift, lines: heavyDay, scheme, rules: [setRule], setDefinition: set,
    });
    expect(result.incentiveTotal).toBe("60.00");
  });

  it("leaves the whole-set modes alone — there the set price is the set price", () => {
    const evenDay: PayLineInput[] = [
      { productId: "kwek", sticksSold: "50", piecesSold: 200 },
      { productId: "calamares", sticksSold: "50", piecesSold: 150 },
      { productId: "squidball", sticksSold: "50", piecesSold: 250 },
      { productId: "fishball", sticksSold: "50", piecesSold: 500 },
      { productId: "kikiam", sticksSold: "50", piecesSold: 200 },
    ];
    const result = computeShiftPay({
      shift,
      lines: evenDay,
      scheme,
      rules: [setRule],
      setDefinition: { ...weightedSet(), completionMode: "ALL_COMPONENTS" },
    });
    expect(result.incentiveTotal).toBe("250.00");
  });
});

describe("compensation — spec 11.6, the five-product set", () => {
  const shift = {
    status: "CLOSED" as const, netSales: "3000", cashVariance: "0", vendorAcknowledged: true,
  };

  it("pays 4 of 5 component credits under PER_COMPONENT — the owner's choice", () => {
    const result = computeShiftPay({
      shift, lines: lopsidedDay, scheme, rules: [setRule], setDefinition: standardSet(),
    });
    expect(result.incentiveTotal).toBe("200.00"); // 4 × ₱50
    expect(result.netPay).toBe("700.00");         // ₱500 base + ₱200
  });

  it("pays nothing under ALL_COMPONENTS — the weakest decides", () => {
    const result = computeShiftPay({
      shift, lines: lopsidedDay, scheme, rules: [setRule],
      setDefinition: standardSet("ALL_COMPONENTS"),
    });
    expect(result.incentiveTotal).toBe("0.00");
  });

  it("pays 60% under PROPORTIONAL — fishball at 30 of 50 sticks", () => {
    const result = computeShiftPay({
      shift, lines: lopsidedDay, scheme, rules: [setRule],
      setDefinition: standardSet("PROPORTIONAL"),
    });
    expect(result.incentiveTotal).toBe("150.00"); // 0.6 × ₱250
  });

  it("lets one product stack credits when uncapped", () => {
    // 100 sticks of fishball alone is two credits, nothing else sold.
    const result = computeShiftPay({
      shift,
      lines: [{ productId: "fishball", sticksSold: "100", piecesSold: 1000 }],
      scheme, rules: [setRule], setDefinition: standardSet(),
    });
    expect(result.incentiveTotal).toBe("100.00");
  });

  it("stops the stacking when a cap is set", () => {
    const result = computeShiftPay({
      shift,
      lines: [{ productId: "fishball", sticksSold: "100", piecesSold: 1000 }],
      scheme, rules: [setRule], setDefinition: standardSet("PER_COMPONENT", 1),
    });
    expect(result.incentiveTotal).toBe("50.00");
    expect(result.lines.find((l) => l.label.includes("Fishball"))?.computation).toContain("capped");
  });

  it("shows the stick arithmetic on every credit line", () => {
    const result = computeShiftPay({
      shift, lines: lopsidedDay, scheme, rules: [setRule], setDefinition: standardSet(),
    });
    const fishball = result.lines.find((l) => l.label.includes("Fishball"));
    expect(fishball?.computation).toBe("30.0 sticks ÷ 50 required = 0 credits × ₱50.00");
    const kwek = result.lines.find((l) => l.label.includes("Kwek-kwek"));
    expect(kwek?.computation).toBe("60.0 sticks ÷ 50 required = 1 credit × ₱50.00");
  });
});

describe("compensation — spec 11.2, Ana's shift", () => {
  it("pays ₱538.00: base ₱500 + one fishball credit − ₱12 shortage", () => {
    const result = computeShiftPay({
      shift: { status: "CLOSED", netSales: "540", cashVariance: "-12", vendorAcknowledged: true },
      lines: [{ productId: "fishball", sticksSold: "54", piecesSold: 540 }],
      scheme, rules: [setRule], setDefinition: standardSet(),
    });
    expect(result.basePay).toBe("500.00");
    expect(result.incentiveTotal).toBe("50.00");   // floor(54 / 50) = 1 credit
    expect(result.deductionTotal).toBe("12.00");   // uncapped, acknowledged
    expect(result.netPay).toBe("538.00");
  });
});

describe("compensation — shortages", () => {
  const shortShift = {
    status: "CLOSED" as const, netSales: "540", cashVariance: "-12", vendorAcknowledged: false,
  };

  it("never deducts a shortage the vendor has not acknowledged", () => {
    const result = computeShiftPay({
      shift: shortShift, lines: [{ productId: "fishball", sticksSold: "54", piecesSold: 540 }],
      scheme, rules: [setRule], setDefinition: standardSet(),
    });
    expect(result.deductionTotal).toBe("0.00");
    expect(result.shortageSuppressed).toBe(true);
    expect(result.netPay).toBe("550.00");
  });

  it("respects a cap when the scheme sets one", () => {
    const result = computeShiftPay({
      shift: { status: "CLOSED", netSales: "540", cashVariance: "-300", vendorAcknowledged: true },
      lines: [], scheme: { ...scheme, maxShortageDeduction: "100" }, rules: [],
    });
    expect(result.deductionTotal).toBe("100.00");
    expect(result.lines.at(-1)?.computation).toContain("capped at ₱100.00");
  });

  it("deducts the whole shortage when uncapped, even below base pay", () => {
    const result = computeShiftPay({
      shift: { status: "CLOSED", netSales: "540", cashVariance: "-700", vendorAcknowledged: true },
      lines: [], scheme, rules: [],
    });
    expect(result.deductionTotal).toBe("700.00");
    expect(result.netPay).toBe("-200.00");
  });

  it("can require a clean cash count before paying any set incentive", () => {
    const result = computeShiftPay({
      shift: { status: "CLOSED", netSales: "3000", cashVariance: "-12", vendorAcknowledged: true },
      lines: lopsidedDay, scheme,
      rules: [{ ...setRule, params: { requireZeroShortage: true } }],
      setDefinition: standardSet(),
    });
    expect(result.incentiveTotal).toBe("0.00");
  });

  it("adds approved deductions like cash advances", () => {
    const result = computeShiftPay({
      shift: { status: "CLOSED", netSales: "540", cashVariance: "0", vendorAcknowledged: true },
      lines: [], scheme, rules: [],
      deductions: [{ type: "CASH_ADVANCE", amount: "200", note: "Advance on 12 Sep" }],
    });
    expect(result.deductionTotal).toBe("200.00");
    expect(result.netPay).toBe("300.00");
  });
});

describe("compensation — the other rule types", () => {
  const shift = {
    status: "CLOSED" as const, netSales: "4000", cashVariance: "0",
    vendorAcknowledged: true, refillCount: 2,
  };

  it("pays a percentage commission on net sales", () => {
    const result = computeShiftPay({
      shift, lines: [], scheme: { ...scheme, baseDailyRate: "0" },
      rules: [{ id: "c", type: "COMMISSION_PCT", priority: 10, params: { percent: 5 } }],
    });
    expect(result.incentiveTotal).toBe("200.00");
  });

  it("pays per stick sold, scoped to one product when asked", () => {
    const result = computeShiftPay({
      shift, lines: lopsidedDay, scheme: { ...scheme, baseDailyRate: "0" },
      rules: [{ id: "u", type: "PER_UNIT", priority: 10, params: { amountPerUnit: "0.50" },
        scopeProductId: "fishball" }],
    });
    expect(result.incentiveTotal).toBe("15.00"); // 30 sticks × ₱0.50
  });

  it("pays a target bonus only when the target is met", () => {
    const hit = computeShiftPay({
      shift, lines: [], scheme: { ...scheme, baseDailyRate: "0" },
      rules: [{ id: "t", type: "TARGET_BONUS", priority: 10,
        params: { targetNetSales: "3500", bonusAmount: "100" } }],
    });
    expect(hit.incentiveTotal).toBe("100.00");

    const missed = computeShiftPay({
      shift: { ...shift, netSales: "3000" }, lines: [], scheme: { ...scheme, baseDailyRate: "0" },
      rules: [{ id: "t", type: "TARGET_BONUS", priority: 10,
        params: { targetNetSales: "3500", bonusAmount: "100" } }],
    });
    expect(missed.incentiveTotal).toBe("0.00");
    expect(missed.lines.at(-1)?.computation).toContain("fell short");
  });

  it("pays refill bonuses per refill taken", () => {
    const result = computeShiftPay({
      shift, lines: [], scheme: { ...scheme, baseDailyRate: "0" },
      rules: [{ id: "r", type: "REFILL_BONUS", priority: 10,
        params: { amountPerRefillSet: "25", minRefillSeq: 2 } }],
    });
    expect(result.incentiveTotal).toBe("50.00"); // 2 refills × ₱25
  });
});

describe("compensation — shifts that should not pay", () => {
  it("pays nothing for a shift that was never closed", () => {
    const result = computeShiftPay({
      shift: { status: "OPEN", netSales: "0", cashVariance: "0", vendorAcknowledged: false },
      lines: [], scheme, rules: [],
    });
    expect(result.netPay).toBe("0.00");
  });

  it("flags a disputed shift so payroll can exclude it", () => {
    const result = computeShiftPay({
      shift: { status: "DISPUTED", netSales: "540", cashVariance: "-500", vendorAcknowledged: true },
      lines: [], scheme, rules: [],
    });
    expect(result.blockedByDispute).toBe(true);
  });
});

describe("compensation — a week of payroll", () => {
  it("adds six days into one payroll line", () => {
    const week = Array.from({ length: 6 }, () => ({
      basePay: "500.00", incentiveTotal: "150.00", deductionTotal: "10.00", netPay: "640.00",
    }));
    const total = aggregatePay(week);
    expect(total.daysWorked).toBe(6);
    expect(total.basePayTotal).toBe("3000.00");
    expect(total.incentiveTotal).toBe("900.00");
    expect(total.deductionTotal).toBe("60.00");
    expect(total.netPay).toBe("3840.00");
  });
});
