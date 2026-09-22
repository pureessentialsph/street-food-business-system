import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import {
  deleteRecord, removeSupplierIngredient, saveSupplier, saveSupplierIngredient, setActive,
} from "@/lib/actions/masterdata";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { ArchiveButton, DeleteButton, EntityForm, RemoveButton } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Checkbox, Field, NumberInput, Select, TextArea, TextInput } from "@/components/ui/field";
import { formatPHP } from "@/lib/money";

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

  /**
   * What this supplier sells, and every ingredient, so the list can be extended. Also
   * which ingredients have no preferred source anywhere — those can never be ordered.
   */
  const [supplied, ingredients, unsourced] = editing
    ? await Promise.all([
        db.supplierIngredient.findMany({
          where: { supplierId: editing.id },
          include: { ingredient: { select: { name: true, baseUnit: true } } },
          orderBy: { ingredient: { name: "asc" } },
        }),
        db.ingredient.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
        db.ingredient.findMany({
          where: { isActive: true, suppliers: { none: { isPreferred: true } } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], [], []];
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

      {editing && writable ? (
        <Card>
          <CardHeader>
            <CardTitle>What {editing.name} supplies</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-stone-600">
              Procurement needs this. An ingredient with no preferred supplier can never appear
              on a purchase order, because nothing says who to buy it from, what pack it comes in
              or how long it takes to arrive.
            </p>

            {supplied.length === 0 ? (
              <p className="text-sm text-stone-500">Nothing linked to this supplier yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-stone-200">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Ingredient</th>
                      <th className="px-3 py-2 text-left">Sold as</th>
                      <th className="px-3 py-2 text-right">Per pack</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-left">Preferred</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {supplied.map((link) => (
                      <tr key={link.id}>
                        <td className="px-3 py-2 font-medium">{link.ingredient.name}</td>
                        <td className="px-3 py-2 text-stone-600">{link.purchaseUnitName}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {link.baseUnitsPerPurchaseUnit.toFixed(0)}{" "}
                          <span className="text-xs text-stone-500">
                            {link.ingredient.baseUnit === "G" ? "g" : link.ingredient.baseUnit === "ML" ? "ml" : "pcs"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {formatPHP(link.lastPurchasePrice)}
                        </td>
                        <td className="px-3 py-2">
                          {link.isPreferred ? <Badge tone="success">preferred</Badge> : <span className="text-stone-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <RemoveButton
                            label="Remove"
                            confirmText={`Stop buying ${link.ingredient.name} from ${editing.name}?${link.isPreferred ? " It is the preferred source, so it will have none until you set another." : ""}`}
                            action={removeSupplierIngredient.bind(null, link.id)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rounded-md border border-stone-200 p-3">
              <p className="mb-2 text-sm font-medium text-stone-700">Add or update an ingredient</p>
              <EntityForm
                action={saveSupplierIngredient.bind(null, editing.id)}
                returnTo={`/suppliers?edit=${editing.id}`}
                submitLabel="Save"
              >
                <Field label="Ingredient" name="ingredientId" required>
                  <Select id="ingredientId" name="ingredientId" required defaultValue="">
                    <option value="">— select —</option>
                    {ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} (per {i.baseUnit === "G" ? "g" : i.baseUnit === "ML" ? "ml" : "pc"})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="How they sell it" name="purchaseUnitName" required hint="e.g. sack 25kg, tray 30pcs, tank 11kg">
                  <TextInput id="purchaseUnitName" name="purchaseUnitName" required placeholder="sack 25kg" />
                </Field>
                <Field
                  label="Base units per pack"
                  name="baseUnitsPerPurchaseUnit"
                  required
                  hint="How many grams, ml or pieces one pack holds — 25000 for a 25kg sack."
                >
                  <NumberInput id="baseUnitsPerPurchaseUnit" name="baseUnitsPerPurchaseUnit" required placeholder="25000" />
                </Field>
                <Field label="Price per pack (₱)" name="lastPurchasePrice" required hint="What they last charged. Receiving a delivery updates it.">
                  <NumberInput id="lastPurchasePrice" name="lastPurchasePrice" required placeholder="0.00" />
                </Field>
                <div className="flex items-end">
                  <Checkbox
                    label="Buy this from them by default"
                    name="isPreferred"
                    defaultChecked
                  />
                </div>
              </EntityForm>
            </div>

            {unsourced.length > 0 ? (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span className="font-medium">
                  {unsourced.length} ingredient{unsourced.length === 1 ? "" : "s"} still have no
                  preferred supplier
                </span>{" "}
                and cannot be ordered: {unsourced.slice(0, 8).map((i) => i.name).join(", ")}
                {unsourced.length > 8 ? ", …" : ""}.
              </div>
            ) : null}
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
          {
            header: "Name",
            /**
             * A supplier created in passing from the asset form knows only its name.
             * Flag it here, or a stub sits unnoticed and procurement suggests orders
             * against a lead time nobody chose.
             */
            cell: (s) => (
              <span className="flex flex-wrap items-center gap-2">
                {s.name}
                {!s.contactPerson && !s.mobile ? (
                  <Badge tone="warning">details to follow</Badge>
                ) : null}
              </span>
            ),
          },
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
