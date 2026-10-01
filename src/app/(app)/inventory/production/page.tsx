import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { runProductionBatch } from "@/lib/actions/inventory";
import { dec, formatPHP } from "@/lib/money";
import { DataTable, PageHeader } from "@/components/data-table";
import { EntityForm } from "@/components/entity-form";
import { ProductionQuantities } from "@/components/production-quantities";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";

/** The commissary turning ingredients into countable pieces. */
export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const today = new Date().toISOString().slice(0, 10);
  const db = scopedDb(user.companyId);
  const writable = can(user, "inventory.write");

  const [batches, commissaries, products, names] = await Promise.all([
    db.productionBatch.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.branch.findMany({ where: { isActive: true, type: { in: ["COMMISSARY", "WAREHOUSE", "BRANCH"] } }, orderBy: { code: "asc" } }),
    db.product.findMany({
      where: { isActive: true, recipes: { some: { isActive: true } } },
      select: { id: true, name: true, piecesPerStick: true },
      orderBy: { name: "asc" },
    }),
    db.product.findMany({ select: { id: true, name: true } }),
  ]);

  const productName = new Map(names.map((p) => [p.id, p.name]));
  const branchName = new Map(commissaries.map((b) => [b.id, b.code]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Production"
        subtitle="Ingredients in, countable pieces out. Consumption and output post to the ledger together."
        action={
          writable && params.new !== "1" ? (
            <div className="flex gap-2">
              <Link href="/inventory"><Button variant="secondary">All stock</Button></Link>
              <Link href="/inventory/production?new=1"><Button>New batch</Button></Link>
            </div>
          ) : null
        }
      />

      {writable && params.new === "1" ? (
        <Card>
          <CardHeader><CardTitle>Run a batch</CardTitle></CardHeader>
          <CardBody>
            {products.length === 0 ? (
              <p className="text-sm text-stone-600">
                No product has an active recipe yet, so a batch cannot be costed.{" "}
                <Link href="/costing" className="font-medium text-brand-700 underline">Add a recipe first</Link>.
              </p>
            ) : (
              <EntityForm action={runProductionBatch} returnTo="/inventory/production" submitLabel="Post batch">
                <Field label="Commissary" name="branchId" required hint="Where the ingredients are consumed and the pieces land.">
                  <Select id="branchId" name="branchId" required defaultValue="">
                    <option value="">— select —</option>
                    {commissaries.map((b) => (
                      <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
                    ))}
                  </Select>
                </Field>
                {can(user, "company.manage") ? (
                  <Field
                    label="Date cooked"
                    name="forDate"
                    hint="Leave as today unless you are writing up a batch from an earlier day."
                  >
                    <TextInput id="forDate" name="forDate" type="date" max={today} defaultValue={today} />
                  </Field>
                ) : null}
                <ProductionQuantities
                  products={products.map((p) => ({
                    id: p.id,
                    name: p.name,
                    piecesPerStick: p.piecesPerStick.toString(),
                  }))}
                />
                <Field label="Notes" name="notes">
                  <TextArea id="notes" name="notes" />
                </Field>
              </EntityForm>
            )}
          </CardBody>
        </Card>
      ) : null}

      <DataTable
        rows={batches}
        empty={{
          title: "No production batches yet",
          action: "Run a batch to convert commissary ingredients into pieces the carts can sell.",
        }}
        columns={[
          { header: "Reference", cell: (b) => b.reference },
          { header: "Date", cell: (b) => b.businessDate.toISOString().slice(0, 10) },
          { header: "Commissary", cell: (b) => branchName.get(b.branchId) ?? "—" },
          { header: "Product", cell: (b) => productName.get(b.productId) ?? "—" },
          { header: "Produced", numeric: true, cell: (b) => dec(b.actualQty).toFixed(0) },
          { header: "Wasted", numeric: true, cell: (b) => dec(b.wasteQty).toFixed(0) },
          { header: "Unit cost", numeric: true, cell: (b) => formatPHP(b.unitCost) },
          { header: "Batch value", numeric: true, cell: (b) => formatPHP(dec(b.actualQty).times(b.unitCost)) },
        ]}
      />
    </div>
  );
}
