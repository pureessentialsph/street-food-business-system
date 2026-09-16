import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { businessDateFor, toDateColumn, trailingBusinessDates } from "@/lib/businessDate";
import { dec, divide, formatPHP, percentOf, sum, ZERO } from "@/lib/money";
import { RankBars, StatTile, TrendBars } from "@/components/charts";
import { PageHeader } from "@/components/data-table";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";

/**
 * One vendor's scorecard. Deliberately shows sell-through and cash accuracy next to
 * sales: a vendor who sells a lot but is short every day is not the top performer.
 */
export default async function EmployeeScorecardPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const showPay = can(user, "pay.readAll") || user.employeeId === employeeId;

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { branch: true, assignedCart: true, compensationScheme: true, supervisor: true },
  });
  if (!employee) notFound();

  const company = await db.company.findFirst({ where: { id: user.companyId } });
  const todayDate = businessDateFor(new Date(), company?.businessDayCutoffHour ?? 4, company?.timezone ?? "Asia/Manila");
  const window = trailingBusinessDates(todayDate, 14);
  const from = toDateColumn(window[0]!);
  const to = toDateColumn(todayDate);

  const [shifts, lines, compensations, deductions, products, events] = await Promise.all([
    db.cartShift.findMany({
      where: { employeeId, businessDate: { gte: from, lte: to } },
      orderBy: { businessDate: "asc" },
    }),
    db.shiftLine.findMany({
      where: { shift: { employeeId, businessDate: { gte: from, lte: to } } },
      include: { shift: { select: { businessDate: true, status: true } } },
    }),
    db.shiftCompensation.findMany({
      where: { employeeId, businessDate: { gte: from, lte: to } },
      orderBy: { businessDate: "asc" },
    }),
    db.deduction.findMany({
      where: { employeeId, businessDate: { gte: from, lte: to } },
      orderBy: { businessDate: "desc" },
    }),
    db.product.findMany({ select: { id: true, name: true } }),
    db.employmentEvent.findMany({ where: { employeeId }, orderBy: { effectiveDate: "desc" }, take: 5 }),
  ]);

  const counted = shifts.filter((s) => s.status === "CLOSED" || s.status === "APPROVED");
  const countedLines = lines.filter((l) => l.shift.status === "CLOSED" || l.shift.status === "APPROVED");
  const productName = new Map(products.map((p) => [p.id, p.name]));

  const netSales = sum(counted.map((s) => s.netSales));
  const issued = sum(countedLines.map((l) => l.piecesIssued));
  const sold = sum(countedLines.map((l) => l.piecesSold));
  const wasted = sum(countedLines.map((l) => l.piecesWasted));
  const shortfalls = counted.filter((s) => dec(s.cashVariance).isNegative());
  const totalShort = sum(shortfalls.map((s) => dec(s.cashVariance).abs()));
  const pay = sum(compensations.map((c) => c.netPay));
  const incentives = sum(compensations.map((c) => c.incentiveTotal));

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
    byProduct.set(line.productId, (byProduct.get(line.productId) ?? ZERO).plus(line.sticksSold.toString()));
  }

  const avgDay = counted.length ? divide(netSales, counted.length) ?? ZERO : ZERO;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${employee.firstName} ${employee.lastName} — scorecard`}
        subtitle={`${employee.employeeNo} · ${employee.position} · ${employee.branch?.code ?? "no branch"} · last 14 days`}
        action={
          <div className="flex gap-3 text-sm">
            <Link href="/employees" className="font-medium text-brand-700 hover:underline">← All employees</Link>
            {can(user, "employee.documents") ? (
              <Link href={`/employees/${employeeId}/documents`} className="font-medium text-brand-700 hover:underline">
                201 file →
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={employee.isActive ? "success" : "danger"}>
          {employee.isActive ? employee.employmentStatus.replace("_", " ").toLowerCase() : "inactive"}
        </Badge>
        {employee.assignedCart ? <span className="text-stone-500">Cart {employee.assignedCart.code}</span> : null}
        {employee.compensationScheme ? <span className="text-stone-500">{employee.compensationScheme.name}</span> : null}
        {employee.supervisor ? (
          <span className="text-stone-500">Reports to {employee.supervisor.firstName} {employee.supervisor.lastName}</span>
        ) : null}
      </div>

      {counted.length === 0 ? (
        <EmptyState
          title="No closed shifts in the last 14 days"
          action="Their scorecard fills in as shifts are counted back and closed."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Net sales" value={formatPHP(netSales)} note={`${counted.length} shift${counted.length === 1 ? "" : "s"}`} />
            <StatTile label="Average shift" value={formatPHP(avgDay)} />
            <StatTile
              label="Sell-through"
              value={issued.greaterThan(0) ? `${percentOf(sold, issued)?.toFixed(0)}%` : "—"}
              note={`${wasted.toFixed(0)} pcs wasted`}
              tone={issued.greaterThan(0) && percentOf(sold, issued)!.lessThan(80) ? "warning" : "good"}
            />
            <StatTile
              label="Cash accuracy"
              value={shortfalls.length === 0 ? "exact" : `${shortfalls.length} short`}
              note={shortfalls.length ? `${formatPHP(totalShort)} in total` : "every shift reconciled"}
              tone={shortfalls.length === 0 ? "good" : totalShort.greaterThan(100) ? "bad" : "warning"}
            />
          </div>

          {showPay ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Pay earned" value={formatPHP(pay)} note="base plus incentives, less deductions" />
              <StatTile label="Of which incentive" value={formatPHP(incentives)} note="set credits earned" />
              <StatTile label="Daily rate" value={formatPHP(employee.dailyRate)} />
              <StatTile
                label="Deductions"
                value={formatPHP(sum(deductions.map((d) => d.amount)))}
                note={`${deductions.length} entr${deductions.length === 1 ? "y" : "ies"}`}
                tone={deductions.length ? "warning" : "good"}
              />
            </div>
          ) : null}

          <Card>
            <CardHeader><CardTitle>Sales by day</CardTitle></CardHeader>
            <CardBody><TrendBars points={trend} /></CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>What they sell, in sticks</CardTitle></CardHeader>
              <CardBody>
                <RankBars
                  rows={[...byProduct.entries()]
                    .map(([id, value]) => ({ id, label: productName.get(id) ?? id, value: Number(value.toFixed(1)) }))
                    .sort((a, b) => b.value - a.value)}
                  valueFormat={(v) => `${v.toFixed(1)} sticks`}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle>Cash record</CardTitle></CardHeader>
              <CardBody>
                {counted.length === 0 ? null : (
                  <ul className="divide-y divide-stone-100 text-sm">
                    {counted.slice().reverse().map((shift) => (
                      <li key={shift.id} className="flex items-center justify-between py-2">
                        <Link href={`/shifts/${shift.id}`} className="text-brand-700 hover:underline">
                          {shift.businessDate.toISOString().slice(0, 10)}
                        </Link>
                        <span className="flex items-center gap-3 font-mono tabular-nums">
                          <span className="text-stone-600">{formatPHP(shift.netSales)}</span>
                          <span className={dec(shift.cashVariance).isNegative() ? "text-red-700" : dec(shift.cashVariance).isZero() ? "text-emerald-700" : "text-amber-700"}>
                            {dec(shift.cashVariance).isZero() ? "exact" : formatPHP(shift.cashVariance)}
                          </span>
                          {!shift.vendorAcknowledged && dec(shift.cashVariance).isNegative() ? (
                            <span className="text-xs text-amber-700">not acknowledged</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          {showPay && deductions.length > 0 ? (
            <Card>
              <CardHeader><CardTitle>Deductions</CardTitle></CardHeader>
              <CardBody>
                <ul className="divide-y divide-stone-100 text-sm">
                  {deductions.map((deduction) => (
                    <li key={deduction.id} className="flex items-center justify-between py-2">
                      <span>
                        <span className="font-medium text-stone-900">
                          {deduction.type.replace(/_/g, " ").toLowerCase()}
                        </span>
                        <span className="block text-xs text-stone-500">
                          {deduction.businessDate.toISOString().slice(0, 10)} · {deduction.note ?? "no note"}
                          {!deduction.acknowledged ? " · not acknowledged" : ""}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums">{formatPHP(deduction.amount)}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </>
      )}

      {events.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Employment history</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-stone-100 text-sm">
              {events.map((event) => (
                <li key={event.id} className="flex items-center justify-between py-2">
                  <span className="font-medium text-stone-800">{event.type.replace(/_/g, " ").toLowerCase()}</span>
                  <span className="text-stone-500">{event.effectiveDate.toISOString().slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
