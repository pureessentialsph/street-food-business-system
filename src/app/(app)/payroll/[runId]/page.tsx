import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { advancePayrollRun } from "@/lib/actions/payroll";
import { dec, formatPHP } from "@/lib/money";
import { ActionButton } from "@/components/action-button";
import { PageHeader } from "@/components/data-table";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";

type PayLine = { kind: string; label: string; computation: string; amount: string };
type DayBreakdown = {
  businessDate: string;
  shiftId: string;
  basePay: string;
  incentiveTotal: string;
  deductionTotal: string;
  netPay: string;
  lines: PayLine[];
};

/**
 * The payslip. Every peso shows its arithmetic — "54.0 sticks ÷ 50 required = 1 credit
 * × ₱50.00" — because a vendor who cannot check their own pay stops trusting it.
 */
export default async function PayrollRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const user = await requireUser();
  const db = scopedDb(user.companyId);

  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { items: { orderBy: { netPay: "desc" } } },
  });
  if (!run) notFound();

  const employees = await db.employee.findMany({
    where: { id: { in: run.items.map((i) => i.employeeId) } },
  });
  const nameOf = new Map(employees.map((e) => [e.id, `${e.lastName}, ${e.firstName}`]));
  const noOf = new Map(employees.map((e) => [e.id, e.employeeNo]));

  const totals = (run.totals ?? {}) as Record<string, string | number>;
  const canRun = can(user, "payroll.run");
  const canApprove = can(user, "payroll.approve");

  const next = run.status === "DRAFT" ? "REVIEWED" : run.status === "REVIEWED" ? "APPROVED"
    : run.status === "APPROVED" ? "PAID" : null;
  const mayAdvance = next === "APPROVED" ? canApprove : canRun;

  return (
    <div className="space-y-5">
      <PageHeader
        title={run.reference}
        subtitle={`${run.periodStart.toISOString().slice(0, 10)} → ${run.periodEnd.toISOString().slice(0, 10)} · ${run.items.length} employees`}
        action={<Link href="/payroll" className="text-sm font-medium text-brand-700 hover:underline">← All runs</Link>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={run.status === "PAID" || run.status === "APPROVED" ? "success" : run.status === "REVIEWED" ? "warning" : "neutral"}>
          {run.status.toLowerCase()}
        </Badge>
        {Number(totals.heldBack ?? 0) > 0 ? (
          <span className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
            {totals.heldBack} shift{Number(totals.heldBack) === 1 ? "" : "s"} held back — not approved or disputed
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Base pay</p>
          <p className="mt-1 font-mono text-lg font-medium">{formatPHP(dec(totals.basePay ?? 0))}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Incentives</p>
          <p className="mt-1 font-mono text-lg font-medium">{formatPHP(dec(totals.incentives ?? 0))}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Deductions</p>
          <p className="mt-1 font-mono text-lg font-medium">−{formatPHP(dec(totals.deductions ?? 0))}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Net pay</p>
          <p className="mt-1 font-mono text-lg font-medium">{formatPHP(dec(totals.netPay ?? 0))}</p>
        </CardBody></Card>
      </div>

      {next && mayAdvance ? (
        <div className="flex justify-end">
          <ActionButton
            action={advancePayrollRun.bind(null, run.id, next)}
            label={next === "REVIEWED" ? "Mark reviewed" : next === "APPROVED" ? "Approve payroll" : "Mark paid"}
            pendingLabel="Working…"
            variant="primary"
          />
        </div>
      ) : next ? (
        <p className="rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-600">
          {next === "APPROVED"
            ? "Waiting on an owner, admin or area manager to approve."
            : "You do not have permission to advance this run."}
        </p>
      ) : null}

      {run.items.map((item) => {
        const breakdown = (item.breakdown ?? {}) as { days?: DayBreakdown[] };
        const days = breakdown.days ?? [];
        return (
          <Card key={item.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>
                  {nameOf.get(item.employeeId) ?? "—"}{" "}
                  <span className="font-normal text-stone-500">· {noOf.get(item.employeeId)} · {item.daysWorked} day{item.daysWorked === 1 ? "" : "s"}</span>
                </CardTitle>
                <span className="font-mono text-base font-medium">{formatPHP(item.netPay)}</span>
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div><span className="text-stone-500">Base</span><p className="font-mono">{formatPHP(item.basePayTotal)}</p></div>
                <div><span className="text-stone-500">Incentives</span><p className="font-mono">{formatPHP(item.incentiveTotal)}</p></div>
                <div><span className="text-stone-500">Deductions</span><p className="font-mono">−{formatPHP(item.deductionTotal)}</p></div>
              </div>

              {days.map((day) => (
                <details key={day.shiftId} className="rounded-md border border-stone-200">
                  <summary className="cursor-pointer px-3 py-2 text-sm">
                    <span className="font-medium text-stone-800">{day.businessDate}</span>
                    <span className="ml-2 text-stone-500">
                      base {formatPHP(day.basePay)} · incentive {formatPHP(day.incentiveTotal)}
                      {Number(day.deductionTotal) > 0 ? ` · less ${formatPHP(day.deductionTotal)}` : ""}
                    </span>
                    <span className="float-right font-mono">{formatPHP(day.netPay)}</span>
                  </summary>
                  <ul className="divide-y divide-stone-100 border-t border-stone-100 text-sm">
                    {day.lines.map((line, index) => (
                      <li key={`${day.shiftId}-${index}`} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                        <span className="min-w-0">
                          <span className={`font-medium ${line.kind === "DEDUCTION" ? "text-red-800" : "text-stone-800"}`}>
                            {line.label}
                          </span>
                          <span className="block text-xs text-stone-500">{line.computation}</span>
                        </span>
                        <span className={`font-mono tabular-nums ${line.kind === "DEDUCTION" ? "text-red-800" : ""}`}>
                          {line.kind === "DEDUCTION" && Number(line.amount) > 0 ? "−" : ""}
                          {formatPHP(line.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex justify-between border-t border-stone-200 px-3 py-2 text-sm font-medium">
                    <span>Take-home for the day</span>
                    <span className="font-mono">{formatPHP(day.netPay)}</span>
                  </div>
                  <Link
                    href={`/shifts/${day.shiftId}`}
                    className="block border-t border-stone-100 px-3 py-2 text-xs font-medium text-brand-700 hover:underline"
                  >
                    See the shift this came from →
                  </Link>
                </details>
              ))}
            </CardBody>
          </Card>
        );
      })}

      {run.items.length === 0 ? (
        <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center">
          <p className="text-sm font-medium text-stone-700">Nothing in this run</p>
          <p className="mt-1 text-sm text-stone-500">No approved shifts fell inside the period.</p>
        </div>
      ) : null}
    </div>
  );
}
