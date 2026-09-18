import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { assertScope, can, seesAllBranches } from "@/lib/rbac";
import { businessDateFor, toDateColumn, trailingBusinessDates } from "@/lib/businessDate";
import { dec, divide, formatPHP, percentOf, sum, ZERO } from "@/lib/money";
import { profitAndLoss } from "@/lib/engines/profitability";
import { RankBars, StatTile, TrendBars } from "@/components/charts";
import { PageHeader } from "@/components/data-table";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";

/** One cart's scorecard: is it earning its place at that location? */
export default async function CartScorecardPage({
  params,
}: {
  params: Promise<{ cartId: string }>;
}) {
  const { cartId } = await params;
  const user = await requireUser();
  const db = scopedDb(user.companyId);

  const cart = await db.cart.findUnique({
    where: { id: cartId },
    include: { branch: true, location: true, defaultVendor: true },
  });
  if (!cart) notFound();
  if (!seesAllBranches(user)) assertScope(user, cart.branchId);

  const company = await db.company.findFirst({ where: { id: user.companyId } });
  const todayDate = businessDateFor(new Date(), company?.businessDayCutoffHour ?? 4, company?.timezone ?? "Asia/Manila");
  const window = trailingBusinessDates(todayDate, 14);
  const from = toDateColumn(window[0]!);
  const to = toDateColumn(todayDate);

  const [shifts, lines, expenses, compensations, products, employees, supplies] = await Promise.all([
    db.cartShift.findMany({
      where: { cartId, businessDate: { gte: from, lte: to } },
      orderBy: { businessDate: "asc" },
    }),
    db.shiftLine.findMany({
      where: { shift: { cartId, businessDate: { gte: from, lte: to } } },
      include: { shift: { select: { businessDate: true, status: true, employeeId: true } } },
    }),
    db.expense.findMany({
      where: { scopeType: "CART", scopeId: cartId, status: "APPROVED", businessDate: { gte: from, lte: to } },
      include: { category: { select: { name: true } } },
    }),
    db.shiftCompensation.findMany({ where: { businessDate: { gte: from, lte: to } } }),
    db.product.findMany({ select: { id: true, name: true } }),
    db.employee.findMany({ select: { id: true, firstName: true, lastName: true } }),
    db.shiftSupply.findMany({
      where: { shift: { cartId, businessDate: { gte: from, lte: to } } },
      include: { shift: { select: { businessDate: true } } },
    }),
  ]);

  const supplyNames = new Map(
    (await db.ingredient.findMany({ select: { id: true, name: true, baseUnit: true } }))
      .map((i) => [i.id, { name: i.name, unit: i.baseUnit }]),
  );

  /** Equipment currently on this cart — retired and lost kit is history, not kit. */
  const assets = await db.asset.findMany({
    where: {
      locationType: "CART",
      locationId: cartId,
      status: { notIn: ["RETIRED", "LOST"] },
    },
    orderBy: { tag: "asc" },
  });

  const counted = shifts.filter((s) => s.status === "CLOSED" || s.status === "APPROVED");
  const shiftIds = new Set(counted.map((s) => s.id));
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const employeeName = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));

  const netSales = sum(counted.map((s) => s.netSales));
  const cogs = sum(counted.map((s) => s.cogs));
  const waste = sum(counted.map((s) => s.wasteCost));
  const labour = sum(
    compensations.filter((c) => shiftIds.has(c.shiftId)).map((c) => c.netPay),
  );
  const directExpenses = sum(expenses.map((e) => e.amount));

  const pnl = profitAndLoss({
    netSales, cogs, labourCost: labour, wasteCost: waste, directExpenses,
  });

  const countedLines = lines.filter((l) => l.shift.status === "CLOSED" || l.shift.status === "APPROVED");
  const issued = sum(countedLines.map((l) => l.piecesIssued));
  const sold = sum(countedLines.map((l) => l.piecesSold));
  const wasted = sum(countedLines.map((l) => l.piecesWasted));

  const trend = window.map((date) => {
    const column = toDateColumn(date);
    const day = counted.filter((s) => s.businessDate.getTime() === column.getTime());
    return {
      label: new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", { day: "numeric", month: "short" }),
      value: Number(sum(day.map((s) => s.netSales)).toFixed(2)),
    };
  });

  const byProduct = new Map<string, ReturnType<typeof dec>>();
  for (const line of countedLines) {
    byProduct.set(line.productId, (byProduct.get(line.productId) ?? ZERO).plus(line.netSales.toString()));
  }

  const vendorDays = new Map<string, number>();
  for (const shift of counted) {
    vendorDays.set(shift.employeeId, (vendorDays.get(shift.employeeId) ?? 0) + 1);
  }

  const supplyTotals = new Map<string, ReturnType<typeof dec>>();
  for (const supply of supplies) {
    const used = supply.qtyConsumed ?? ZERO;
    supplyTotals.set(supply.ingredientId, (supplyTotals.get(supply.ingredientId) ?? ZERO).plus(used.toString()));
  }

  const avgDay = counted.length ? divide(netSales, counted.length) ?? ZERO : ZERO;
  const target = cart.dailySalesTarget ? dec(cart.dailySalesTarget) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${cart.code} — scorecard`}
        subtitle={`${cart.name} · ${cart.location?.name ?? "unassigned"} · ${cart.branch.code} · last 14 days`}
        action={
          <div className="flex gap-3 text-sm">
            <Link href="/carts" className="font-medium text-brand-700 hover:underline">← All carts</Link>
            {can(user, "masterdata.write") ? (
              <Link href={`/carts?edit=${cart.id}`} className="font-medium text-brand-700 hover:underline">
                Edit cart
              </Link>
            ) : null}
            {can(user, "reports.read") ? (
              <Link href={`/reports?level=CART&id=${cart.id}`} className="font-medium text-brand-700 hover:underline">
                P&amp;L →
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={cart.status === "ACTIVE" ? "success" : cart.status === "RETIRED" ? "danger" : "warning"}>
          {cart.status.toLowerCase()}
        </Badge>
        <span className="text-stone-500">
          {cart.defaultVendor
            ? `Usual vendor: ${cart.defaultVendor.firstName} ${cart.defaultVendor.lastName}`
            : "No usual vendor set"}
        </span>
      </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Equipment on this cart</CardTitle>
              <Link href="/assets" className="text-sm font-medium text-brand-700 hover:underline">
                All assets →
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {assets.length === 0 ? (
              <p className="text-sm text-stone-500">
                Nothing assigned. A cart that trades needs a fryer, a tank and utensils on
                its name — otherwise nobody is accountable for them.
              </p>
            ) : (
              <ul className="divide-y divide-stone-100 text-sm">
                {assets.map((asset) => (
                  <li key={asset.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-mono text-xs text-stone-500">{asset.tag}</span>{" "}
                      <span className="font-medium text-stone-900">{asset.name}</span>
                      {asset.condition === "GOOD" ? null : (
                        <span className="ml-2 text-xs font-medium text-amber-700">
                          {asset.condition === "UNSERVICEABLE" ? "unserviceable" : "needs repair"}
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-stone-600">{formatPHP(asset.acquisitionCost)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

      {counted.length === 0 ? (
        <EmptyState
          title="This cart has not traded in the last 14 days"
          action="Open it on the Daily Close board and issue a load-out to start building its record."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Net sales" value={formatPHP(netSales)} note={`${counted.length} trading day${counted.length === 1 ? "" : "s"}`} />
            <StatTile
              label="Average day"
              value={formatPHP(avgDay)}
              note={target ? `target ${formatPHP(target)}` : "no target set"}
              tone={target && avgDay.lessThan(target) ? "warning" : "neutral"}
            />
            <StatTile
              label="Operating profit"
              value={formatPHP(pnl.operatingProfit)}
              note={pnl.operatingMarginPct ? `${pnl.operatingMarginPct.toFixed(1)}% margin` : undefined}
              tone={pnl.operatingProfit.isNegative() ? "bad" : "good"}
            />
            <StatTile
              label="Sell-through"
              value={issued.greaterThan(0) ? `${percentOf(sold, issued)?.toFixed(0)}%` : "—"}
              note={`${wasted.toFixed(0)} pcs wasted of ${issued.toFixed(0)} issued`}
              tone={issued.greaterThan(0) && percentOf(sold, issued)!.lessThan(80) ? "warning" : "neutral"}
            />
          </div>

          <Card>
            <CardHeader><CardTitle>Net sales by day</CardTitle></CardHeader>
            <CardBody>
              <TrendBars points={trend} reference={target ? Number(target) : undefined} referenceLabel="target" />
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>What this cart sells</CardTitle></CardHeader>
              <CardBody>
                <RankBars
                  rows={[...byProduct.entries()]
                    .map(([id, value]) => ({ id, label: productName.get(id) ?? id, value: Number(value.toFixed(2)) }))
                    .sort((a, b) => b.value - a.value)}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Profit ladder</CardTitle></CardHeader>
              <CardBody>
                <ul className="space-y-1 text-sm">
                  <li className="flex justify-between"><span className="text-stone-600">Net sales</span><span className="font-mono">{formatPHP(pnl.netSales)}</span></li>
                  <li className="flex justify-between"><span className="text-stone-600">Cost of goods</span><span className="font-mono text-red-700">−{formatPHP(pnl.cogs)}</span></li>
                  <li className="flex justify-between border-t border-stone-200 pt-1 font-medium"><span>Gross profit</span><span className="font-mono">{formatPHP(pnl.grossProfit)}</span></li>
                  <li className="flex justify-between"><span className="text-stone-600">Vendor pay</span><span className="font-mono text-red-700">−{formatPHP(pnl.labourCost)}</span></li>
                  <li className="flex justify-between"><span className="text-stone-600">Wastage</span><span className="font-mono text-red-700">−{formatPHP(pnl.wasteCost)}</span></li>
                  <li className="flex justify-between"><span className="text-stone-600">Cart expenses</span><span className="font-mono text-red-700">−{formatPHP(pnl.directExpenses)}</span></li>
                  <li className="flex justify-between border-t-2 border-stone-300 pt-1 font-semibold">
                    <span>Operating profit</span>
                    <span className={`font-mono ${pnl.operatingProfit.isNegative() ? "text-red-700" : "text-emerald-700"}`}>
                      {formatPHP(pnl.operatingProfit)}
                    </span>
                  </li>
                </ul>
                {expenses.length > 0 ? (
                  <p className="mt-3 text-xs text-stone-500">
                    Cart expenses: {expenses.map((e) => `${e.category.name} ${formatPHP(e.amount)}`).join(", ")}.
                  </p>
                ) : null}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Who worked it</CardTitle></CardHeader>
            <CardBody>
              <ul className="divide-y divide-stone-100 text-sm">
                {[...vendorDays.entries()].map(([employeeId, days]) => (
                  <li key={employeeId} className="flex items-center justify-between py-2">
                    <Link href={`/employees/${employeeId}`} className="font-medium text-brand-700 hover:underline">
                      {employeeName.get(employeeId) ?? employeeId}
                    </Link>
                    <span className="text-stone-600">{days} day{days === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {supplyTotals.size > 0 ? (
            <Card>
              <CardHeader><CardTitle>Supplies consumed</CardTitle></CardHeader>
              <CardBody>
                <p className="mb-2 text-xs text-stone-500">
                  Already costed inside the products — shown so a cart getting through more
                  packaging than its neighbours is visible.
                </p>
                <ul className="divide-y divide-stone-100 text-sm">
                  {[...supplyTotals.entries()]
                    .sort((a, b) => b[1].comparedTo(a[1]))
                    .map(([id, qty]) => (
                      <li key={id} className="flex items-center justify-between py-1.5">
                        <span className="text-stone-700">{supplyNames.get(id)?.name ?? "(unknown item)"}</span>
                        <span className="font-mono tabular-nums">
                          {qty.toFixed(0)}{" "}
                          <span className="text-xs text-stone-500">
                            {supplyNames.get(id)?.unit === "G" ? "g" : supplyNames.get(id)?.unit === "ML" ? "ml" : "pcs"}
                          </span>
                        </span>
                      </li>
                    ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
