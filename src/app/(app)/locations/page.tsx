import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { deleteRecord, saveLocation, setActive } from "@/lib/actions/masterdata";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { ArchiveButton, DeleteButton, EntityForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Checkbox, Field, Select, TextArea, TextInput } from "@/components/ui/field";

const TYPES = [
  "SCHOOL", "OFFICE", "FACTORY", "TERMINAL", "MARKET", "RESIDENTIAL", "COMMERCIAL", "OTHER",
] as const;

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; edit?: string; new?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "masterdata.write");
  const deletable = can(user, "masterdata.delete");
  const q = params.q?.trim() ?? "";

  const locations = await db.location.findMany({
    where: {
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      ...(params.type && TYPES.includes(params.type as (typeof TYPES)[number])
        ? { type: params.type as (typeof TYPES)[number] }
        : {}),
    },
    include: { _count: { select: { carts: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  const editing = params.edit ? await db.location.findUnique({ where: { id: params.edit } }) : null;
  const showForm = writable && (params.new === "1" || editing);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Locations"
        subtitle="Selling spots: schools, terminals, factories. A cart is posted to one of these."
        action={
          writable && !showForm ? (
            <Link href="/locations?new=1"><Button>New location</Button></Link>
          ) : null
        }
      />

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>{editing ? `Edit ${editing.name}` : "New location"}</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={saveLocation.bind(null, editing?.id ?? null)} returnTo="/locations">
              <Field label="Name" name="name" required hint="How your team refers to the spot.">
                <TextInput id="name" name="name" defaultValue={editing?.name ?? ""} required />
              </Field>
              <Field label="Foot-traffic type" name="type" required>
                <Select id="type" name="type" defaultValue={editing?.type ?? "OTHER"}>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Address" name="address">
                <TextArea id="address" name="address" defaultValue={editing?.address ?? ""} />
              </Field>
              <Field label="Notes" name="notes" hint="Peak hours, permit contact, anything the team should know.">
                <TextArea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
              </Field>
              <div className="flex items-end">
                <Checkbox label="Active" name="isActive" defaultChecked={editing?.isActive ?? true} />
              </div>
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      <SearchBar
        placeholder="Search locations…"
        defaultValue={q}
        filters={
          <Select name="type" defaultValue={params.type ?? ""} className="w-44">
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
            ))}
          </Select>
        }
      />

      <DataTable
        rows={locations}
        href={writable ? (row) => `/locations?edit=${row.id}` : undefined}
        empty={{
          title: q ? `No location matches “${q}”` : "No locations yet",
          action: "Add the spots where your carts sell — a school gate, a terminal, a factory exit.",
        }}
        columns={[
          { header: "Name", cell: (l) => l.name },
          { header: "Type", cell: (l) => <Badge>{l.type.toLowerCase()}</Badge> },
          { header: "Address", cell: (l) => l.address ?? "—" },
          { header: "Carts", numeric: true, cell: (l) => l._count.carts },
          {
            header: "Status",
            cell: (l) => (l.isActive ? <Badge tone="success">active</Badge> : <Badge tone="danger">archived</Badge>),
          },
          {
            header: "",
            cell: (l) =>
              writable ? (
                <div className="flex items-center justify-end gap-2">
                  <ArchiveButton isActive={l.isActive} label={l.name} action={setActive.bind(null, "location", l.id, !l.isActive)} />
                  {deletable ? (
                    <DeleteButton
                      kind="location"
                      label={l.name}
                      action={deleteRecord.bind(null, "location", l.id)}
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
