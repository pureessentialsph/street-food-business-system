import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { assignableRoles, can, canAssignRole, ROLE_LABELS } from "@/lib/rbac";
import { resetUserPassword, saveUser } from "@/lib/actions/users";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { EntityForm } from "@/components/entity-form";
import { PasswordFields } from "@/components/password-fields";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Checkbox, Field, Select, TextInput } from "@/components/ui/field";

export const metadata = { title: "Logins" };

const SCOPED_ROLES = new Set(["AREA_MANAGER", "SUPERVISOR"]);

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; edit?: string; new?: string; reset?: string }>;
}) {
  const params = await searchParams;
  const actor = await requireUser();
  if (!can(actor, "user.manage")) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-stone-600">
            Managing logins is limited to owners and admins.
          </p>
        </CardBody>
      </Card>
    );
  }

  const db = scopedDb(actor.companyId);
  const q = params.q?.trim() ?? "";

  const [users, branches, employees] = await Promise.all([
    db.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {},
      include: { scopes: { select: { branchId: true } } },
      orderBy: [{ isActive: "desc" }, { email: "asc" }],
    }),
    db.branch.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { lastName: "asc" } }),
  ]);

  const branchName = new Map(branches.map((b) => [b.id, b.code]));
  const editing = params.edit ? users.find((u) => u.id === params.edit) ?? null : null;
  const resetting = params.reset ? users.find((u) => u.id === params.reset) ?? null : null;
  const creating = params.new === "1";
  const roles = assignableRoles(actor);

  const activeOwners = users.filter((u) => u.role === "OWNER" && u.isActive).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Logins"
        subtitle="Who can sign in, what they can do, and which branches they see. Vendors do not need a login — supervisors record their shifts."
        action={
          !creating && !editing && !resetting ? (
            <Link href="/users?new=1"><Button>New login</Button></Link>
          ) : null
        }
      />

      {creating || editing ? (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? `Edit ${editing.email}` : "New login"}</CardTitle>
          </CardHeader>
          <CardBody>
            <EntityForm action={saveUser.bind(null, editing?.id ?? null)} returnTo="/users">
              <Field label="Email" name="email" required hint="What they sign in with.">
                <TextInput id="email" name="email" type="email" defaultValue={editing?.email ?? ""} required />
              </Field>
              <Field label="Full name" name="name" required>
                <TextInput id="name" name="name" defaultValue={editing?.name ?? ""} required />
              </Field>
              <Field
                label="Role"
                name="role"
                required
                hint={
                  roles.includes("OWNER")
                    ? "An owner can do everything, including managing logins."
                    : "You can only give a role at or below your own."
                }
              >
                <Select id="role" name="role" defaultValue={editing?.role ?? "SUPERVISOR"}>
                  {roles.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Linked employee"
                name="employeeId"
                hint="Optional. Links this login to a staff record so they can see their own pay."
              >
                <Select id="employeeId" name="employeeId" defaultValue={editing?.employeeId ?? ""}>
                  <option value="">— none —</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.firstName} {e.lastName} · {e.employeeNo}</option>
                  ))}
                </Select>
              </Field>

              {editing ? null : <PasswordFields />}

              <div className="sm:col-span-2">
                <p className="mb-1 block text-sm font-medium text-stone-700">Branches they see</p>
                <p className="mb-2 text-xs text-stone-500">
                  Only used by area managers and supervisors — owners and admins see every branch
                  whatever is ticked here. Leaving a supervisor with none means they see nothing.
                </p>
                <div className="flex flex-wrap gap-4">
                  {branches.map((branch) => (
                    <Checkbox
                      key={branch.id}
                      label={`${branch.code} · ${branch.name}`}
                      name="branchIds"
                      multiple
                      value={branch.id}
                      defaultChecked={editing?.scopes.some((s) => s.branchId === branch.id) ?? false}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-end">
                <Checkbox
                  label="Can sign in"
                  name="isActive"
                  defaultChecked={editing?.isActive ?? true}
                />
              </div>
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      {resetting ? (
        <Card>
          <CardHeader><CardTitle>Set a new password for {resetting.email}</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-stone-600">
              There is no reset email in this system, so this is how someone locked out gets back
              in. They will be signed out everywhere, and should change it themselves afterwards.
            </p>
            <EntityForm
              action={resetUserPassword.bind(null, resetting.id)}
              returnTo="/users"
              submitLabel="Set password"
              compact
            >
              <PasswordFields label="New password" />
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      {activeOwners === 1 ? (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">Only one active owner.</span> If that login is lost,
          nobody can manage the company. Consider a second one.
        </div>
      ) : null}

      <SearchBar placeholder="Search by email or name…" defaultValue={q} />

      <DataTable
        rows={users}
        empty={{ title: q ? `No login matches “${q}”` : "No logins", action: "Add one." }}
        columns={[
          { header: "Email", cell: (u) => u.email },
          { header: "Name", cell: (u) => u.name },
          { header: "Role", cell: (u) => ROLE_LABELS[u.role] },
          {
            header: "Branches",
            cell: (u) =>
              u.role === "OWNER" || u.role === "ADMIN"
                ? <span className="text-stone-500">every branch</span>
                : u.scopes.length
                  ? u.scopes.map((s) => branchName.get(s.branchId) ?? "?").join(", ")
                  : <span className="text-amber-700">none — sees nothing</span>,
          },
          {
            header: "Last signed in",
            cell: (u) => (u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 10) : "never"),
          },
          {
            header: "Status",
            cell: (u) =>
              u.isActive ? <Badge tone="success">can sign in</Badge> : <Badge tone="danger">switched off</Badge>,
          },
          {
            header: "",
            cell: (u) =>
              canAssignRole(actor, u.role) ? (
                <div className="flex items-center justify-end gap-2">
                  <Link href={`/users?edit=${u.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                    Edit
                  </Link>
                  <Link href={`/users?reset=${u.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                    Set password
                  </Link>
                </div>
              ) : (
                <span className="text-xs text-stone-400">outranks you</span>
              ),
          },
        ]}
      />

      <p className="text-xs text-stone-500">
        Logins are switched off, never deleted — an account is named on every shift it closed and
        every row it changed, and that history has to keep making sense.
      </p>
    </div>
  );
}
