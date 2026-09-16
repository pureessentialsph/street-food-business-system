import type { ScopedDb } from "@/lib/db";
import { dec, sum, ZERO } from "@/lib/money";
import { allocateOverhead, profitAndLoss, type ProfitResult } from "@/lib/engines/profitability";

/**
 * Assembles a real P&L from shifts, pay and expenses, at whatever level is asked for.
 *
 * Company → Branch → Cart → Shift is the same arithmetic each time, so the numbers
 * reconcile: a branch is exactly the sum of its carts, and the company is exactly the
 * sum of its branches plus company-level overhead (spec §10).
 */

export type PnlScope =
  | { level: "COMPANY" }
  | { level: "BRANCH"; id: string }
  | { level: "CART"; id: string };

export type PnlRow = {
  id: string;
  name: string;
  level: "BRANCH" | "CART" | "SHIFT";
  netSales: string;
  cogs: string;
  grossProfit: string;
  labourCost: string;
  wasteCost: string;
  directExpenses: string;
  operatingProfit: string;
  allocatedOverhead: string;
  netProfit: string;
  marginPct: string | null;
  href?: string;
};

export type PnlReport = {
  totals: ProfitResult;
  rows: PnlRow[];
  overheadTotal: string;
  overheadApplied: boolean;
  shiftCount: number;
  heldShifts: number;
};

const fx = (value: ReturnType<typeof dec>) => value.toFixed(2);

export async function buildPnl(
  db: ScopedDb,
  periodStart: Date,
  periodEnd: Date,
  scope: PnlScope,
  options: { allocateOverhead?: boolean } = {},
): Promise<PnlReport> {
  const dateRange = { gte: periodStart, lte: periodEnd };

  const shiftWhere =
    scope.level === "BRANCH" ? { branchId: scope.id }
      : scope.level === "CART" ? { cartId: scope.id }
        : {};

  const [shifts, branches, carts, expenses, compensations] = await Promise.all([
    db.cartShift.findMany({
      where: { businessDate: dateRange, status: { in: ["CLOSED", "APPROVED"] }, ...shiftWhere },
      orderBy: { businessDate: "asc" },
    }),
    db.branch.findMany({ select: { id: true, code: true, name: true } }),
    db.cart.findMany({ select: { id: true, code: true, name: true, branchId: true } }),
    db.expense.findMany({
      where: { businessDate: dateRange, status: "APPROVED" },
      include: { category: { select: { name: true, kind: true, isOverhead: true } } },
    }),
    db.shiftCompensation.findMany({ where: { businessDate: dateRange } }),
  ]);

  const heldShifts = await db.cartShift.count({
    where: { businessDate: dateRange, status: { in: ["OPEN", "DISPUTED"] }, ...shiftWhere },
  });

  const branchName = new Map(branches.map((b) => [b.id, `${b.code} · ${b.name}`]));
  const cartName = new Map(carts.map((c) => [c.id, `${c.code} · ${c.name}`]));
  const cartBranch = new Map(carts.map((c) => [c.id, c.branchId]));
  const payByShift = new Map(compensations.map((c) => [c.shiftId, c]));

  /** Direct expenses attributable to a cart or a branch (not company overhead). */
  const directForCart = new Map<string, ReturnType<typeof dec>>();
  const directForBranch = new Map<string, ReturnType<typeof dec>>();
  let overhead = ZERO;

  for (const expense of expenses) {
    if (expense.category.kind === "CAPEX") continue; // capital spend is not an operating cost
    const amount = dec(expense.amount);

    if (expense.scopeType === "CART" && expense.scopeId) {
      directForCart.set(expense.scopeId, (directForCart.get(expense.scopeId) ?? ZERO).plus(amount));
    } else if (expense.scopeType === "BRANCH" && expense.scopeId) {
      directForBranch.set(expense.scopeId, (directForBranch.get(expense.scopeId) ?? ZERO).plus(amount));
    } else {
      overhead = overhead.plus(amount);
    }
  }

  // ---- per-shift figures, the atom everything else is summed from ----------
  type Unit = {
    id: string; name: string;
    netSales: ReturnType<typeof dec>; cogs: ReturnType<typeof dec>;
    labour: ReturnType<typeof dec>; waste: ReturnType<typeof dec>;
    direct: ReturnType<typeof dec>;
    href?: string;
  };

  const shiftUnits: (Unit & { cartId: string; branchId: string })[] = shifts.map((shift) => {
    const pay = payByShift.get(shift.id);
    return {
      id: shift.id,
      name: `${cartName.get(shift.cartId) ?? shift.cartId} · ${shift.businessDate.toISOString().slice(0, 10)}`,
      cartId: shift.cartId,
      branchId: shift.branchId,
      netSales: dec(shift.netSales),
      cogs: dec(shift.cogs),
      labour: pay ? dec(pay.netPay) : ZERO,
      waste: dec(shift.wasteCost),
      direct: ZERO,
      href: `/shifts/${shift.id}`,
    };
  });

  // ---- roll up to whatever level was asked for -----------------------------
  let units: Unit[];
  let level: PnlRow["level"];

  if (scope.level === "COMPANY") {
    level = "BRANCH";
    const byBranch = new Map<string, Unit>();
    for (const shift of shiftUnits) {
      const current = byBranch.get(shift.branchId) ?? {
        id: shift.branchId,
        name: branchName.get(shift.branchId) ?? shift.branchId,
        netSales: ZERO, cogs: ZERO, labour: ZERO, waste: ZERO, direct: ZERO,
        href: `/reports?level=BRANCH&id=${shift.branchId}`,
      };
      byBranch.set(shift.branchId, {
        ...current,
        netSales: current.netSales.plus(shift.netSales),
        cogs: current.cogs.plus(shift.cogs),
        labour: current.labour.plus(shift.labour),
        waste: current.waste.plus(shift.waste),
      });
    }
    // Cart-level expenses roll into their branch; branch expenses sit directly.
    for (const [cartId, amount] of directForCart) {
      const branchId = cartBranch.get(cartId);
      if (!branchId) continue;
      const unit = byBranch.get(branchId);
      if (unit) unit.direct = unit.direct.plus(amount);
    }
    for (const [branchId, amount] of directForBranch) {
      const unit = byBranch.get(branchId);
      if (unit) unit.direct = unit.direct.plus(amount);
    }
    units = [...byBranch.values()];
  } else if (scope.level === "BRANCH") {
    level = "CART";
    const byCart = new Map<string, Unit>();
    for (const shift of shiftUnits) {
      const current = byCart.get(shift.cartId) ?? {
        id: shift.cartId,
        name: cartName.get(shift.cartId) ?? shift.cartId,
        netSales: ZERO, cogs: ZERO, labour: ZERO, waste: ZERO, direct: ZERO,
        href: `/reports?level=CART&id=${shift.cartId}`,
      };
      byCart.set(shift.cartId, {
        ...current,
        netSales: current.netSales.plus(shift.netSales),
        cogs: current.cogs.plus(shift.cogs),
        labour: current.labour.plus(shift.labour),
        waste: current.waste.plus(shift.waste),
      });
    }
    for (const [cartId, amount] of directForCart) {
      const unit = byCart.get(cartId);
      if (unit) unit.direct = unit.direct.plus(amount);
    }
    // The branch's own expenses belong to the branch, not to any one cart.
    units = [...byCart.values()];
  } else {
    level = "SHIFT";
    units = shiftUnits;
    const cartExpense = directForCart.get(scope.id) ?? ZERO;
    if (units.length > 0 && cartExpense.greaterThan(0)) {
      // Spread the cart's own expenses across its shifts by sales share.
      const spread = allocateOverhead(cartExpense, units.map((u) => ({ id: u.id, netSales: u.netSales })));
      for (const unit of units) unit.direct = spread.get(unit.id) ?? ZERO;
    }
  }

  // ---- overhead ------------------------------------------------------------
  const applyOverhead = options.allocateOverhead === true && scope.level === "COMPANY";
  const overheadShare = applyOverhead
    ? allocateOverhead(overhead, units.map((u) => ({ id: u.id, netSales: u.netSales })))
    : new Map<string, ReturnType<typeof dec>>();

  const rows: PnlRow[] = units
    .map((unit) => {
      const allocated = overheadShare.get(unit.id) ?? ZERO;
      const result = profitAndLoss({
        netSales: unit.netSales, cogs: unit.cogs, labourCost: unit.labour,
        wasteCost: unit.waste, directExpenses: unit.direct, allocatedOverhead: allocated,
      });
      return {
        id: unit.id,
        name: unit.name,
        level,
        netSales: fx(result.netSales),
        cogs: fx(result.cogs),
        grossProfit: fx(result.grossProfit),
        labourCost: fx(result.labourCost),
        wasteCost: fx(result.wasteCost),
        directExpenses: fx(result.directExpenses),
        operatingProfit: fx(result.operatingProfit),
        allocatedOverhead: fx(result.allocatedOverhead),
        netProfit: fx(result.netProfit),
        marginPct: result.operatingMarginPct ? result.operatingMarginPct.toFixed(1) : null,
        href: unit.href,
      };
    })
    .sort((a, b) => dec(b.netSales).comparedTo(dec(a.netSales)));

  // Company totals include overhead whether or not it has been pushed down to branches,
  // otherwise the top line would flatter itself by hiding rent.
  const totals = profitAndLoss({
    netSales: sum(rows.map((r) => r.netSales)),
    cogs: sum(rows.map((r) => r.cogs)),
    labourCost: sum(rows.map((r) => r.labourCost)),
    wasteCost: sum(rows.map((r) => r.wasteCost)),
    directExpenses: sum(rows.map((r) => r.directExpenses)),
    allocatedOverhead: scope.level === "COMPANY" ? overhead : ZERO,
  });

  return {
    totals,
    rows,
    overheadTotal: fx(overhead),
    overheadApplied: applyOverhead,
    shiftCount: shifts.length,
    heldShifts,
  };
}
