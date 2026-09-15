import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can, seesAllBranches } from "@/lib/rbac";
import { deleteRecord, saveBranch, setActive } from "@/lib/actions/masterdata";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { ArchiveButton, DeleteButton, EntityForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Checkbox, Field, Select, TextArea, TextInput } from "@/components/ui/field";
import Link from "next/link";

export default async function BranchesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; edit?: string; new?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "masterdata.write");
  const deletable = can(user, "masterdata.delete");

  const q = params.q?.trim() ?? "";
  const branches = await db.branch.findMany({
    where: {
      ...(seesAllBranches(user) ? {} : { id: { in: user.scopeBranchIds } }),
      ...(q
        ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }
        : {}),
    },
    include: { _count: { select: { carts: true, employees: true } } },
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
  });

  const editing = params.edit ? await db.branch.findUnique({ where: { id: params.edit } }) : null;
  const showForm = writable && (params.new === "1" || editing);
  const areas = await db.area.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Branches"
        subtitle="Operating units: branches that run carts, plus the commissary that produces stock."
        action={
          writable && !showForm ? (
            <Link href="/branches?new=1">
              <Button>New branch</Button>
            </Link>
          ) : null
        }
      />

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? `Edit ${editing.code}` : "New branch"}</CardTitle>
          </CardHeader>
          <CardBody>
            <EntityForm action={saveBranch.bind(null, editing?.id ?? null)} returnTo="/branches">
              <Field label="Code" name="code" required hint="Short, unique, e.g. BR-03 or CMY-02">
                <TextInput id="code" name="code" defaultValue={editing?.code ?? ""} required autoCapitalize="characters" />
              </Field>
              <Field label="Name" name="name" required>
                <TextInput id="name" name="name" defaultValue={editing?.name ?? ""} required />
              </Field>
              <Field label="Type" name="type" required hint="A commissary produces stock; a branch runs carts.">
                <Select id="type" name="type" defaultValue={editing?.type ?? "BRANCH"}>
                  <option value="BRANCH">Branch</option>
                  <option value="COMMISSARY">Commissary</option>
                  <option value="WAREHOUSE">Warehouse</option>
                </Select>
              </Field>
              <Field label="Area" name="areaId" hint="Optional grouping for area managers.">
                <Select id="areaId" name="areaId" defaultValue={editing?.areaId ?? ""}>
                  <option value="">— none —</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>{area.name}</option>
                  ))}
                </Select>
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

      <SearchBar placeholder="Search code or name…" defaultValue={q} />

      <DataTable
        rows={branches}
        href={writable ? (row) => `/branches?edit=${row.id}` : undefined}
        empty={{
          title: q ? `No branch matches “${q}”` : "No branches yet",
          action: writable
            ? "Create your commissary first, then a branch for each area you operate in."
            : "Ask an owner or admin to add you to a branch.",
        }}
        columns={[
          { header: "Code", cell: (b) => b.code },
          { header: "Name", cell: (b) => b.name },
          {
            header: "Type",
            cell: (b) => (
              <Badge tone={b.type === "COMMISSARY" ? "warning" : "neutral"}>
                {b.type.toLowerCase()}
              </Badge>
            ),
          },
          { header: "Carts", numeric: true, cell: (b) => b._count.carts },
          { header: "Staff", numeric: true, cell: (b) => b._count.employees },
          {
            header: "Status",
            cell: (b) =>
              b.isActive ? <Badge tone="success">active</Badge> : <Badge tone="danger">archived</Badge>,
          },
          {
            header: "",
            cell: (b) =>
              writable ? (
                <div className="flex items-center justify-end gap-2">
                  <ArchiveButton
                  isActive={b.isActive}
                  label={b.code}
                  action={setActive.bind(null, "branch", b.id, !b.isActive)}
                />
                  {deletable ? (
                    <DeleteButton
                      kind="branch"
                      label={b.code}
                      action={deleteRecord.bind(null, "branch", b.id)}
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
