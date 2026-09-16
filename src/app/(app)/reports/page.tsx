import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { seesAllBranches } from "@/lib/rbac";
import { buildPnl, type PnlScope } from "@/lib/pnl-service";
import { dec, formatPHP } from "@/lib/money";
import { strongSalesWeakProfit } from "@/lib/engines/profitability";
import { PageHeader } from "@/components/data-table";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Profit and loss, drillable from company to branch to cart to a single shift.
 *
 * Each level is the same arithmetic over a smaller set, so the numbers reconcile:
 * a branch is exactly the sum of its carts (spec §10).
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; level?: string; id?: string; overhead?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);

  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  const from = new Date(`${params.from ?? iso(defaultFrom)}T00:00:00.000Z`);
  const to = new Date(`${params.to ?? iso(today)}T00:00:00.000Z`);

  const level = (params.level ?? "COMPANY").toUpperCase();
  const scope: PnlScope =
    level === "BRANCH" && params.id ? { level: "BRANCH", id: params.id }
      : level === "CART" && params.id ? { level: "CART", id: params.id }
        : { level: "COMPANY" };

  // A supervisor sees their own branch, not the company.
  const effectiveScope: PnlScope =
    scope.level === "COMPANY" && !seesAllBranches(user) && user.scopeBranchIds[0]
      ? { level: "BRANCH", id: user.scopeBranchIds[0] }
      : scope;

  const showOverhead = params.overhead === "1";
  const report = await buildPnl(db, from, to, effectiveScope, { allocateOverhead: showOverhead });

  const [branch, cart] = await Promise.all([
    effectiveScope.level === "BRANCH" ? db.branch.findUnique({ where: { id: effectiveScope.id } }) : null,
    effectiveScope.level === "CART"
      ? db.cart.findUnique({ where: { id: effectiveScope.id }, include: { branch: true } })
      : null,
  ]);

  const title =
    effectiveScope.level === "COMPANY" ? "Company profit and loss"
      : effectiveScope.level === "BRANCH" ? `${branch?.code ?? "Branch"} — profit and loss`
        : `${cart?.code ?? "Cart"} — profit and loss`;

  const childLabel =
    effectiveScope.level === "COMPANY" ? "Branches"
      : effectiveScope.level === "BRANCH" ? "Carts" : "Shifts";
  const childSingular =
    effectiveScope.level === "COMPANY" ? "Branch"
      : effectiveScope.level === "BRANCH" ? "Cart" : "Shift";

  const query = `from=${iso(from)}&to=${iso(to)}${showOverhead ? "&overhead=1" : ""}`;
  const thin = strongSalesWeakProfit(
    report.rows.map((r) => ({ id: r.id, name: r.name, netSales: r.netSales, operatingProfit: r.operatingProfit })),
  );

  const ladder = [
    { label: "Net sales", value: report.totals.netSales, strong: false },
    { label: "Cost of goods sold", value: report.totals.cogs.negated(), strong: false },
    { label: "Gross profit", value: report.totals.grossProfit, strong: true },
    { label: "Vendor pay", value: report.totals.labourCost.negated(), strong: false },
    { label: "Wastage", value: report.totals.wasteCost.negated(), strong: false },
    { label: "Operating expenses", value: report.totals.directExpenses.negated(), strong: false },
    { label: "Operating profit", value: report.totals.operatingProfit, strong: true },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        subtitle={`${iso(from)} → ${iso(to)} · ${report.shiftCount} closed shift${report.shiftCount === 1 ? "" : "s"}`}
        action={
          effectiveScope.level !== "COMPANY" && seesAllBranches(user) ? (
            <Link href={`/reports?${query}`} className="text-sm font-medium text-brand-700 hover:underline">
              ← Whole company
            </Link>
          ) : null
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="level" value={effectiveScope.level} />
        {effectiveScope.level !== "COMPANY" ? (
          <input type="hidden" name="id" value={"id" in effectiveScope ? effectiveScope.id : ""} />
        ) : null}
        <label className="text-sm">
          <span className="mb-1 block text-stone-600">From</span>
          <input type="date" name="from" defaultValue={iso(from)} className="h-11 rounded-md border border-stone-300 px-3 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-stone-600">To</span>
          <input type="date" name="to" defaultValue={iso(to)} className="h-11 rounded-md border border-stone-300 px-3 text-sm" />
        </label>
        {effectiveScope.level === "COMPANY" ? (
          <label className="flex h-11 items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" name="overhead" value="1" defaultChecked={showOverhead} className="h-5 w-5 rounded border-stone-300 text-brand-600" />
            Push overhead down to branches
          </label>
        ) : null}
        <button type="submit" className="h-11 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium hover:bg-stone-100">
          Apply
        </button>
        <a
          href={`/api/export?kind=pnl&${query}&level=${effectiveScope.level}${"id" in effectiveScope ? `&id=${effectiveScope.id}` : ""}`}
          className="flex h-11 items-center rounded-md border border-stone-300 bg-white px-4 text-sm font-medium hover:bg-stone-100"
        >
          Export P&amp;L
        </a>
        <a
          href={`/api/export?kind=shifts&${query}`}
          className="flex h-11 items-center rounded-md border border-stone-300 bg-white px-4 text-sm font-medium hover:bg-stone-100"
        >
          Export shifts
        </a>
      </form>

      {report.heldShifts > 0 ? (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">{report.heldShifts} shift{report.heldShifts === 1 ? " is" : "s are"} not in these figures</span>{" "}
          — still open or disputed. Profit here is what has actually been counted and closed.
        </div>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Where the money went</CardTitle></CardHeader>
        <CardBody>
          <ul className="space-y-1 text-sm">
            {ladder.map((line) => (
              <li
                key={line.label}
                className={`flex justify-between ${line.strong ? "border-t border-stone-200 pt-1 font-medium" : ""}`}
              >
                <span className={line.strong ? "text-stone-900" : "text-stone-600"}>{line.label}</span>
                <span className={`font-mono tabular-nums ${line.value.isNegative() ? "text-red-700" : ""}`}>
                  {formatPHP(line.value)}
                </span>
              </li>
            ))}
            {effectiveScope.level === "COMPANY" ? (
              <>
                <li className="flex justify-between text-sm">
                  <span className="text-stone-600">Company overhead</span>
                  <span className="font-mono tabular-nums text-red-700">−{formatPHP(report.overheadTotal)}</span>
                </li>
                <li className="flex justify-between border-t-2 border-stone-300 pt-1 text-base font-semibold">
                  <span>Net profit</span>
                  <span className={`font-mono tabular-nums ${report.totals.netProfit.isNegative() ? "text-red-700" : "text-emerald-700"}`}>
                    {formatPHP(report.totals.netProfit)}
                  </span>
                </li>
              </>
            ) : null}
          </ul>
          <p className="mt-3 text-xs text-stone-500">
            Wastage sits below gross profit on purpose: keeping it out of cost of goods is what
            makes one cart&apos;s product margin comparable with another&apos;s.
            {report.totals.operatingMarginPct
              ? ` Operating margin ${report.totals.operatingMarginPct.toFixed(1)}%.`
              : ""}
          </p>
        </CardBody>
      </Card>

      {dec(report.totals.netSales).greaterThan(0) && dec(report.totals.cogs).isZero() ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-medium">Gross profit here is overstated.</span>{" "}
          Sales were recorded but cost of goods came out at zero, which means the products sold
          had no cost when they were issued — usually a product with no recipe. Add recipes under{" "}
          <Link href="/costing" className="font-medium underline">Costing</Link>, and shifts from
          then on will carry a real cost.
        </div>
      ) : null}

      {thin.length > 0 ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-medium">Selling well, keeping little.</span>{" "}
          {thin.map((t) => `${t.name} at ${t.marginPct.toFixed(1)}%`).join(", ")} — busy, but the
          money is going somewhere other than profit.
        </div>
      ) : null}

      <Card>
        <CardHeader><CardTitle>{childLabel}</CardTitle></CardHeader>
        <CardBody>
          {report.rows.length === 0 ? (
            <EmptyState
              title="No closed shifts in this period"
              action="Close and approve some shifts, then the profit for each one appears here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">{childSingular}</th>
                    <th className="px-3 py-2 text-right">Net sales</th>
                    <th className="px-3 py-2 text-right">COGS</th>
                    <th className="px-3 py-2 text-right">Gross</th>
                    <th className="px-3 py-2 text-right">Pay</th>
                    <th className="px-3 py-2 text-right">Waste</th>
                    <th className="px-3 py-2 text-right">Expenses</th>
                    {showOverhead ? <th className="px-3 py-2 text-right">Overhead</th> : null}
                    <th className="px-3 py-2 text-right">Operating profit</th>
                    <th className="px-3 py-2 text-right">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {report.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-stone-50">
                      <td className="px-3 py-2 font-medium">
                        {row.href ? (
                          <Link href={`${row.href}${row.href.includes("?") ? "&" : "?"}${query}`} className="text-brand-700 hover:underline">
                            {row.name}
                          </Link>
                        ) : row.name}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPHP(row.netSales)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-500">{formatPHP(row.cogs)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPHP(row.grossProfit)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-500">{formatPHP(row.labourCost)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-500">{formatPHP(row.wasteCost)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-500">{formatPHP(row.directExpenses)}</td>
                      {showOverhead ? (
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-500">{formatPHP(row.allocatedOverhead)}</td>
                      ) : null}
                      <td className={`px-3 py-2 text-right font-mono tabular-nums font-medium ${dec(row.operatingProfit).isNegative() ? "text-red-700" : ""}`}>
                        {formatPHP(showOverhead ? row.netProfit : row.operatingProfit)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{row.marginPct ? `${row.marginPct}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-stone-500">
            Every figure is clickable down to the shift that produced it. A branch is exactly the
            sum of its carts, and a cart exactly the sum of its shifts.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
