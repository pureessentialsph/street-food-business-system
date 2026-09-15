import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { saveProduct, saveProductCategory, setActive } from "@/lib/actions/masterdata";
import { formatPHP } from "@/lib/money";
import { pricePerPieceFrom } from "@/lib/units";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { ArchiveButton, EntityForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Checkbox, Field, NumberInput, Select, TextInput } from "@/components/ui/field";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; edit?: string; new?: string; newCategory?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "masterdata.write");
  const q = params.q?.trim() ?? "";

  const [products, categories, priceList] = await Promise.all([
    db.product.findMany({
      where: {
        ...(q
          ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] }
          : {}),
        ...(params.category ? { categoryId: params.category } : {}),
      },
      include: {
        category: { select: { name: true } },
        setComponents: { select: { requiredSticks: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.productCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.priceList.findFirst({
      where: { scopeType: "COMPANY", isActive: true },
      include: { items: { select: { productId: true, pricePerStick: true } } },
    }),
  ]);

  const priceOf = new Map(priceList?.items.map((i) => [i.productId, i.pricePerStick]) ?? []);
  const editing = params.edit ? await db.product.findUnique({ where: { id: params.edit } }) : null;
  const showForm = writable && (params.new === "1" || editing);
  const showCategoryForm = writable && params.newCategory === "1";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Products"
        subtitle="What customers buy, by the stick. Pieces per stick is the conversion the whole system runs on."
        action={
          writable && !showForm && !showCategoryForm ? (
            <div className="flex gap-2">
              <Link href="/products?newCategory=1"><Button variant="secondary">New category</Button></Link>
              <Link href="/products?new=1"><Button>New product</Button></Link>
            </div>
          ) : null
        }
      />

      {showCategoryForm ? (
        <Card>
          <CardHeader><CardTitle>New category</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={saveProductCategory.bind(null, null)} returnTo="/products">
              <Field label="Name" name="name" required hint="e.g. Fried snacks, Beverages">
                <TextInput id="name" name="name" required />
              </Field>
              <Field label="Sort order" name="sortOrder" hint="Lower numbers appear first on the closing grid.">
                <TextInput id="sortOrder" name="sortOrder" inputMode="numeric" defaultValue="0" />
              </Field>
              <div className="flex items-end">
                <Checkbox label="Active" name="isActive" defaultChecked />
              </div>
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>{editing ? `Edit ${editing.name}` : "New product"}</CardTitle></CardHeader>
          <CardBody>
            {categories.length === 0 ? (
              <p className="text-sm text-stone-600">
                Create a category first — every product belongs to one.{" "}
                <Link href="/products?newCategory=1" className="font-medium text-brand-700 underline">
                  New category
                </Link>
              </p>
            ) : (
              <EntityForm action={saveProduct.bind(null, editing?.id ?? null)} returnTo="/products">
                <Field label="SKU" name="sku" required hint="e.g. FISHBALL">
                  <TextInput id="sku" name="sku" defaultValue={editing?.sku ?? ""} required autoCapitalize="characters" />
                </Field>
                <Field label="Name" name="name" required>
                  <TextInput id="name" name="name" defaultValue={editing?.name ?? ""} required />
                </Field>
                <Field label="Category" name="categoryId" required>
                  <Select id="categoryId" name="categoryId" defaultValue={editing?.categoryId ?? ""} required>
                    <option value="">— select —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Selling unit" name="sellingUnit" required hint="Nearly everything sells by the stick.">
                  <Select id="sellingUnit" name="sellingUnit" defaultValue={editing?.sellingUnit ?? "STICK"}>
                    <option value="STICK">Stick</option>
                    <option value="PIECE">Piece</option>
                  </Select>
                </Field>
                <Field
                  label="Pieces per stick"
                  name="piecesPerStick"
                  required
                  hint="Kwek-kwek 4 · Calamares 3 · Squidball 5 · Fishball 10 · Kikiam 4. Use 1 for anything sold by the piece."
                >
                  <NumberInput id="piecesPerStick" name="piecesPerStick" defaultValue={editing?.piecesPerStick.toString() ?? "1"} required />
                </Field>
                <div className="flex items-end">
                  <Checkbox label="Active" name="isActive" defaultChecked={editing?.isActive ?? true} />
                </div>
              </EntityForm>
            )}
          </CardBody>
        </Card>
      ) : null}

      <SearchBar
        placeholder="Search products…"
        defaultValue={q}
        filters={
          <Select name="category" defaultValue={params.category ?? ""} className="w-48">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        }
      />

      <DataTable
        rows={products}
        href={writable ? (row) => `/products?edit=${row.id}` : undefined}
        empty={{
          title: q ? `No product matches “${q}”` : "No products yet",
          action: "Add kwek-kwek, fishball, calamares, squidball and kikiam with their pieces per stick.",
        }}
        columns={[
          { header: "SKU", cell: (p) => p.sku },
          { header: "Name", cell: (p) => p.name },
          { header: "Category", cell: (p) => p.category.name },
          { header: "Pcs / stick", numeric: true, cell: (p) => p.piecesPerStick.toString() },
          {
            header: "Price / stick",
            numeric: true,
            cell: (p) => {
              const price = priceOf.get(p.id);
              return price ? formatPHP(price) : <span className="text-amber-700">not priced</span>;
            },
          },
          {
            header: "Price / pc",
            numeric: true,
            cell: (p) => {
              const price = priceOf.get(p.id);
              return price ? formatPHP(pricePerPieceFrom(price, p.piecesPerStick)) : "—";
            },
          },
          {
            header: "In set",
            cell: (p) => (p.setComponents.length > 0 ? <Badge tone="success">yes</Badge> : <Badge>no</Badge>),
          },
          { header: "Status", cell: (p) => (p.isActive ? <Badge tone="success">active</Badge> : <Badge tone="danger">archived</Badge>) },
          {
            header: "",
            cell: (p) => (writable ? <ArchiveButton isActive={p.isActive} label={p.name} action={setActive.bind(null, "product", p.id, !p.isActive)} /> : null),
          },
        ]}
      />
    </div>
  );
}
