import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import {
  deleteEmployeeDocument, logDocumentAccess,
  recordEmploymentEvent, saveEmployeeDocument,
} from "@/lib/actions/documents";
import { formatPHP } from "@/lib/money";
import { PageHeader } from "@/components/data-table";
import { EntityForm, RemoveButton } from "@/components/entity-form";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { Badge, Field, Select, TextArea, TextInput } from "@/components/ui/field";

const DOC_TYPES = [
  "CONTRACT", "ID", "CLEARANCE", "HEALTH_CERT", "TRAINING",
  "PERFORMANCE", "DISCIPLINARY", "GOVT_RECORD", "OTHER",
] as const;

const EVENT_TYPES = [
  "HIRED", "REGULARIZED", "TRANSFERRED", "PROMOTED",
  "RATE_CHANGE", "SUSPENDED", "SEPARATED",
] as const;

const label = (value: string) => value.replace(/_/g, " ").toLowerCase();
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** The 201 file (spec §6). Owner, admin and HR only, and opening it is audited. */
export default async function EmployeeDocumentsPage({
  params, searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ new?: string; edit?: string; event?: string }>;
}) {
  const { employeeId } = await params;
  const query = await searchParams;
  const user = await requireUser();

  if (!can(user, "employee.documents")) {
    return (
      <div className="space-y-5">
        <PageHeader title="201 file" subtitle="Employment records" />
        <EmptyState
          title="You cannot see employee documents"
          action="201 files are restricted to the owner, an admin, or HR. Every view is logged."
        />
      </div>
    );
  }

  const db = scopedDb(user.companyId);
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { branch: true, assignedCart: true, supervisor: true, compensationScheme: true },
  });
  if (!employee) notFound();

  await logDocumentAccess(employeeId);

  const [documents, events] = await Promise.all([
    db.employeeDocument.findMany({ where: { employeeId }, orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }] }),
    db.employmentEvent.findMany({ where: { employeeId }, orderBy: { effectiveDate: "desc" } }),
  ]);

  const today = new Date();
  const soon = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiring = documents.filter((d) => d.expiresAt && d.expiresAt <= soon);
  const expired = documents.filter((d) => d.expiresAt && d.expiresAt < today);

  const editing = query.edit ? documents.find((d) => d.id === query.edit) ?? null : null;
  const showForm = query.new === "1" || editing;
  const todayIso = today.toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${employee.firstName} ${employee.lastName} — 201 file`}
        subtitle={`${employee.employeeNo} · ${employee.position} · hired ${iso(employee.dateHired)}`}
        action={
          <div className="flex gap-3 text-sm">
            <Link href={`/employees/${employeeId}`} className="font-medium text-brand-700 hover:underline">
              ← Scorecard
            </Link>
            {!showForm ? (
              <Link href={`/employees/${employeeId}/documents?new=1`} className="font-medium text-brand-700 hover:underline">
                Add document
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="rounded-md bg-stone-50 px-4 py-3 text-xs text-stone-600">
        Employment records are restricted to the owner, an admin and HR. Opening this page is
        written to the audit log with your name and the time.
      </div>

      {expired.length > 0 ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-medium">{expired.length} document{expired.length === 1 ? " has" : "s have"} expired:</span>{" "}
          {expired.map((d) => `${d.title} (${iso(d.expiresAt)})`).join(", ")}.
        </div>
      ) : null}

      {expiring.length > expired.length ? (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">Expiring within 30 days:</span>{" "}
          {expiring.filter((d) => !expired.includes(d)).map((d) => `${d.title} (${iso(d.expiresAt)})`).join(", ")}.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Employment information</CardTitle></CardHeader>
          <CardBody className="space-y-1 text-sm text-stone-600">
            <p>Position: <span className="font-medium text-stone-900">{employee.position}</span></p>
            <p>Status: <span className="font-medium text-stone-900">{label(employee.employmentStatus)}</span></p>
            <p>Branch: <span className="font-medium text-stone-900">{employee.branch?.code ?? "—"}</span></p>
            <p>Cart: <span className="font-medium text-stone-900">{employee.assignedCart?.code ?? "—"}</span></p>
            <p>Daily rate: <span className="font-medium text-stone-900">{formatPHP(employee.dailyRate)}</span></p>
            <p>Scheme: <span className="font-medium text-stone-900">{employee.compensationScheme?.name ?? "—"}</span></p>
            <p>Supervisor: <span className="font-medium text-stone-900">
              {employee.supervisor ? `${employee.supervisor.firstName} ${employee.supervisor.lastName}` : "—"}
            </span></p>
            <div className="border-t border-stone-100 pt-2">
              <p>Mobile: <span className="font-medium text-stone-900">{employee.mobile}</span></p>
              <p>Email: <span className="font-medium text-stone-900">{employee.email ?? "—"}</span></p>
              <p>Address: <span className="font-medium text-stone-900">{employee.address ?? "—"}</span></p>
              <p>Emergency: <span className="font-medium text-stone-900">
                {employee.emergencyContactName ?? "—"}{employee.emergencyContactNo ? ` · ${employee.emergencyContactNo}` : ""}
              </span></p>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            {showForm ? (
              <div className="rounded-md border border-stone-200 p-3">
                <p className="mb-2 text-sm font-medium text-stone-700">
                  {editing ? `Edit ${editing.title}` : "New document record"}
                </p>
                <EntityForm
                  action={saveEmployeeDocument.bind(null, editing?.id ?? null)}
                  returnTo={`/employees/${employeeId}/documents`}
                >
                  <input type="hidden" name="employeeId" value={employeeId} />
                  <Field label="Type" name="type" required>
                    <Select id="type" name="type" defaultValue={editing?.type ?? "CONTRACT"}>
                      {DOC_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                    </Select>
                  </Field>
                  <Field label="Title" name="title" required hint="e.g. Health certificate 2026">
                    <TextInput id="title" name="title" defaultValue={editing?.title ?? ""} required />
                  </Field>
                  <Field label="Issued" name="issuedAt">
                    <TextInput id="issuedAt" name="issuedAt" type="date" defaultValue={iso(editing?.issuedAt ?? null)} />
                  </Field>
                  <Field label="Expires" name="expiresAt" hint="Drives the reminder — leave blank if it does not expire.">
                    <TextInput id="expiresAt" name="expiresAt" type="date" defaultValue={iso(editing?.expiresAt ?? null)} />
                  </Field>
                  <Field
                    label="Where it is kept"
                    name="fileRef"
                    hint="A cloud link, or the physical folder reference. File upload needs object storage this deployment does not have."
                  >
                    <TextInput id="fileRef" name="fileRef" defaultValue={editing?.fileRef ?? ""} placeholder="e.g. Drive link, or Folder A-12" />
                  </Field>
                  <Field label="Notes" name="notes">
                    <TextArea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
                  </Field>
                </EntityForm>
              </div>
            ) : null}

            {documents.length === 0 ? (
              <EmptyState
                title="No documents recorded"
                action="Record the contract, IDs, clearances and health certificate — the expiry dates are what make this worth keeping."
              />
            ) : (
              <ul className="divide-y divide-stone-100 text-sm">
                {documents.map((document) => {
                  const isExpired = document.expiresAt && document.expiresAt < today;
                  const isSoon = !isExpired && document.expiresAt && document.expiresAt <= soon;
                  return (
                    <li key={document.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                      <span className="min-w-0">
                        <span className="font-medium text-stone-900">{document.title}</span>{" "}
                        <Badge>{label(document.type)}</Badge>
                        <span className="block text-xs text-stone-500">
                          {document.issuedAt ? `issued ${iso(document.issuedAt)}` : "no issue date"}
                          {document.expiresAt ? ` · expires ${iso(document.expiresAt)}` : " · no expiry"}
                          {document.fileRef ? ` · ${document.fileRef}` : ""}
                        </span>
                        {document.notes ? <span className="block text-xs text-stone-500">{document.notes}</span> : null}
                      </span>
                      <span className="flex items-center gap-2">
                        {isExpired ? <Badge tone="danger">expired</Badge> : isSoon ? <Badge tone="warning">expiring</Badge> : null}
                        <Link
                          href={`/employees/${employeeId}/documents?edit=${document.id}`}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          Edit
                        </Link>
                        <RemoveButton
                          label="Remove"
                          confirmText={`Remove the record of "${document.title}"? The document itself is not touched.`}
                          action={deleteEmployeeDocument.bind(null, document.id)}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Employment history</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {query.event === "1" ? (
            <div className="rounded-md border border-stone-200 p-3">
              <EntityForm action={recordEmploymentEvent} returnTo={`/employees/${employeeId}/documents`} submitLabel="Record event">
                <input type="hidden" name="employeeId" value={employeeId} />
                <Field label="What happened" name="type" required>
                  <Select id="type" name="type" defaultValue="REGULARIZED">
                    {EVENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                  </Select>
                </Field>
                <Field label="Effective date" name="effectiveDate" required>
                  <TextInput id="effectiveDate" name="effectiveDate" type="date" defaultValue={todayIso} required />
                </Field>
                <Field label="Note" name="note">
                  <TextInput id="note" name="note" />
                </Field>
              </EntityForm>
            </div>
          ) : (
            <Link
              href={`/employees/${employeeId}/documents?event=1`}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              + Record an employment event
            </Link>
          )}

          {events.length === 0 ? (
            <p className="text-sm text-stone-500">No events recorded yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {events.map((event) => {
                const details = (event.details ?? {}) as { note?: string | null; from?: unknown; to?: unknown };
                return (
                  <li key={event.id} className="flex items-start justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium text-stone-800">{label(event.type)}</span>
                      {details.note ? <span className="block text-xs text-stone-500">{details.note}</span> : null}
                      {details.from !== undefined && details.to !== undefined ? (
                        <span className="block text-xs text-stone-500">
                          {String(details.from)} → {String(details.to)}
                        </span>
                      ) : null}
                    </span>
                    <span className="whitespace-nowrap text-stone-500">{iso(event.effectiveDate)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
