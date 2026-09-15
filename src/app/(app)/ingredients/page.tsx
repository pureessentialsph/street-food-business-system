import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { deleteRecord, saveIngredient, setActive } from "@/lib/actions/masterdata";
import { formatPHP } from "@/lib/money";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { ArchiveButton, DeleteButton, EntityForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Checkbox, Field, NumberInput, Select, TextInput } from "@/components/ui/field";

const CATEGORIES = ["RAW", "PACKAGING", "CONDIMENT", "OIL", "CONSUMABLE"] as const;
const UNIT_LABEL = { G: "gram", ML: "millilitre", PC: "piece" } as const;

export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; edit?: string; new?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "masterdata.write");
  const deletable = can(user, "masterdata.delete");
  const q = params.q?.trim() ?? "";

  const ingredients = await db.ingredient.findMany({
    where: {
      ...(q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] }
        : {}),
      ...(params.category && CATEGORIES.includes(params.category as (typeof CATEGORIES)[number])
        ? { category: params.category as (typeof CATEGORIES)[number] }
        : {}),
    },
    orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }],
  });

  const editing = params.edit ? await db.ingredient.findUnique({ where: { id: params.edit } }) : null;
  const showForm = writable && (params.new === "1" || editing);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ingredients"
        subtitle="Everything a recipe can consume — raw materials, packaging, condiments, oil. Costed per base unit."
        action={writable && !showForm ? <Link href="/ingredients?new=1"><Button>New ingredient</Button></Link> : null}
      />

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>{editing ? `Edit ${editing.name}` : "New ingredient"}</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={saveIngredient.bind(null, editing?.id ?? null)} returnTo="/ingredients">
              <Field label="SKU" name="sku" required hint="e.g. RAW-QUAIL-EGG">
                <TextInput id="sku" name="sku" defaultValue={editing?.sku ?? ""} required autoCapitalize="characters" />
              </Field>
              <Field label="Name" name="name" required>
                <TextInput id="name" name="name" defaultValue={editing?.name ?? ""} required />
              </Field>
              <Field label="Category" name="category" required>
                <Select id="category" name="category" defaultValue={editing?.category ?? "RAW"}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Base unit" name="baseUnit" required hint="The smallest unit a recipe measures in. Cannot be changed casually — recipes depend on it.">
                <Select id="baseUnit" name="baseUnit" defaultValue={editing?.baseUnit ?? "G"}>
                  <option value="G">Gram (g)</option>
                  <option value="ML">Millilitre (ml)</option>
                  <option value="PC">Piece (pc)</option>
                </Select>
              </Field>
              <Field label="Cost per base unit (₱)" name="currentCostPerBaseUnit" required hint="Changing this writes a cost-history row; Phase 2 recalculates affected products.">
                <NumberInput id="currentCostPerBaseUnit" name="currentCostPerBaseUnit" defaultValue={editing?.currentCostPerBaseUnit.toString() ?? "0"} required />
              </Field>
              <Field label="Pack size" name="packSize" required hint="Purchases round up to this. A 250-piece bag means orders come in 250s.">
                <NumberInput id="packSize" name="packSize" defaultValue={editing?.packSize.toString() ?? "1"} required />
              </Field>
              <Field label="Minimum stock" name="minStock" required>
                <NumberInput id="minStock" name="minStock" defaultValue={editing?.minStock.toString() ?? "0"} required />
              </Field>
              <Field label="Safety stock" name="safetyStock" required hint="Buffer held against supplier delays.">
                <NumberInput id="safetyStock" name="safetyStock" defaultValue={editing?.safetyStock.toString() ?? "0"} required />
              </Field>
              <div className="flex items-end">
                <Checkbox label="Active" name="isActive" defaultChecked={editing?.isActive ?? true} />
              </div>
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      <SearchBar
        placeholder="Search ingredients…"
        defaultValue={q}
        filters={
          <Select name="category" defaultValue={params.category ?? ""} className="w-44">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>
            ))}
          </Select>
        }
      />

      <DataTable
        rows={ingredients}
        href={writable ? (row) => `/ingredients?edit=${row.id}` : undefined}
        empty={{
          title: q ? `No ingredient matches “${q}”` : "No ingredients yet",
          action: "Add quail eggs, flour, oil, sticks and sauce — recipes in Phase 2 draw on this list.",
        }}
        columns={[
          { header: "SKU", cell: (i) => i.sku },
          { header: "Name", cell: (i) => i.name },
          { header: "Category", cell: (i) => <Badge>{i.category.toLowerCase()}</Badge> },
          { header: "Base unit", cell: (i) => UNIT_LABEL[i.baseUnit] },
          { header: "Cost / unit", numeric: true, cell: (i) => formatPHP(i.currentCostPerBaseUnit) },
          { header: "Pack", numeric: true, cell: (i) => i.packSize.toString() },
          { header: "Safety", numeric: true, cell: (i) => i.safetyStock.toString() },
          { header: "Status", cell: (i) => (i.isActive ? <Badge tone="success">active</Badge> : <Badge tone="danger">archived</Badge>) },
          {
            header: "",
            cell: (i) => (writable ?
                <div className="flex items-center justify-end gap-2">
                  <ArchiveButton isActive={i.isActive} label={i.name} action={setActive.bind(null, "ingredient", i.id, !i.isActive)} />
                  {deletable ? (
                    <DeleteButton
                      kind="ingredient"
                      label={i.name}
                      action={deleteRecord.bind(null, "ingredient", i.id)}
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
