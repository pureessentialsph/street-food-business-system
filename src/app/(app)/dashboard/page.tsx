import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can, seesAllBranches, ROLE_LABELS } from "@/lib/rbac";
import { buildDashboard } from "@/lib/dashboard-service";
import { formatBusinessDate } from "@/lib/businessDate";
import { dec, formatPHP } from "@/lib/money";
import { RankBars, StatTile, TrendBars } from "@/components/charts";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/data-table";

/**
 * The page the owner opens in the morning (spec §7): how yesterday went, which carts
 * did it, and what needs attention — without touching a spreadsheet.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const db = scopedDb(user.companyId);

  const company = await db.company.findFirst({ where: { id: user.companyId } });
  const dashboard = await buildDashboard(db, {
    branchIds: seesAllBranches(user) ? undefined : user.scopeBranchIds,
  });
  const { today, trend, carts, bestProducts, slowProducts, alerts } = dashboard;

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

      {alerts.length > 0 ? (
        <div className="space-y-2">
          {alerts.map((alert) => (
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
        <StatTile label="Average day" value={formatPHP(today.avgDailySales)} note="over the last 14 trading days" />
      </div>

      {!hasTraded ? (
        <EmptyState
          title="No sales recorded yet"
          action="Open a cart on the Daily Close board, issue the load-out, then count it back at the end of the day — everything on this page comes from that."
        />
      ) : null}

      <Card>
        <CardHeader><CardTitle>Net sales, last 14 days</CardTitle></CardHeader>
        <CardBody>
          <TrendBars
            points={trend.map((point) => ({
              label: point.label,
              value: Number(point.netSales),
              sublabel: `${point.shifts} cart${point.shifts === 1 ? "" : "s"}`,
            }))}
            reference={today.target ? Number(today.target) : undefined}
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
          <CardHeader><CardTitle>Best sellers, last 14 days</CardTitle></CardHeader>
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
