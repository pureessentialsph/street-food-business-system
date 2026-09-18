import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can, seesAllBranches } from "@/lib/rbac";
import { postAdjustment, rebuildStockBalances } from "@/lib/actions/inventory";
import { dec, formatPHP, sum } from "@/lib/money";
import { LOCATION_LABEL, locationNames } from "@/lib/inventory-labels";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { ActionButton } from "@/components/action-button";
import { EntityForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Field, NumberInput, Select, TextInput } from "@/components/ui/field";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; location?: string; adjust?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "inventory.write");
  const q = params.q?.trim() ?? "";

  // Stock is shown for the places a user is responsible for, not the whole company.
  const scoped = !seesAllBranches(user);
  const scopedCarts = scoped
    ? await db.cart.findMany({ where: { branchId: { in: user.scopeBranchIds } }, select: { id: true } })
    : [];
  const scopedStaff = scoped
    ? await db.employee.findMany({ where: { branchId: { in: user.scopeBranchIds } }, select: { id: true } })
    : [];
  const visibleLocationIds = scoped
    ? [...user.scopeBranchIds, ...scopedCarts.map((c) => c.id), ...scopedStaff.map((e) => e.id)]
    : [];

  const [balances, products, ingredients, branches, carts, employees, names] = await Promise.all([
    db.stockBalance.findMany({
      where: scoped ? { locationId: { in: visibleLocationIds } } : {},
      orderBy: [{ locationType: "asc" }, { updatedAt: "desc" }],
    }),
    db.product.findMany({ select: { id: true, name: true, sku: true, piecesPerStick: true } }),
    db.ingredient.findMany({ select: { id: true, name: true, sku: true, baseUnit: true } }),
    db.branch.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    db.cart.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { lastName: "asc" } }),
    locationNames(db as never),
  ]);

  const itemName = new Map<string, string>([
    ...products.map((p) => [p.id, p.name] as const),
    ...ingredients.map((i) => [i.id, i.name] as const),
  ]);

  const rows = balances
    .map((balance) => ({
      ...balance,
      item: itemName.get(balance.itemId) ?? "(deleted item)",
      where: names.get(balance.locationId) ?? balance.locationId,
      value: dec(balance.qty).times(balance.avgUnitCost),
    }))
    .filter((row) => (params.location ? row.locationType === params.location : true))
    .filter((row) =>
      q ? `${row.item} ${row.where}`.toLowerCase().includes(q.toLowerCase()) : true,
    )
    .filter((row) => !dec(row.qty).isZero());

  const totalValue = sum(rows.map((r) => r.value));
  const negatives = rows.filter((r) => dec(r.qty).isNegative());

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        subtitle="Where stock is right now. Every figure here is the sum of an append-only ledger."
        action={
          writable ? (
            <div className="flex items-end gap-2">
              <Link href="/inventory/transfers"><Button variant="secondary">Transfers</Button></Link>
              <Link href="/inventory/production"><Button variant="secondary">Production</Button></Link>
              <Link href="/inventory?adjust=1"><Button>Adjust stock</Button></Link>
            </div>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Stock on hand</p>
          <p className="mt-1 font-mono text-lg font-medium">{formatPHP(totalValue)}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Item / location pairs</p>
          <p className="mt-1 font-mono text-lg font-medium">{rows.length}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Negative balances</p>
          <p className={`mt-1 font-mono text-lg font-medium ${negatives.length ? "text-red-700" : ""}`}>
            {negatives.length}
          </p>
        </CardBody></Card>
      </div>

      {negatives.length > 0 ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-medium">{negatives.length} negative balance{negatives.length === 1 ? "" : "s"}.</span>{" "}
          Stock has gone out that was never recorded coming in — usually a missed receipt or transfer:{" "}
          {negatives.slice(0, 3).map((n) => `${n.item} at ${n.where}`).join(", ")}
          {negatives.length > 3 ? ", …" : ""}.
        </div>
      ) : null}

      {writable && params.adjust === "1" ? (
        <Card>
          <CardHeader><CardTitle>Adjust stock</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={postAdjustment} returnTo="/inventory" submitLabel="Post adjustment">
              <Field label="What happened" name="type" required>
                <Select id="type" name="type" defaultValue="WASTE">
                  <option value="WASTE">Wasted / Sira</option>
                  <option value="SPOILAGE">Spoiled</option>
                  <option value="DAMAGE">Damaged</option>
                  <option value="ADJUSTMENT">Correction</option>
                </Select>
              </Field>
              <Field label="Direction" name="direction" required hint="Out reduces stock; in corrects an under-count.">
                <Select id="direction" name="direction" defaultValue="OUT">
                  <option value="OUT">Out — reduce stock</option>
                  <option value="IN">In — increase stock</option>
                </Select>
              </Field>
              <Field label="Item type" name="itemType" required>
                <Select id="itemType" name="itemType" defaultValue="PRODUCT">
                  <option value="PRODUCT">Finished product</option>
                  <option value="INGREDIENT">Ingredient</option>
                </Select>
              </Field>
              <Field label="Item" name="itemId" required>
                <Select id="itemId" name="itemId" required defaultValue="">
                  <option value="">— select —</option>
                  <optgroup label="Products">
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                  <optgroup label="Ingredients">
                    {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </optgroup>
                </Select>
              </Field>
              <Field label="Location type" name="locationType" required>
                <Select id="locationType" name="locationType" defaultValue="BRANCH">
                  <option value="BRANCH">Branch / commissary</option>
                  <option value="CART">Cart</option>
                  <option value="EMPLOYEE">Vendor</option>
                  <option value="WAREHOUSE">Warehouse</option>
                </Select>
              </Field>
              <Field label="Location" name="locationId" required>
                <Select id="locationId" name="locationId" required defaultValue="">
                  <option value="">— select —</option>
                  <optgroup label="Branches">
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                  </optgroup>
                  <optgroup label="Carts">
                    {carts.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                  </optgroup>
                  <optgroup label="Vendors">
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                  </optgroup>
                </Select>
              </Field>
              <Field label="Quantity (pieces)" name="qty" required>
                <NumberInput id="qty" name="qty" required placeholder="0" />
              </Field>
              <Field
                label="Unit cost (₱ per piece)"
                name="unitCost"
                hint="Only used when bringing stock in. Blank values it at what this item already averages here — required for an item's first stock, or it would come in at ₱0 and sell at no cost."
              >
                <NumberInput id="unitCost" name="unitCost" placeholder="running average" />
              </Field>
              <Field label="Reason" name="reason" required hint="Required. This is what someone reads in six months' time.">
                <TextInput id="reason" name="reason" required placeholder="e.g. dropped tray at Recto, 40 fishballs" />
              </Field>
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-2">
        <SearchBar
          placeholder="Search item or location…"
          defaultValue={q}
          filters={
            <Select name="location" defaultValue={params.location ?? ""} className="w-44">
              <option value="">Everywhere</option>
              <option value="BRANCH">Branches</option>
              <option value="CART">Carts</option>
              <option value="EMPLOYEE">Vendors</option>
              <option value="WAREHOUSE">Warehouses</option>
            </Select>
          }
        />
        {writable ? (
          <ActionButton action={rebuildStockBalances} label="Rebuild from ledger" pendingLabel="Rebuilding…" />
        ) : null}
      </div>

      <DataTable
        rows={rows}
        href={(row) => `/inventory/ledger/${row.itemType}/${row.itemId}?location=${row.locationId}`}
        empty={{
          title: q ? `Nothing matches “${q}”` : "No stock recorded yet",
          action: "Run a production batch at the commissary, or post a receipt, to put stock into the system.",
        }}
        columns={[
          { header: "Item", cell: (r) => r.item },
          { header: "Kind", cell: (r) => <Badge>{r.itemType === "PRODUCT" ? "product" : "ingredient"}</Badge> },
          { header: "Where", cell: (r) => r.where },
          { header: "Location type", cell: (r) => LOCATION_LABEL[r.locationType] },
          {
            header: "On hand",
            numeric: true,
            cell: (r) => (
              <span className={dec(r.qty).isNegative() ? "font-medium text-red-700" : ""}>
                {dec(r.qty).toFixed(0)}
              </span>
            ),
          },
          { header: "Avg cost", numeric: true, cell: (r) => formatPHP(r.avgUnitCost) },
          { header: "Value", numeric: true, cell: (r) => formatPHP(r.value) },
        ]}
      />
    </div>
  );
}
