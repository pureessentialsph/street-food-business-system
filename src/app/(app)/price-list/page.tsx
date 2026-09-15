import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { savePrice } from "@/lib/actions/masterdata";
import { formatPHP } from "@/lib/money";
import { pricePerPieceFrom } from "@/lib/units";
import { PageHeader } from "@/components/data-table";
import { EntityForm } from "@/components/entity-form";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { Field, NumberInput } from "@/components/ui/field";

/**
 * One company-wide price list (spec §5.3.1, confirmed). Branch and cart scoping exist in
 * the schema but are deliberately unused, so there is exactly one price per product.
 */
export default async function PriceListPage() {
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "masterdata.write");

  const list = await db.priceList.findFirst({
    where: { scopeType: "COMPANY", isActive: true },
    include: { items: true },
  });

  const products = await db.product.findMany({
    where: { isActive: true },
    include: { category: { select: { name: true } } },
    orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
  });

  if (!list) {
    return (
      <div className="space-y-5">
        <PageHeader title="Price list" />
        <EmptyState
          title="No active company price list"
          action="Run `pnpm db:seed` to create the company-wide list, or add one in Settings."
        />
      </div>
    );
  }

  const priceOf = new Map(list.items.map((i) => [i.productId, i.pricePerStick]));
  const unpriced = products.filter((p) => !priceOf.has(p.id));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Price list"
        subtitle={`${list.name} — one price per product, company-wide. Price per piece is derived, never stored.`}
      />

      {unpriced.length > 0 ? (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">{unpriced.length} product{unpriced.length === 1 ? "" : "s"} without a price.</span>{" "}
          A shift cannot compute sales for an unpriced product: {unpriced.map((p) => p.name).join(", ")}.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {products.map((product) => {
          const price = priceOf.get(product.id);
          return (
            <Card key={product.id}>
              <CardHeader>
                <CardTitle>
                  {product.name}{" "}
                  <span className="font-normal text-stone-500">
                    · {product.category.name} · {product.piecesPerStick.toString()} pcs/stick
                  </span>
                </CardTitle>
              </CardHeader>
              <CardBody>
                {writable ? (
                  <EntityForm
                    action={savePrice.bind(null, list.id)}
                    returnTo="/price-list"
                    submitLabel={price ? "Update price" : "Set price"}
                    compact
                  >
                    <input type="hidden" name="productId" value={product.id} />
                    <Field
                      label="Price per stick (₱)"
                      name={`price-${product.id}`}
                      required
                      hint={
                        price
                          ? `Currently ${formatPHP(price)} — that is ${formatPHP(
                              pricePerPieceFrom(price, product.piecesPerStick),
                            )} per piece.`
                          : "What a customer pays for one stick."
                      }
                    >
                      <NumberInput
                        id={`price-${product.id}`}
                        name="pricePerStick"
                        defaultValue={price?.toString() ?? ""}
                        placeholder="0.00"
                        required
                      />
                    </Field>
                  </EntityForm>
                ) : (
                  <p className="text-sm text-stone-700">
                    {price ? `${formatPHP(price)} per stick` : "Not priced"}
                  </p>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
