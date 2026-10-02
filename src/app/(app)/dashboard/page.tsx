import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can, seesAllBranches, ROLE_LABELS } from "@/lib/rbac";
import { buildDashboard } from "@/lib/dashboard-service";
import { cashPosition } from "@/lib/cash-service";
import { formatBusinessDate } from "@/lib/businessDate";
import { PRESET_LABELS } from "@/lib/engines/date-range";
import { dec, formatPHP } from "@/lib/money";
import { RankBars, StatTile, TrendBars } from "@/components/charts";
import { DateRangePicker } from "@/components/date-range-picker";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/data-table";

/**
 * The page the owner opens in the morning (spec §7): how yesterday went, which carts
 * did it, and what needs attention — without touching a spreadsheet.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; preset?: string }>;
}) {
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const { from, to, preset } = await searchParams;

  const company = await db.company.findFirst({ where: { id: user.companyId } });
  const dashboard = await buildDashboard(db, {
    branchIds: seesAllBranches(user) ? undefined : user.scopeBranchIds,
    canSeeDocuments: can(user, "employee.documents"),
    range: { from, to, preset },
  });

  /**
   * Cash on hand is a right-now figure, not a figure over a period, so it sits with
   * today and does not move when the range above it changes. It is restricted the same
   * way the cash book itself is — a supervisor runs a cart, not the company's money.
   */
  const cash = can(user, "cash.manage") ? await cashPosition(db) : null;

  /**
   * A cash box that owes money is not a rounding error — it means cash went out that
   * had no recorded source, which is almost always capital the owner put in and never
   * wrote down. Raised here rather than in buildDashboard because the figure is
   * restricted and the alert list is not.
   */
  const cashAlerts =
    cash && dec(cash.balance).isNegative()
      ? [{
          tone: "danger" as const,
          title: `The cash book is ${formatPHP(dec(cash.balance).abs())} below zero`,
          detail:
            "More cash has gone out than the book knows came in. Usually that is capital you " +
            "put in without recording it.",
          href: "/cash",
        }]
      : [];
  const { today, period, resolved, trend, trendGranularity, carts, bestProducts, slowProducts, alerts } = dashboard;

  const periodLabel =
    resolved.preset === "custom"
      ? `${formatBusinessDate(period.from)} – ${formatBusinessDate(period.to)}`
      : PRESET_LABELS[resolved.preset];

  const hasTraded = dec(today.netSales).greaterThan(0) || trend.some((t) => dec(t.netSales).greaterThan(0));
  const targetTone = today.targetPct
    ? Number(today.targetPct) >= 100 ? "good" : Number(today.targetPct) >= 70 ? "warning" : "bad"
    : "neutral";

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${ROLE_LABELS[user.role]} dashboard`}
        subtitle={`${company?.name} · business date ${formatBusinessDate(today.businessDate)}`}
      />

      {[...cashAlerts, ...alerts].length > 0 ? (
        <div className="space-y-2">
          {[...cashAlerts, ...alerts].map((alert) => (
            <div
              key={alert.title}
              className={`rounded-md px-4 py-3 text-sm ${
                alert.tone === "danger" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900"
              }`}
            >
              <span className="font-medium">{alert.title}.</span>{" "}
              {alert.detail}{" "}
              {alert.href ? (
                <Link href={alert.href} className="font-medium underline">Look at it</Link>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-3 border-t border-stone-200 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-stone-900">{periodLabel}</h2>
          <DateRangePicker
            basePath="/dashboard"
            from={period.from}
            to={period.to}
            preset={resolved.preset}
            max={today.businessDate}
          />
        </div>

        {resolved.note ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{resolved.note}</p>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Gross sales"
            value={formatPHP(period.grossSales)}
            note={
              dec(period.discountTotal).greaterThan(0)
                ? `less ${formatPHP(period.discountTotal)} discounts`
                : "before discounts"
            }
          />
          <StatTile
            label="Net sales"
            value={formatPHP(period.netSales)}
            note={`${period.daysTraded} of ${period.days} day${period.days === 1 ? "" : "s"} traded`}
          />
          <StatTile
            label="Gross profit"
            value={formatPHP(period.grossProfit)}
            note={period.marginPct ? `${period.marginPct}% margin` : "no sales in this range"}
          />
          <StatTile
            label="Average trading day"
            value={formatPHP(period.avgDailySales)}
            note={
              period.bestDay
                ? `best ${formatBusinessDate(period.bestDay.businessDate)} at ${formatPHP(period.bestDay.netSales)}`
                : "nothing traded in this range"
            }
          />
        </div>

        <p className="text-xs text-stone-500">
          {period.shifts} cart day{period.shifts === 1 ? "" : "s"} counted ·{" "}
          {period.unitsSold} pcs ({period.sticksSold} sticks) sold · cash variance{" "}
          {formatPHP(period.cashVariance)}. Only closed and approved shifts are counted;
          anything still open is in the tiles below.
        </p>
      </div>

      <h2 className="border-t border-stone-200 pt-4 text-sm font-medium text-stone-900">
        Today — {formatBusinessDate(today.businessDate)}
      </h2>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Net sales today"
          value={formatPHP(today.netSales)}
          note={
            today.vsYesterdayPct
              ? `${Number(today.vsYesterdayPct) >= 0 ? "+" : ""}${today.vsYesterdayPct}% vs yesterday`
              : "no sales yesterday to compare"
          }
          tone={today.vsYesterdayPct && Number(today.vsYesterdayPct) < 0 ? "warning" : "neutral"}
        />
        <StatTile
          label="Against target"
          value={today.targetPct ? `${today.targetPct}%` : "—"}
          note={today.target ? `target ${formatPHP(today.target)}` : "no target set on the carts"}
          tone={targetTone}
        />
        <StatTile
          label="Gross profit today"
          value={formatPHP(today.grossProfit)}
          note={`${today.unitsSold} pcs · ${today.sticksSold} sticks sold`}
        />
        <StatTile
          label="Cash variance today"
          value={formatPHP(today.cashVariance)}
          note={dec(today.cashVariance).isZero() ? "cash reconciles exactly" : "difference against expected cash"}
          tone={dec(today.cashVariance).isNegative() ? "bad" : dec(today.cashVariance).isZero() ? "good" : "warning"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Carts closed" value={`${today.shiftsClosed} of ${today.cartsActive}`} note="counted and reconciled" />
        <StatTile
          label="Still open"
          value={String(today.shiftsOpen)}
          note={today.shiftsOpen ? "not counted back yet" : "all carts accounted for"}
          tone={today.shiftsOpen ? "warning" : "good"}
        />
        <StatTile
          label="Disputed"
          value={String(today.shiftsDisputed)}
          note={today.shiftsDisputed ? "payroll blocked until resolved" : "none"}
          tone={today.shiftsDisputed ? "bad" : "good"}
        />
        {/*
          Replaces the 14-day average that used to sit here: the period block above now
          shows an average over a window the owner chooses, which made this one a second
          answer to the same question. Cash on hand is the figure that had no home.
        */}
        {cash ? (
          <Link href="/cash" className="block transition hover:opacity-80">
            <StatTile
              label="Cash on hand"
              value={formatPHP(cash.balance)}
              /**
               * A written-off difference is settled, so saying it is still "out" would
               * read as an open problem the owner has already dealt with.
               */
              note={
                cash.lastCount
                  ? `counted ${formatBusinessDate(cash.lastCount.businessDate)}${
                      dec(cash.lastCount.variance).isZero()
                        ? ", matched the book"
                        : cash.lastCount.writtenOff
                          ? `, ${formatPHP(cash.lastCount.variance)} written off`
                          : `, ${formatPHP(cash.lastCount.variance)} unexplained`
                    }`
                  : "never counted — count the box"
              }
              tone={
                dec(cash.balance).isNegative()
                  ? "bad"
                  : cash.lastCount && !dec(cash.lastCount.variance).isZero() && !cash.lastCount.writtenOff
                    ? "warning"
                    : "neutral"
              }
            />
          </Link>
        ) : (
          <StatTile
            label="Average day"
            value={formatPHP(today.avgDailySales)}
            note="last 14 trading days, whatever the range above"
          />
        )}
      </div>

      {!hasTraded ? (
        <EmptyState
          title="No sales recorded yet"
          action="Open a cart on the Daily Close board, issue the load-out, then count it back at the end of the day — everything on this page comes from that."
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            Net sales {trendGranularity === "week" ? "by week" : "by day"}, {periodLabel.toLowerCase()}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <TrendBars
            points={trend.map((point) => ({
              label: point.label,
              value: Number(point.netSales),
              sublabel: `${point.shifts} cart${point.shifts === 1 ? "" : "s"}`,
            }))}
            reference={trendGranularity === "day" && today.target ? Number(today.target) : undefined}
            referenceLabel="daily target"
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Carts today</CardTitle></CardHeader>
          <CardBody>
            <RankBars
              rows={carts.map((cart) => ({
                id: cart.id,
                label: cart.name,
                value: Number(cart.netSales),
                sublabel: cart.targetPct ? `${cart.targetPct}% of target` : undefined,
              }))}
              emptyMessage="No active carts in your scope."
            />
            {carts.some((c) => dec(c.cashVariance).isNegative()) ? (
              <p className="mt-3 text-xs text-red-700">
                Short today:{" "}
                {carts
                  .filter((c) => dec(c.cashVariance).isNegative())
                  .map((c) => `${c.name.split(" · ")[0]} ${formatPHP(c.cashVariance)}`)
                  .join(", ")}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Best sellers, {periodLabel.toLowerCase()}</CardTitle></CardHeader>
          <CardBody>
            <RankBars
              rows={bestProducts.map((product) => ({
                id: product.id,
                label: product.name,
                value: Number(product.netSales),
                sublabel: product.marginPct ? `${product.marginPct}% margin` : undefined,
              }))}
              emptyMessage="No products sold yet."
            />
          </CardBody>
        </Card>
      </div>

      {slowProducts.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Slow movers</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-stone-100 text-sm">
              {slowProducts.map((product) => (
                <li key={product.id} className="flex items-center justify-between py-2">
                  <span className="text-stone-700">{product.name}</span>
                  <span className="font-mono tabular-nums text-stone-600">
                    {product.sticksSold} sticks · {formatPHP(product.netSales)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-stone-500">
              Stock that moves slowly ties up cash and risks spoiling. Worth cutting the load-out
              before it becomes wastage.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/shifts" className="font-medium text-brand-700 hover:underline">Daily Close →</Link>
        {can(user, "reports.read") ? (
          <Link href="/reports" className="font-medium text-brand-700 hover:underline">Full P&amp;L →</Link>
        ) : null}
        {can(user, "cost.read") ? (
          <Link href="/costing" className="font-medium text-brand-700 hover:underline">Costing and margins →</Link>
        ) : null}
      </div>
    </div>
  );
}
