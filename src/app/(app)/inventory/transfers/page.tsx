import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { createTransfer } from "@/lib/actions/inventory";
import { LOCATION_LABEL, locationNames } from "@/lib/inventory-labels";
import { DataTable, PageHeader } from "@/components/data-table";
import { EntityForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Field, Select, TextArea } from "@/components/ui/field";

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "inventory.write");

  const [transfers, branches, carts, employees, names] = await Promise.all([
    db.stockTransfer.findMany({
      include: { _count: { select: { lines: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.branch.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    db.cart.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { lastName: "asc" } }),
    locationNames(db as never),
  ]);

  const tone = (status: string) =>
    status === "RECEIVED" ? "success" : status === "IN_TRANSIT" ? "warning" : status === "CANCELLED" ? "danger" : "neutral";

  const locationOptions = (
    <>
      <optgroup label="Branches">
        {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
      </optgroup>
      <optgroup label="Carts">
        {carts.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
      </optgroup>
      <optgroup label="Vendors">
        {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
      </optgroup>
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transfers"
        subtitle="Stock moving between places. Every transfer writes paired rows, so nothing evaporates."
        action={
          writable && params.new !== "1" ? (
            <div className="flex gap-2">
              <Link href="/inventory"><Button variant="secondary">All stock</Button></Link>
              <Link href="/inventory/transfers?new=1"><Button>New transfer</Button></Link>
            </div>
          ) : null
        }
      />

      {writable && params.new === "1" ? (
        <Card>
          <CardHeader><CardTitle>New transfer</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={createTransfer} returnTo="/inventory/transfers" submitLabel="Create draft">
              <Field label="From — location type" name="fromLocationType" required>
                <Select id="fromLocationType" name="fromLocationType" defaultValue="BRANCH">
                  <option value="BRANCH">Branch / commissary</option>
                  <option value="CART">Cart</option>
                  <option value="EMPLOYEE">Vendor</option>
                  <option value="WAREHOUSE">Warehouse</option>
                </Select>
              </Field>
              <Field label="From — where" name="fromLocationId" required>
                <Select id="fromLocationId" name="fromLocationId" required defaultValue="">
                  <option value="">— select —</option>
                  {locationOptions}
                </Select>
              </Field>
              <Field label="To — location type" name="toLocationType" required>
                <Select id="toLocationType" name="toLocationType" defaultValue="CART">
                  <option value="BRANCH">Branch / commissary</option>
                  <option value="CART">Cart</option>
                  <option value="EMPLOYEE">Vendor</option>
                  <option value="WAREHOUSE">Warehouse</option>
                </Select>
              </Field>
              <Field label="To — where" name="toLocationId" required>
                <Select id="toLocationId" name="toLocationId" required defaultValue="">
                  <option value="">— select —</option>
                  {locationOptions}
                </Select>
              </Field>
              <Field label="Notes" name="notes">
                <TextArea id="notes" name="notes" />
              </Field>
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      <DataTable
        rows={transfers}
        href={(row) => `/inventory/transfers/${row.id}`}
        empty={{
          title: "No transfers yet",
          action: "Move stock from the commissary to a branch, or from a branch to a cart.",
        }}
        columns={[
          { header: "Reference", cell: (t) => t.reference },
          { header: "Date", cell: (t) => t.businessDate.toISOString().slice(0, 10) },
          { header: "From", cell: (t) => `${names.get(t.fromLocationId) ?? t.fromLocationId}` },
          { header: "To", cell: (t) => `${names.get(t.toLocationId) ?? t.toLocationId}` },
          { header: "Kind", cell: (t) => `${LOCATION_LABEL[t.fromLocationType]} → ${LOCATION_LABEL[t.toLocationType]}` },
          { header: "Lines", numeric: true, cell: (t) => t._count.lines },
          { header: "Status", cell: (t) => <Badge tone={tone(t.status)}>{t.status.replace("_", " ").toLowerCase()}</Badge> },
        ]}
      />
    </div>
  );
}
