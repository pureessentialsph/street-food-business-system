import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { deleteRecord, saveSupplier, setActive } from "@/lib/actions/masterdata";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { ArchiveButton, DeleteButton, EntityForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Checkbox, Field, TextArea, TextInput } from "@/components/ui/field";

export default async function SuppliersPage({
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

  const suppliers = await db.supplier.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : {},
    include: { _count: { select: { ingredients: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  const editing = params.edit ? await db.supplier.findUnique({ where: { id: params.edit } }) : null;
  const showForm = writable && (params.new === "1" || editing);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Suppliers"
        subtitle="Who you buy from. Lead time drives the reorder point in Phase 8 replenishment."
        action={writable && !showForm ? <Link href="/suppliers?new=1"><Button>New supplier</Button></Link> : null}
      />

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>{editing ? `Edit ${editing.name}` : "New supplier"}</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={saveSupplier.bind(null, editing?.id ?? null)} returnTo="/suppliers">
              <Field label="Name" name="name" required>
                <TextInput id="name" name="name" defaultValue={editing?.name ?? ""} required />
              </Field>
              <Field label="Contact person" name="contactPerson">
                <TextInput id="contactPerson" name="contactPerson" defaultValue={editing?.contactPerson ?? ""} />
              </Field>
              <Field label="Mobile" name="mobile">
                <TextInput id="mobile" name="mobile" inputMode="tel" defaultValue={editing?.mobile ?? ""} />
              </Field>
              <Field label="Lead time (days)" name="leadTimeDays" required hint="Days from order to delivery. Drives reorder points.">
                <TextInput id="leadTimeDays" name="leadTimeDays" inputMode="numeric" defaultValue={String(editing?.leadTimeDays ?? 1)} required />
              </Field>
              <Field label="Payment terms" name="paymentTerms" hint="e.g. COD, 7 days, 15 days">
                <TextInput id="paymentTerms" name="paymentTerms" defaultValue={editing?.paymentTerms ?? ""} />
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

      <SearchBar placeholder="Search suppliers…" defaultValue={q} />

      <DataTable
        rows={suppliers}
        href={writable ? (row) => `/suppliers?edit=${row.id}` : undefined}
        empty={{
          title: q ? `No supplier matches “${q}”` : "No suppliers yet",
          action: "Add the wet-market vendors and distributors you buy ingredients from.",
        }}
        columns={[
          { header: "Name", cell: (s) => s.name },
          { header: "Contact", cell: (s) => s.contactPerson ?? "—" },
          { header: "Mobile", cell: (s) => s.mobile ?? "—" },
          { header: "Lead time", numeric: true, cell: (s) => `${s.leadTimeDays} d` },
          { header: "Terms", cell: (s) => s.paymentTerms ?? "—" },
          { header: "Items", numeric: true, cell: (s) => s._count.ingredients },
          { header: "Status", cell: (s) => (s.isActive ? <Badge tone="success">active</Badge> : <Badge tone="danger">archived</Badge>) },
          {
            header: "",
            cell: (s) => (writable ?
                <div className="flex items-center justify-end gap-2">
                  <ArchiveButton isActive={s.isActive} label={s.name} action={setActive.bind(null, "supplier", s.id, !s.isActive)} />
                  {deletable ? (
                    <DeleteButton
                      kind="supplier"
                      label={s.name}
                      action={deleteRecord.bind(null, "supplier", s.id)}
                    />
                  ) : null}
                </div>
                 : null),
          },
        ]}
      />
    </div>
  );
}
