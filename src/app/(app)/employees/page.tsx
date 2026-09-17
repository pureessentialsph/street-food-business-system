import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can, seesAllBranches } from "@/lib/rbac";
import { deleteRecord, saveEmployee, setActive } from "@/lib/actions/masterdata";
import { formatPHP } from "@/lib/money";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { ArchiveButton, DeleteButton, EntityForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Checkbox, Field, NumberInput, Select, TextArea, TextInput } from "@/components/ui/field";
import { PositionSelect } from "@/components/position-select";

const STATUSES = ["PROBATIONARY", "REGULAR", "PART_TIME", "CONTRACTUAL", "SEPARATED"] as const;

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; branch?: string; edit?: string; new?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "masterdata.write");
  const deletable = can(user, "masterdata.delete");
  const showPay = can(user, "pay.readAll");
  const q = params.q?.trim() ?? "";

  const branchFilter = seesAllBranches(user) ? {} : { branchId: { in: user.scopeBranchIds } };

  const [employees, branches, carts, schemes, supervisors, positionRows, usedPositions] = await Promise.all([
    db.employee.findMany({
      where: {
        ...branchFilter,
        ...(params.branch ? { branchId: params.branch } : {}),
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { employeeNo: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        branch: { select: { code: true } },
        assignedCart: { select: { code: true } },
        compensationScheme: { select: { name: true } },
      },
      orderBy: [{ isActive: "desc" }, { lastName: "asc" }],
    }),
    db.branch.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    db.cart.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } }),
    db.compensationScheme.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.employee.findMany({
      where: { isActive: true, position: { not: { contains: "Vendor" } } },
      orderBy: { lastName: "asc" },
    }),
    db.position.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    // Titles already in use but never saved to the lookup — offered too, so the list is
    // never missing something an operator can see on the page behind the form.
    db.employee.findMany({ distinct: ["position"], select: { position: true } }),
  ]);

  const positions = [
    ...new Set([...positionRows.map((p) => p.name), ...usedPositions.map((e) => e.position)]),
  ].sort((a, b) => a.localeCompare(b));

  const editing = params.edit ? await db.employee.findUnique({ where: { id: params.edit } }) : null;
  const showForm = writable && (params.new === "1" || editing);
  const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees"
        subtitle="Vendors, supervisors and commissary staff. Vendors have no login — supervisors record their shifts."
        action={writable && !showForm ? <Link href="/employees?new=1"><Button>New employee</Button></Link> : null}
      />

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? `Edit ${editing.firstName} ${editing.lastName}` : "New employee"}</CardTitle>
          </CardHeader>
          <CardBody>
            <EntityForm action={saveEmployee.bind(null, editing?.id ?? null)} returnTo="/employees">
              <Field label="Employee no." name="employeeNo" required hint="e.g. EMP-011">
                <TextInput id="employeeNo" name="employeeNo" defaultValue={editing?.employeeNo ?? ""} required autoCapitalize="characters" />
              </Field>
              <Field
                label="Position"
                name="position"
                required
                hint="Pick a title, or add a new one — it is saved and offered next time."
              >
                <PositionSelect positions={positions} defaultValue={editing?.position ?? ""} />
              </Field>
              <Field label="First name" name="firstName" required>
                <TextInput id="firstName" name="firstName" defaultValue={editing?.firstName ?? ""} required />
              </Field>
              <Field label="Last name" name="lastName" required>
                <TextInput id="lastName" name="lastName" defaultValue={editing?.lastName ?? ""} required />
              </Field>
              <Field label="Middle name" name="middleName">
                <TextInput id="middleName" name="middleName" defaultValue={editing?.middleName ?? ""} />
              </Field>
              <Field label="Mobile" name="mobile" required>
                <TextInput id="mobile" name="mobile" inputMode="tel" defaultValue={editing?.mobile ?? ""} required />
              </Field>
              <Field label="Email" name="email">
                <TextInput id="email" name="email" type="email" defaultValue={editing?.email ?? ""} />
              </Field>
              <Field label="Date hired" name="dateHired" required>
                <TextInput id="dateHired" name="dateHired" type="date" defaultValue={iso(editing?.dateHired)} required />
              </Field>
              <Field label="Employment status" name="employmentStatus" required>
                <Select id="employmentStatus" name="employmentStatus" defaultValue={editing?.employmentStatus ?? "PROBATIONARY"}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Daily rate (₱)" name="dailyRate" required hint="Base pay before incentives.">
                <NumberInput id="dailyRate" name="dailyRate" defaultValue={editing?.dailyRate.toString() ?? "500"} required />
              </Field>
              <Field label="Branch" name="branchId">
                <Select id="branchId" name="branchId" defaultValue={editing?.branchId ?? ""}>
                  <option value="">— unassigned —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Assigned cart" name="cartId">
                <Select id="cartId" name="cartId" defaultValue={editing?.cartId ?? ""}>
                  <option value="">— none —</option>
                  {carts.map((c) => (
                    <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Compensation scheme" name="compensationSchemeId" hint="Drives base pay and set incentives in Phase 5.">
                <Select id="compensationSchemeId" name="compensationSchemeId" defaultValue={editing?.compensationSchemeId ?? ""}>
                  <option value="">— none —</option>
                  {schemes.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Supervisor" name="supervisorId">
                <Select id="supervisorId" name="supervisorId" defaultValue={editing?.supervisorId ?? ""}>
                  <option value="">— none —</option>
                  {supervisors.filter((s) => s.id !== editing?.id).map((s) => (
                    <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Emergency contact" name="emergencyContactName">
                <TextInput id="emergencyContactName" name="emergencyContactName" defaultValue={editing?.emergencyContactName ?? ""} />
              </Field>
              <Field label="Emergency number" name="emergencyContactNo">
                <TextInput id="emergencyContactNo" name="emergencyContactNo" inputMode="tel" defaultValue={editing?.emergencyContactNo ?? ""} />
              </Field>
              <Field label="Address" name="address">
                <TextArea id="address" name="address" defaultValue={editing?.address ?? ""} />
              </Field>
              <div className="flex items-end">
                <Checkbox label="Active" name="isActive" defaultChecked={editing?.isActive ?? true} />
              </div>
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      <SearchBar
        placeholder="Search name or employee no…"
        defaultValue={q}
        filters={
          <Select name="branch" defaultValue={params.branch ?? ""} className="w-48">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.code}</option>
            ))}
          </Select>
        }
      />

      <DataTable
        rows={employees}
        href={(row) => `/employees/${row.id}`}
        empty={{
          title: q ? `No employee matches “${q}”` : "No employees yet",
          action: "Add your vendors and supervisors — shifts and payroll are recorded against them.",
        }}
        columns={[
          { header: "No.", cell: (e) => e.employeeNo },
          { header: "Name", cell: (e) => `${e.lastName}, ${e.firstName}` },
          { header: "Position", cell: (e) => e.position },
          { header: "Branch", cell: (e) => e.branch?.code ?? "—" },
          { header: "Cart", cell: (e) => e.assignedCart?.code ?? "—" },
          ...(showPay
            ? [{ header: "Daily rate", numeric: true, cell: (e: (typeof employees)[number]) => formatPHP(e.dailyRate) }]
            : []),
          { header: "Scheme", cell: (e) => e.compensationScheme?.name ?? "—" },
          {
            header: "Status",
            cell: (e) =>
              e.isActive ? (
                <Badge tone={e.employmentStatus === "REGULAR" ? "success" : "neutral"}>
                  {e.employmentStatus.replace("_", " ").toLowerCase()}
                </Badge>
              ) : (
                <Badge tone="danger">inactive</Badge>
              ),
          },
          {
            header: "",
            cell: (e) =>
              writable ? (
                <div className="flex items-center justify-end gap-2">
                  {writable ? (
                    <Link
                      href={`/employees?edit=${e.id}`}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Edit
                    </Link>
                  ) : null}
                  <ArchiveButton isActive={e.isActive} label={`${e.firstName} ${e.lastName}`} action={setActive.bind(null, "employee", e.id, !e.isActive)} />
                  {deletable ? (
                    <DeleteButton
                      kind="employee"
                      label={`${e.firstName} ${e.lastName}`}
                      action={deleteRecord.bind(null, "employee", e.id)}
                    />
                  ) : null}
                </div>
                
              ) : null,
          },
        ]}
      />
    </div>
  );
}
