import type { ScopedDb } from "@/lib/db";
import { businessDateFor, toDateColumn, trailingBusinessDates } from "@/lib/businessDate";
import { dec, divide, percentOf, sum, ZERO } from "@/lib/money";

/**
 * Everything the owner dashboard shows, assembled from closed shifts (spec §7).
 *
 * One rule throughout: only CLOSED or APPROVED shifts count. Anything open or disputed
 * is reported separately rather than folded into a headline that would then be wrong.
 */

export type DayPoint = { businessDate: string; label: string; netSales: string; shifts: number };

export type Scoreboard = {
  businessDate: string;
  netSales: string;
  grossProfit: string;
  unitsSold: string;
  sticksSold: string;
  shiftsClosed: number;
  shiftsOpen: number;
  shiftsDisputed: number;
  cartsActive: number;
  target: string | null;
  targetPct: string | null;
  cashVariance: string;
  vsYesterdayPct: string | null;
  avgDailySales: string;
};

export type CartLine = {
  id: string;
  name: string;
  netSales: string;
  grossProfit: string;
  target: string | null;
  targetPct: string | null;
  cashVariance: string;
  sellThroughPct: string | null;
};

export type ProductLine = {
  id: string;
  name: string;
  sticksSold: string;
  netSales: string;
  grossProfit: string;
  marginPct: string | null;
};

export type Alert = {
  tone: "danger" | "warning";
  title: string;
  detail: string;
  href?: string;
};

const fx = (v: ReturnType<typeof dec>) => v.toFixed(2);

export async function buildDashboard(
  db: ScopedDb,
  options: { branchIds?: string[]; days?: number } = {},
): Promise<{
  today: Scoreboard;
  trend: DayPoint[];
  carts: CartLine[];
  bestProducts: ProductLine[];
  slowProducts: ProductLine[];
  alerts: Alert[];
}> {
  const company = await db.company.findFirst({ where: { id: db.$companyId } });
  const cutoff = company?.businessDayCutoffHour ?? 4;
  const timezone = company?.timezone ?? "Asia/Manila";
  const varianceThreshold = dec(company?.cashVarianceThreshold ?? 100);

  const todayDate = businessDateFor(new Date(), cutoff, timezone);
  const days = options.days ?? 14;
  const window = trailingBusinessDates(todayDate, days);
  const windowStart = toDateColumn(window[0]!);
  const todayColumn = toDateColumn(todayDate);

  const branchFilter = options.branchIds?.length ? { branchId: { in: options.branchIds } } : {};

  const [shifts, lines, carts, products, compensations, targets] = await Promise.all([
    db.cartShift.findMany({
      where: { businessDate: { gte: windowStart, lte: todayColumn }, ...branchFilter },
      orderBy: { businessDate: "asc" },
    }),
    db.shiftLine.findMany({
      where: { shift: { businessDate: { gte: windowStart, lte: todayColumn }, ...branchFilter } },
      include: { shift: { select: { id: true, businessDate: true, cartId: true, status: true } } },
    }),
    db.cart.findMany({
      where: { status: "ACTIVE", ...(options.branchIds?.length ? { branchId: { in: options.branchIds } } : {}) },
      select: { id: true, code: true, name: true, dailySalesTarget: true },
    }),
    db.product.findMany({ select: { id: true, name: true } }),
    db.shiftCompensation.findMany({
      where: { businessDate: { gte: windowStart, lte: todayColumn } },
    }),
    db.target.findMany({
      where: { periodType: "DAY", periodStart: todayColumn, metric: "NET_SALES" },
    }),
  ]);

  const counted = shifts.filter((s) => s.status === "CLOSED" || s.status === "APPROVED");
  const cartName = new Map(carts.map((c) => [c.id, `${c.code} · ${c.name}`]));
  const productName = new Map(products.map((p) => [p.id, p.name]));

  // ---- trend -------------------------------------------------------------
  const trend: DayPoint[] = window.map((date) => {
    const column = toDateColumn(date);
    const dayShifts = counted.filter((s) => s.businessDate.getTime() === column.getTime());
    return {
      businessDate: date,
      label: new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short" }),
      netSales: fx(sum(dayShifts.map((s) => s.netSales))),
      shifts: dayShifts.length,
    };
  });

  // ---- today -------------------------------------------------------------
  const todayShifts = counted.filter((s) => s.businessDate.getTime() === todayColumn.getTime());
  const todayLines = lines.filter((l) => l.shift.businessDate.getTime() === todayColumn.getTime());
  const netSales = sum(todayShifts.map((s) => s.netSales));

  const yesterdaySales = dec(trend.at(-2)?.netSales ?? 0);
  const activeDays = trend.filter((d) => dec(d.netSales).greaterThan(0));
  const avgDailySales = activeDays.length
    ? divide(sum(activeDays.map((d) => d.netSales)), activeDays.length) ?? ZERO
    : ZERO;

  // Cart targets, falling back to any explicit Target rows for today.
  const cartTargetTotal = sum(carts.map((c) => c.dailySalesTarget ?? 0));
  const explicitTarget = sum(targets.map((t) => t.value));
  const target = explicitTarget.greaterThan(0) ? explicitTarget : cartTargetTotal;

  const today: Scoreboard = {
    businessDate: todayDate,
    netSales: fx(netSales),
    grossProfit: fx(sum(todayShifts.map((s) => s.grossProfit))),
    unitsSold: sum(todayLines.map((l) => l.piecesSold)).toFixed(0),
    sticksSold: sum(todayLines.map((l) => l.sticksSold)).toFixed(1),
    shiftsClosed: todayShifts.length,
    shiftsOpen: shifts.filter((s) => s.businessDate.getTime() === todayColumn.getTime() && s.status === "OPEN").length,
    shiftsDisputed: shifts.filter((s) => s.businessDate.getTime() === todayColumn.getTime() && s.status === "DISPUTED").length,
    cartsActive: carts.length,
    target: target.greaterThan(0) ? fx(target) : null,
    targetPct: target.greaterThan(0) ? percentOf(netSales, target)?.toFixed(0) ?? null : null,
    cashVariance: fx(sum(todayShifts.map((s) => s.cashVariance))),
    vsYesterdayPct: yesterdaySales.greaterThan(0)
      ? netSales.minus(yesterdaySales).dividedBy(yesterdaySales).times(100).toFixed(0)
      : null,
    avgDailySales: fx(avgDailySales),
  };

  // ---- cart scoreboard (today) -------------------------------------------
  const cartLines: CartLine[] = carts.map((cart) => {
    const shift = todayShifts.find((s) => s.cartId === cart.id);
    const shiftLines = todayLines.filter((l) => l.shift.cartId === cart.id);
    const issued = sum(shiftLines.map((l) => l.piecesIssued));
    const sold = sum(shiftLines.map((l) => l.piecesSold));
    const cartTarget = cart.dailySalesTarget ? dec(cart.dailySalesTarget) : null;
    const cartSales = shift ? dec(shift.netSales) : ZERO;

    return {
      id: cart.id,
      name: cartName.get(cart.id) ?? cart.id,
      netSales: fx(cartSales),
      grossProfit: fx(shift ? dec(shift.grossProfit) : ZERO),
      target: cartTarget ? fx(cartTarget) : null,
      targetPct: cartTarget && cartTarget.greaterThan(0) ? percentOf(cartSales, cartTarget)?.toFixed(0) ?? null : null,
      cashVariance: fx(shift ? dec(shift.cashVariance) : ZERO),
      sellThroughPct: issued.greaterThan(0) ? percentOf(sold, issued)?.toFixed(0) ?? null : null,
    };
  }).sort((a, b) => dec(b.netSales).comparedTo(dec(a.netSales)));

  // ---- products over the window -----------------------------------------
  const byProduct = new Map<string, { sticks: ReturnType<typeof dec>; sales: ReturnType<typeof dec>; profit: ReturnType<typeof dec> }>();
  for (const line of lines) {
    if (line.shift.status !== "CLOSED" && line.shift.status !== "APPROVED") continue;
    const current = byProduct.get(line.productId) ?? { sticks: ZERO, sales: ZERO, profit: ZERO };
    byProduct.set(line.productId, {
      sticks: current.sticks.plus(line.sticksSold.toString()),
      sales: current.sales.plus(line.netSales.toString()),
      profit: current.profit.plus(dec(line.netSales).minus(line.lineCogs)),
    });
  }

  const productLines: ProductLine[] = [...byProduct.entries()].map(([id, totals]) => ({
    id,
    name: productName.get(id) ?? id,
    sticksSold: totals.sticks.toFixed(1),
    netSales: fx(totals.sales),
    grossProfit: fx(totals.profit),
    marginPct: percentOf(totals.profit, totals.sales)?.toFixed(1) ?? null,
  }));

  const ranked = [...productLines].sort((a, b) => dec(b.netSales).comparedTo(dec(a.netSales)));
  const bestProducts = ranked.slice(0, 6);
  /**
   * Slow movers are the tail, never a product already named as a best seller — with
   * only a couple of products selling, "best" and "slow" would otherwise be the same
   * list, which tells the owner nothing.
   */
  const bestIds = new Set(bestProducts.map((p) => p.id));
  const slowProducts = ranked
    .filter((p) => !bestIds.has(p.id))
    .slice(-4)
    .reverse();

  // ---- alerts ------------------------------------------------------------
  const alerts: Alert[] = [];

  const disputed = shifts.filter((s) => s.status === "DISPUTED");
  if (disputed.length > 0) {
    alerts.push({
      tone: "danger",
      title: `${disputed.length} disputed shift${disputed.length === 1 ? "" : "s"}`,
      detail: "Cash is out by more than the threshold. Payroll is blocked until it is resolved.",
      href: "/shifts",
    });
  }

  const shortShifts = counted.filter((s) => dec(s.cashVariance).isNegative());
  const shortTotal = sum(shortShifts.map((s) => dec(s.cashVariance).abs()));
  if (shortTotal.greaterThan(varianceThreshold)) {
    alerts.push({
      tone: "warning",
      title: `₱${shortTotal.toFixed(2)} short across ${shortShifts.length} shift${shortShifts.length === 1 ? "" : "s"}`,
      detail: `Small shortages add up. Threshold for a single shift is ₱${varianceThreshold.toFixed(0)}.`,
      href: "/shifts",
    });
  }

  const unacknowledged = counted.filter((s) => !s.vendorAcknowledged && dec(s.cashVariance).isNegative());
  if (unacknowledged.length > 0) {
    alerts.push({
      tone: "warning",
      title: `${unacknowledged.length} shortage${unacknowledged.length === 1 ? "" : "s"} not acknowledged`,
      detail: "No deduction can be applied until the vendor has acknowledged the count.",
      href: "/shifts",
    });
  }

  const awaitingApproval = counted.filter((s) => s.status === "CLOSED");
  if (awaitingApproval.length > 0) {
    alerts.push({
      tone: "warning",
      title: `${awaitingApproval.length} shift${awaitingApproval.length === 1 ? "" : "s"} awaiting approval`,
      detail: "Approved shifts are what payroll and the P&L are built from.",
      href: "/shifts",
    });
  }

  const negativeStock = await db.stockBalance.count({ where: { qty: { lt: 0 } } });
  if (negativeStock > 0) {
    alerts.push({
      tone: "danger",
      title: `${negativeStock} negative stock balance${negativeStock === 1 ? "" : "s"}`,
      detail: "Stock went out that was never recorded coming in — usually a missed receipt.",
      href: "/inventory",
    });
  }

  const zeroCost = counted.filter((s) => dec(s.netSales).greaterThan(0) && dec(s.cogs).isZero());
  if (zeroCost.length > 0) {
    alerts.push({
      tone: "danger",
      title: `${zeroCost.length} shift${zeroCost.length === 1 ? "" : "s"} sold goods at zero cost`,
      detail: "Profit on those shifts is overstated. The products need a recipe.",
      href: "/costing",
    });
  }

  return { today, trend, carts: cartLines, bestProducts, slowProducts, alerts };
}
