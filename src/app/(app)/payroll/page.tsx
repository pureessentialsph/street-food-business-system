import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { createPayrollRun, recordDeduction } from "@/lib/actions/payroll";
import { dec, formatPHP, sum } from "@/lib/money";
import { DataTable, PageHeader } from "@/components/data-table";
import { EntityForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Field, NumberInput, Select, TextInput } from "@/components/ui/field";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; deduct?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const canRun = can(user, "payroll.run");

  const [runs, branches, employees, pending, deductions] = await Promise.all([
    db.payrollRun.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: { periodStart: "desc" },
      take: 20,
    }),
    db.branch.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { lastName: "asc" } }),
    // Pay computed but not yet in any run — what is waiting to be paid.
    db.shiftCompensation.findMany({ where: { payrollItemId: null }, orderBy: { businessDate: "desc" } }),
    db.deduction.findMany({
      where: { payrollItemId: null, type: { not: "CASH_SHORTAGE" } },
      orderBy: { businessDate: "desc" },
      take: 10,
    }),
  ]);

  const nameOf = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
  const unpaidTotal = sum(pending.map((p) => p.netPay));

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const tone = (status: string) =>
    status === "PAID" ? "success" : status === "APPROVED" ? "success"
      : status === "REVIEWED" ? "warning" : "neutral";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payroll"
        subtitle="Built from closed shifts. Every peso traces back to a rule and a count."
        action={
          canRun && !params.new && !params.deduct ? (
            <div className="flex gap-2">
              <Link href="/payroll?deduct=1"><Button variant="secondary">Record deduction</Button></Link>
              <Link href="/payroll?new=1"><Button>New payroll run</Button></Link>
            </div>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Pay not yet in a run</p>
          <p className="mt-1 font-mono text-lg font-medium">{formatPHP(unpaidTotal)}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Shifts waiting</p>
          <p className="mt-1 font-mono text-lg font-medium">{pending.length}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Open deductions</p>
          <p className="mt-1 font-mono text-lg font-medium">{deductions.length}</p>
        </CardBody></Card>
      </div>

      {canRun && params.new === "1" ? (
        <Card>
          <CardHeader><CardTitle>New payroll run</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={createPayrollRun} returnTo="/payroll" submitLabel="Build run">
              <Field label="Period start" name="periodStart" required>
                <TextInput id="periodStart" name="periodStart" type="date" defaultValue={iso(weekAgo)} required />
              </Field>
              <Field label="Period end" name="periodEnd" required>
                <TextInput id="periodEnd" name="periodEnd" type="date" defaultValue={iso(today)} required />
              </Field>
              <Field label="Branch" name="branchId" hint="Leave blank to include every branch.">
                <Select id="branchId" name="branchId" defaultValue="">
                  <option value="">All branches</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                </Select>
              </Field>
              <Field label="Notes" name="notes">
                <TextInput id="notes" name="notes" />
              </Field>
            </EntityForm>
            <p className="mt-3 text-xs text-stone-500">
              Only <span className="font-medium">approved</span> shifts are included. Open, unapproved
              and disputed shifts are held back and reported, never quietly dropped.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {canRun && params.deduct === "1" ? (
        <Card>
          <CardHeader><CardTitle>Record a deduction</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={recordDeduction} returnTo="/payroll" submitLabel="Record">
              <Field label="Employee" name="employeeId" required>
                <Select id="employeeId" name="employeeId" required defaultValue="">
                  <option value="">— select —</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.lastName}, {e.firstName}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Type" name="type" required>
                <Select id="type" name="type" defaultValue="CASH_ADVANCE">
                  <option value="CASH_ADVANCE">Cash advance</option>
                  <option value="UNRETURNED_ITEM">Unreturned item</option>
                  <option value="DAMAGE">Damage</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label="Amount (₱)" name="amount" required>
                <NumberInput id="amount" name="amount" required placeholder="0.00" />
              </Field>
              <Field label="Date" name="businessDate" required>
                <TextInput id="businessDate" name="businessDate" type="date" defaultValue={iso(today)} required />
              </Field>
              <Field label="What is it for" name="note" required hint="The vendor will see this on their payslip.">
                <TextInput id="note" name="note" required placeholder="e.g. cash advance for fare" />
              </Field>
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      {deductions.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Deductions not yet in a run</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-stone-100 text-sm">
              {deductions.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2">
                  <span>
                    <span className="font-medium text-stone-900">{nameOf.get(d.employeeId) ?? "—"}</span>{" "}
                    <span className="text-stone-500">· {d.type.replace(/_/g, " ").toLowerCase()} · {d.note}</span>
                  </span>
                  <span className="font-mono tabular-nums">{formatPHP(d.amount)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <DataTable
        rows={runs}
        href={(row) => `/payroll/${row.id}`}
        empty={{
          title: "No payroll runs yet",
          action: "Close and approve some shifts, then build a run for the week.",
        }}
        columns={[
          { header: "Reference", cell: (r) => r.reference },
          {
            header: "Period",
            cell: (r) => `${r.periodStart.toISOString().slice(0, 10)} → ${r.periodEnd.toISOString().slice(0, 10)}`,
          },
          { header: "Employees", numeric: true, cell: (r) => r._count.items },
          {
            header: "Net pay",
            numeric: true,
            cell: (r) => formatPHP(dec((r.totals as { netPay?: string })?.netPay ?? 0)),
          },
          { header: "Status", cell: (r) => <Badge tone={tone(r.status)}>{r.status.toLowerCase()}</Badge> },
        ]}
      />
    </div>
  );
}
