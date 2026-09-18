import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import {
  deletePosition, saveCompany, saveCompensationScheme, savePosition,
} from "@/lib/actions/masterdata";
import { formatPHP } from "@/lib/money";
import { PageHeader } from "@/components/data-table";
import { EntityForm, RemoveButton } from "@/components/entity-form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, NumberInput, Select, TextArea, TextInput } from "@/components/ui/field";

const TIMEZONES = [
  "Asia/Manila", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Tokyo",
  "Asia/Kuala_Lumpur", "Asia/Jakarta", "Asia/Bangkok", "UTC",
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; scheme?: string; newScheme?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "company.manage");

  const [company, schemes, positions] = await Promise.all([
    db.company.findFirst({ where: { id: user.companyId } }),
    db.compensationScheme.findMany({
      include: { _count: { select: { employees: true } } },
      orderBy: { name: "asc" },
    }),
    db.position.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);

  const editingCompany = writable && params.edit === "company";
  const editingScheme = writable && params.scheme ? schemes.find((s) => s.id === params.scheme) ?? null : null;
  const newScheme = writable && params.newScheme === "1";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Company configuration. Rules live here as data, never in code."
        action={
          <Link href="/settings/audit" className="text-sm font-medium text-brand-700 hover:underline">
            Audit log →
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Company</CardTitle>
              {writable && !editingCompany ? (
                <Link href="/settings?edit=company" className="text-sm font-medium text-brand-700 hover:underline">
                  Edit
                </Link>
              ) : null}
            </div>
          </CardHeader>
          <CardBody>
            {editingCompany && company ? (
              <EntityForm action={saveCompany} returnTo="/settings" compact>
                <Field label="Company name" name="name" required>
                  <TextInput id="name" name="name" defaultValue={company.name} required />
                </Field>
                <Field
                  label="Timezone"
                  name="timezone"
                  required
                  hint="Decides what today means for every report."
                >
                  <Select id="timezone" name="timezone" defaultValue={company.timezone}>
                    {(TIMEZONES.includes(company.timezone) ? TIMEZONES : [company.timezone, ...TIMEZONES]).map(
                      (zone) => <option key={zone} value={zone}>{zone}</option>,
                    )}
                  </Select>
                </Field>
                <Field
                  label="Business day starts at (hour, 0–23)"
                  name="businessDayCutoffHour"
                  required
                  hint="A cart closing before this hour is counted on the previous day. Changing it moves shifts between days in every report."
                >
                  <NumberInput
                    id="businessDayCutoffHour"
                    name="businessDayCutoffHour"
                    inputMode="numeric"
                    defaultValue={String(company.businessDayCutoffHour)}
                    required
                  />
                </Field>
                <Field
                  label="Cash variance dispute threshold (₱)"
                  name="cashVarianceThreshold"
                  required
                  hint="A shift off by more than this is flagged DISPUTED and blocks payroll until it is resolved."
                >
                  <NumberInput
                    id="cashVarianceThreshold"
                    name="cashVarianceThreshold"
                    defaultValue={company.cashVarianceThreshold.toString()}
                    required
                  />
                </Field>
                <Field
                  label="Default wastage allowance (%)"
                  name="defaultWastagePct"
                  hint="Expected spoilage. Blank leaves it unchanged."
                >
                  <NumberInput
                    id="defaultWastagePct"
                    name="defaultWastagePct"
                    defaultValue={company.defaultWastagePct.toString()}
                  />
                </Field>
                <p className="text-xs text-stone-500">
                  Code ({company.code}) and currency ({company.currency}) are fixed. The code is
                  what someone types at sign-in to tell two operators apart, and every peso already
                  recorded is denominated in the currency — changing either would rewrite history.
                </p>
              </EntityForm>
            ) : (
              <div className="space-y-1 text-sm text-stone-600">
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
                <p>
                  Default wastage allowance:{" "}
                  <span className="font-medium text-stone-900">
                    {company ? `${company.defaultWastagePct.toString()}%` : "—"}
                  </span>
                </p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Compensation schemes</CardTitle>
              {writable && !editingScheme && !newScheme ? (
                <Link href="/settings?newScheme=1" className="text-sm font-medium text-brand-700 hover:underline">
                  New scheme
                </Link>
              ) : null}
            </div>
          </CardHeader>
          <CardBody>
            {editingScheme || newScheme ? (
              <EntityForm
                action={saveCompensationScheme.bind(null, editingScheme?.id ?? null)}
                returnTo="/settings"
                compact
              >
                <Field label="Scheme name" name="name" required hint="e.g. Daily Rate + Set Incentive">
                  <TextInput id="name" name="name" defaultValue={editingScheme?.name ?? ""} required />
                </Field>
                <Field label="Base daily rate (₱)" name="baseDailyRate" required hint="Paid for a shift that closed, before incentives.">
                  <NumberInput
                    id="baseDailyRate"
                    name="baseDailyRate"
                    defaultValue={editingScheme?.baseDailyRate.toString() ?? ""}
                    required
                  />
                </Field>
                <Field
                  label="Maximum shortage deduction (₱)"
                  name="maxShortageDeduction"
                  hint="Blank = deducted in full, uncapped. Only applies when shortages are deducted at all."
                >
                  <NumberInput
                    id="maxShortageDeduction"
                    name="maxShortageDeduction"
                    defaultValue={editingScheme?.maxShortageDeduction?.toString() ?? ""}
                    placeholder="uncapped"
                  />
                </Field>
                <Field label="Notes" name="description">
                  <TextArea id="description" name="description" defaultValue={editingScheme?.description ?? ""} />
                </Field>
                <Checkbox
                  label="Deduct cash shortages from pay"
                  name="deductShortage"
                  defaultChecked={editingScheme?.deductShortage ?? true}
                />
                <Checkbox label="Active" name="isActive" defaultChecked={editingScheme?.isActive ?? true} />
                <p className="text-xs text-stone-500">
                  A shortage is only ever deducted after the vendor has acknowledged it, whatever
                  this scheme says.
                </p>
              </EntityForm>
            ) : (
              <>
                <ul className="divide-y divide-stone-100 text-sm">
                  {schemes.map((scheme) => (
                    <li key={scheme.id} className="py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-stone-900">{scheme.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-stone-700">{formatPHP(scheme.baseDailyRate)}/day</span>
                          {writable ? (
                            <Link
                              href={`/settings?scheme=${scheme.id}`}
                              className="text-xs font-medium text-brand-700 hover:underline"
                            >
                              Edit
                            </Link>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-0.5 text-xs text-stone-500">
                        {scheme._count.employees} employee{scheme._count.employees === 1 ? "" : "s"} ·{" "}
                        {scheme.deductShortage
                          ? `shortages deducted${scheme.maxShortageDeduction ? ` up to ${formatPHP(scheme.maxShortageDeduction)}` : " in full, uncapped"}`
                          : "no shortage deduction"}
                        {scheme.isActive ? "" : " · inactive"}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-stone-500">
                  What a vendor earns per set is edited on the{" "}
                  <Link href="/sets" className="font-medium text-brand-700 hover:underline">Sets</Link>{" "}
                  screen, component by component.
                </p>
              </>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Positions</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            {positions.length === 0 ? (
              <p className="text-sm text-stone-500">No job titles yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {positions.map((position) => (
                  <span
                    key={position.id}
                    className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-700"
                  >
                    {position.name}
                    {writable ? (
                      <RemoveButton
                        label="×"
                        confirmText={`Remove "${position.name}" from the job-title list? Employees already holding it keep it — this only changes what the dropdown offers.`}
                        action={deletePosition.bind(null, position.id)}
                      />
                    ) : null}
                  </span>
                ))}
              </div>
            )}

            {writable ? (
              <div className="max-w-sm rounded-md border border-stone-200 p-3">
                <EntityForm action={savePosition} returnTo="/settings" submitLabel="Add job title" compact>
                  <Field label="Add a job title" name="positionName">
                    <TextInput id="positionName" name="name" placeholder="e.g. Night Shift Vendor" required />
                  </Field>
                </EntityForm>
              </div>
            ) : null}

            <p className="text-xs text-stone-500">
              Job titles offered in the employee form. Typing a new one on an employee adds it here
              automatically. An employee&rsquo;s position is a copy of the title, not a link to it,
              so removing one here never alters an employment record.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
