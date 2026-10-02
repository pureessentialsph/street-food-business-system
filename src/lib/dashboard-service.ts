import type { ScopedDb } from "@/lib/db";
import { businessDateFor, toDateColumn, trailingBusinessDates } from "@/lib/businessDate";
import {
  eachDate, granularityFor, resolveRange, weekBuckets,
  type DateRange, type ResolvedRange,
} from "@/lib/engines/date-range";
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

/**
 * The same figures over a chosen window rather than just today. Gross sales is here
 * because it is what an owner counts in their head — the till total before discounts —
 * and the dashboard previously showed only net, which silently disagreed with it the
 * moment a discount was given.
 */
export type Period = {
  from: string;
  to: string;
  /** Calendar days in the window. */
  days: number;
  /** Days that actually traded, which is what an average should divide by. */
  daysTraded: number;
  grossSales: string;
  discountTotal: string;
  netSales: string;
  grossProfit: string;
  marginPct: string | null;
  cashVariance: string;
  unitsSold: string;
  sticksSold: string;
  shifts: number;
  avgDailySales: string;
  bestDay: { businessDate: string; netSales: string } | null;
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
  options: {
    branchIds?: string[];
    days?: number;
    canSeeDocuments?: boolean;
    /** What the owner asked for in the URL; resolved and clamped before use. */
    range?: { from?: string; to?: string; preset?: string };
  } = {},
): Promise<{
  today: Scoreboard;
  period: Period;
  resolved: ResolvedRange;
  trend: DayPoint[];
  trendGranularity: "day" | "week";
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
  const todayColumn = toDateColumn(todayDate);

  /**
   * Two windows, deliberately. "Today" and its comparisons are what the dashboard is
   * for in the morning and must not move when the owner widens the range; everything
   * labelled with a period follows the range they chose. The query spans whichever is
   * wider so both are answered in one read.
   */
  const resolved = resolveRange(options.range ?? {}, todayDate);
  const range: DateRange = resolved.range;
  const rangeDates = eachDate(range);

  const days = options.days ?? 14;
  const recent = trailingBusinessDates(todayDate, days);
  const window = rangeDates;
  const queryStart = toDateColumn(
    Date.parse(`${recent[0]!}T00:00:00Z`) < Date.parse(`${range.from}T00:00:00Z`) ? recent[0]! : range.from,
  );
  const queryEnd = toDateColumn(
    Date.parse(`${range.to}T00:00:00Z`) > Date.parse(`${todayDate}T00:00:00Z`) ? range.to : todayDate,
  );

  const branchFilter = options.branchIds?.length ? { branchId: { in: options.branchIds } } : {};

  const [shifts, lines, carts, products, compensations, targets] = await Promise.all([
    db.cartShift.findMany({
      where: { businessDate: { gte: queryStart, lte: queryEnd }, ...branchFilter },
      orderBy: { businessDate: "asc" },
    }),
    db.shiftLine.findMany({
      where: { shift: { businessDate: { gte: queryStart, lte: queryEnd }, ...branchFilter } },
      include: { shift: { select: { id: true, businessDate: true, cartId: true, status: true } } },
    }),
    db.cart.findMany({
      where: { status: "ACTIVE", ...(options.branchIds?.length ? { branchId: { in: options.branchIds } } : {}) },
      select: { id: true, code: true, name: true, dailySalesTarget: true },
    }),
    db.product.findMany({ select: { id: true, name: true } }),
    db.shiftCompensation.findMany({
      where: { businessDate: { gte: queryStart, lte: queryEnd } },
    }),
    db.target.findMany({
      where: { periodType: "DAY", periodStart: todayColumn, metric: "NET_SALES" },
    }),
  ]);

  const counted = shifts.filter((s) => s.status === "CLOSED" || s.status === "APPROVED");
  const cartName = new Map(carts.map((c) => [c.id, `${c.code} · ${c.name}`]));
  const productName = new Map(products.map((p) => [p.id, p.name]));

  // ---- trend over the chosen range ---------------------------------------
  const label = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short" });
  const shiftsOn = (dates: readonly string[]) => {
    const columns = new Set(dates.map((d) => toDateColumn(d).getTime()));
    return counted.filter((sh) => columns.has(sh.businessDate.getTime()));
  };

  const granularity = granularityFor(resolved.days);
  const trend: DayPoint[] = granularity === "day"
    ? window.map((date) => {
        const dayShifts = shiftsOn([date]);
        return {
          businessDate: date,
          label: label(date),
          netSales: fx(sum(dayShifts.map((sh) => sh.netSales))),
          shifts: dayShifts.length,
        };
      })
    : weekBuckets(window).map((bucket) => {
        const weekShifts = shiftsOn(bucket.dates);
        return {
          businessDate: bucket.start,
          label: `w/c ${label(bucket.start)}`,
          netSales: fx(sum(weekShifts.map((sh) => sh.netSales))),
          shifts: weekShifts.length,
        };
      });

  // ---- today -------------------------------------------------------------
  const todayShifts = counted.filter((s) => s.businessDate.getTime() === todayColumn.getTime());
  const todayLines = lines.filter((l) => l.shift.businessDate.getTime() === todayColumn.getTime());
  const netSales = sum(todayShifts.map((s) => s.netSales));

  /**
   * Yesterday and the 14-day average belong to "today", not to the chosen range — the
   * comparison on the headline tile must not change meaning when the owner widens the
   * window. Both are computed from `recent` for that reason.
   */
  const salesOn = (date: string) => {
    const column = toDateColumn(date);
    return sum(counted.filter((sh) => sh.businessDate.getTime() === column.getTime()).map((sh) => sh.netSales));
  };
  const yesterdaySales = salesOn(recent.at(-2) ?? todayDate);
  const recentActive = recent.map(salesOn).filter((v) => v.greaterThan(0));
  const avgDailySales = recentActive.length
    ? divide(sum(recentActive), recentActive.length) ?? ZERO
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

  // ---- the chosen period -------------------------------------------------
  const fromColumn = toDateColumn(range.from);
  const toColumn = toDateColumn(range.to);
  const inRange = <T extends { businessDate: Date }>(row: T) =>
    row.businessDate.getTime() >= fromColumn.getTime() && row.businessDate.getTime() <= toColumn.getTime();

  const periodShifts = counted.filter(inRange);
  const periodLines = lines.filter((l) => inRange(l.shift));
  const periodGross = sum(periodShifts.map((sh) => sh.grossSales));
  const periodNet = sum(periodShifts.map((sh) => sh.netSales));
  const periodProfit = sum(periodShifts.map((sh) => sh.grossProfit));

  /**
   * Days, never chart buckets: with a long range the trend is weekly, and "6 of 90 days
   * traded" must stay a count of days or the average day becomes an average week.
   */
  const tradedDays = window
    .map((date) => ({ businessDate: date, netSales: fx(sum(shiftsOn([date]).map((sh) => sh.netSales))) }))
    .filter((d) => dec(d.netSales).greaterThan(0));
  const best = [...tradedDays].sort((a, b) => dec(b.netSales).comparedTo(dec(a.netSales)))[0];

  const period: Period = {
    from: range.from,
    to: range.to,
    days: resolved.days,
    daysTraded: tradedDays.length,
    grossSales: fx(periodGross),
    discountTotal: fx(sum(periodShifts.map((sh) => sh.discountTotal))),
    netSales: fx(periodNet),
    grossProfit: fx(periodProfit),
    marginPct: percentOf(periodProfit, periodNet)?.toFixed(1) ?? null,
    cashVariance: fx(sum(periodShifts.map((sh) => sh.cashVariance))),
    unitsSold: sum(periodLines.map((l) => l.piecesSold)).toFixed(0),
    sticksSold: sum(periodLines.map((l) => l.sticksSold)).toFixed(1),
    shifts: periodShifts.length,
    // Averaged over days that traded, not calendar days: a closed Sunday is not a bad day.
    avgDailySales: fx(tradedDays.length ? divide(periodNet, tradedDays.length) ?? ZERO : ZERO),
    bestDay: best ? { businessDate: best.businessDate, netSales: best.netSales } : null,
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
  for (const line of periodLines) {
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
  /**
   * Alerts are about the recent past, never the chosen range: widening the window to
   * look at last month must not raise "3 shifts awaiting approval" from a month that
   * was long since settled, and narrowing it to one day must not hide a dispute.
   */
  const recentStart = toDateColumn(recent[0]!);
  const isRecent = <T extends { businessDate: Date }>(row: T) =>
    row.businessDate.getTime() >= recentStart.getTime() && row.businessDate.getTime() <= todayColumn.getTime();
  const recentShifts = shifts.filter(isRecent);
  const recentCounted = counted.filter(isRecent);

  const alerts: Alert[] = [];

  const disputed = recentShifts.filter((s) => s.status === "DISPUTED");
  if (disputed.length > 0) {
    alerts.push({
      tone: "danger",
      title: `${disputed.length} disputed shift${disputed.length === 1 ? "" : "s"}`,
      detail:
        "Cash is out by more than the threshold. Check the count with the vendor, then approve " +
        "it — the shortage comes off that week's pay.",
      href: "/shifts",
    });
  }

  const shortShifts = recentCounted.filter((s) => dec(s.cashVariance).isNegative());
  const shortTotal = sum(shortShifts.map((s) => dec(s.cashVariance).abs()));
  if (shortTotal.greaterThan(varianceThreshold)) {
    alerts.push({
      tone: "warning",
      title: `₱${shortTotal.toFixed(2)} short across ${shortShifts.length} shift${shortShifts.length === 1 ? "" : "s"}`,
      detail: `Small shortages add up. Threshold for a single shift is ₱${varianceThreshold.toFixed(0)}.`,
      href: "/shifts",
    });
  }

  const unacknowledged = recentCounted.filter((s) => !s.vendorAcknowledged && dec(s.cashVariance).isNegative());
  if (unacknowledged.length > 0) {
    alerts.push({
      tone: "warning",
      title: `${unacknowledged.length} shortage${unacknowledged.length === 1 ? "" : "s"} not acknowledged`,
      detail: "No deduction can be applied until the vendor has acknowledged the count.",
      href: "/shifts",
    });
  }

  const awaitingApproval = recentCounted.filter((s) => s.status === "CLOSED");
  if (awaitingApproval.length > 0) {
    alerts.push({
      tone: "warning",
      title: `${awaitingApproval.length} shift${awaitingApproval.length === 1 ? "" : "s"} awaiting approval`,
      detail: "Approved shifts are what payroll and the P&L are built from.",
      href: "/shifts",
    });
  }

  /**
   * Expiring 201-file documents (spec §7). A lapsed health certificate is a closure
   * risk, so it belongs on the owner's first screen rather than in an HR folder — but
   * document titles are employment records, restricted to OWNER, ADMIN and HR. A
   * supervisor must not learn from a dashboard alert what a colleague's file contains.
   */
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);
  const expiringDocs = options.canSeeDocuments
    ? await db.employeeDocument.findMany({
        where: { expiresAt: { not: null, lte: in30Days } },
        orderBy: { expiresAt: "asc" },
        take: 5,
      })
    : [];
  if (expiringDocs.length > 0) {
    const now = new Date();
    const alreadyExpired = expiringDocs.filter((d) => d.expiresAt && d.expiresAt < now).length;
    alerts.push({
      tone: alreadyExpired > 0 ? "danger" : "warning",
      title: alreadyExpired > 0
        ? `${alreadyExpired} employee document${alreadyExpired === 1 ? " has" : "s have"} expired`
        : `${expiringDocs.length} employee document${expiringDocs.length === 1 ? "" : "s"} expiring within 30 days`,
      detail: expiringDocs.map((d) => d.title).join(", "),
      href: "/employees",
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

  const zeroCost = recentCounted.filter((s) => dec(s.netSales).greaterThan(0) && dec(s.cogs).isZero());
  if (zeroCost.length > 0) {
    alerts.push({
      tone: "danger",
      title: `${zeroCost.length} shift${zeroCost.length === 1 ? "" : "s"} sold goods at zero cost`,
      detail: "Profit on those shifts is overstated. The products need a recipe.",
      href: "/costing",
    });
  }

  return {
    today, period, resolved, trend, trendGranularity: granularity,
    carts: cartLines, bestProducts, slowProducts, alerts,
  };
}
