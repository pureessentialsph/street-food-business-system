import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can, seesAllBranches } from "@/lib/rbac";
import { deleteRecord, saveCart, setActive } from "@/lib/actions/masterdata";
import { formatPHP } from "@/lib/money";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { ArchiveButton, DeleteButton, EntityForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Checkbox, Field, NumberInput, Select, TextInput } from "@/components/ui/field";

export default async function CartsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; branch?: string; edit?: string; new?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "masterdata.write");
  const deletable = can(user, "masterdata.delete");
  const q = params.q?.trim() ?? "";

  const branchFilter = seesAllBranches(user) ? {} : { branchId: { in: user.scopeBranchIds } };

  const [carts, branches, locations, vendors] = await Promise.all([
    db.cart.findMany({
      where: {
        ...branchFilter,
        ...(params.branch ? { branchId: params.branch } : {}),
        ...(q
          ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }
          : {}),
      },
      include: {
        branch: { select: { code: true, name: true } },
        location: { select: { name: true, type: true } },
        defaultVendor: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ status: "asc" }, { code: "asc" }],
    }),
    db.branch.findMany({
      where: { isActive: true, type: "BRANCH", ...(seesAllBranches(user) ? {} : { id: { in: user.scopeBranchIds } }) },
      orderBy: { code: "asc" },
    }),
    db.location.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.employee.findMany({
      where: { isActive: true, position: { contains: "Vendor", mode: "insensitive" } },
      orderBy: { lastName: "asc" },
    }),
  ]);

  const editing = params.edit ? await db.cart.findUnique({ where: { id: params.edit } }) : null;
  const showForm = writable && (params.new === "1" || editing);

  const statusTone = (s: string) =>
    s === "ACTIVE" ? "success" : s === "RETIRED" ? "danger" : "warning";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Carts"
        subtitle="Every food cart, motor cart and kiosk. Each one is its own operating unit."
        action={writable && !showForm ? <Link href="/carts?new=1"><Button>New cart</Button></Link> : null}
      />

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>{editing ? `Edit ${editing.code}` : "New cart"}</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={saveCart.bind(null, editing?.id ?? null)} returnTo="/carts">
              <Field label="Code" name="code" required hint="Painted on the cart, e.g. CART-012">
                <TextInput id="code" name="code" defaultValue={editing?.code ?? ""} required autoCapitalize="characters" />
              </Field>
              <Field label="Name" name="name" required>
                <TextInput id="name" name="name" defaultValue={editing?.name ?? ""} required />
              </Field>
              <Field label="Type" name="type" required>
                <Select id="type" name="type" defaultValue={editing?.type ?? "FOOD_CART"}>
                  <option value="FOOD_CART">Food cart</option>
                  <option value="MOTOR_CART">Motor cart</option>
                  <option value="KIOSK">Kiosk</option>
                </Select>
              </Field>
              <Field label="Branch" name="branchId" required hint="Which branch issues its stock.">
                <Select id="branchId" name="branchId" defaultValue={editing?.branchId ?? ""} required>
                  <option value="">— select —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Location" name="locationId" hint="Where it is posted.">
                <Select id="locationId" name="locationId" defaultValue={editing?.locationId ?? ""}>
                  <option value="">— unassigned —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Status" name="status" required>
                <Select id="status" name="status" defaultValue={editing?.status ?? "ACTIVE"}>
                  <option value="ACTIVE">Active</option>
                  <option value="IDLE">Idle</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="RETIRED">Retired</option>
                </Select>
              </Field>
              <Field label="Usual vendor" name="defaultVendorId" hint="Pre-selected when opening a shift.">
                <Select id="defaultVendorId" name="defaultVendorId" defaultValue={editing?.defaultVendorId ?? ""}>
                  <option value="">— none —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.firstName} {v.lastName}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Daily sales target (₱)" name="dailySalesTarget" hint="Used for the vs-target figure on dashboards.">
                <NumberInput id="dailySalesTarget" name="dailySalesTarget" defaultValue={editing?.dailySalesTarget?.toString() ?? ""} placeholder="0.00" />
              </Field>
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      <SearchBar
        placeholder="Search carts…"
        defaultValue={q}
        filters={
          <Select name="branch" defaultValue={params.branch ?? ""} className="w-52">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.code}</option>
            ))}
          </Select>
        }
      />

      <DataTable
        rows={carts}
        href={writable ? (row) => `/carts?edit=${row.id}` : undefined}
        empty={{
          title: q ? `No cart matches “${q}”` : "No carts yet",
          action: "Add your first cart and post it to a location — shifts are opened against carts.",
        }}
        columns={[
          { header: "Code", cell: (c) => c.code },
          { header: "Name", cell: (c) => c.name },
          { header: "Branch", cell: (c) => c.branch.code },
          { header: "Location", cell: (c) => c.location?.name ?? "— unassigned —" },
          { header: "Vendor", cell: (c) => (c.defaultVendor ? `${c.defaultVendor.firstName} ${c.defaultVendor.lastName}` : "—") },
          { header: "Target", numeric: true, cell: (c) => (c.dailySalesTarget ? formatPHP(c.dailySalesTarget) : "—") },
          { header: "Status", cell: (c) => <Badge tone={statusTone(c.status)}>{c.status.toLowerCase()}</Badge> },
          {
            header: "",
            cell: (c) =>
              writable ? (
                <div className="flex items-center justify-end gap-2">
                  <ArchiveButton isActive={c.status !== "RETIRED"} label={c.code} action={setActive.bind(null, "cart", c.id, c.status === "RETIRED")} />
                  {deletable ? (
                    <DeleteButton
                      kind="cart"
                      label={c.code}
                      action={deleteRecord.bind(null, "cart", c.id)}
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
