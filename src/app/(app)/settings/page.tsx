import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { formatPHP } from "@/lib/money";
import { PageHeader } from "@/components/data-table";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";

export default async function SettingsPage() {
  const user = await requireUser();
  const db = scopedDb(user.companyId);

  const [company, schemes, positions] = await Promise.all([
    db.company.findFirst({ where: { id: user.companyId } }),
    db.compensationScheme.findMany({
      include: { _count: { select: { employees: true } } },
      orderBy: { name: "asc" },
    }),
    db.position.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Company configuration. Rules live here as data, never in code." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Company</CardTitle></CardHeader>
          <CardBody className="space-y-1 text-sm text-stone-600">
            <p>Name: <span className="font-medium text-stone-900">{company?.name}</span></p>
            <p>Code: <span className="font-medium text-stone-900">{company?.code}</span></p>
            <p>Currency: <span className="font-medium text-stone-900">{company?.currency}</span></p>
            <p>Timezone: <span className="font-medium text-stone-900">{company?.timezone}</span></p>
            <p>
              Business day starts:{" "}
              <span className="font-medium text-stone-900">
                {String(company?.businessDayCutoffHour ?? 4).padStart(2, "0")}:00
              </span>{" "}
              — a cart closing before this belongs to the previous day.
            </p>
            <p>
              Cash variance dispute threshold:{" "}
              <span className="font-medium text-stone-900">
                {company ? formatPHP(company.cashVarianceThreshold) : "—"}
              </span>
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Compensation schemes</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-stone-100 text-sm">
              {schemes.map((scheme) => (
                <li key={scheme.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-stone-900">{scheme.name}</span>
                    <span className="font-mono text-stone-700">{formatPHP(scheme.baseDailyRate)}/day</span>
                  </div>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {scheme._count.employees} employee{scheme._count.employees === 1 ? "" : "s"} ·{" "}
                    {scheme.deductShortage
                      ? `shortages deducted${scheme.maxShortageDeduction ? ` up to ${formatPHP(scheme.maxShortageDeduction)}` : " in full, uncapped"}`
                      : "no shortage deduction"}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-stone-500">
              Incentive rules are edited on the{" "}
              <Link href="/sets" className="font-medium text-brand-700 hover:underline">Sets</Link>{" "}
              screen. Editing schemes in the UI arrives with payroll in Phase 5.
            </p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Positions</CardTitle></CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {positions.map((position) => (
                <Badge key={position.id}>{position.name}</Badge>
              ))}
            </div>
            <p className="mt-3 text-xs text-stone-500">
              Job titles offered in the employee form. Typing a new one on an employee adds it here automatically.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
