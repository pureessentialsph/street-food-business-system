import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { removeRecipeLine, saveRecipe, saveRecipeLine } from "@/lib/actions/costing";
import { dec, formatPHP, formatPct, percentOf } from "@/lib/money";
import type { CostBreakdown } from "@/lib/engines/costing";
import { PageHeader } from "@/components/data-table";
import { EntityForm, RemoveButton } from "@/components/entity-form";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { Badge, Field, NumberInput, Select, TextArea } from "@/components/ui/field";

const BASIS_LABEL = {
  PER_BATCH: "Per batch",
  PER_PIECE: "Per piece",
  PER_STICK: "Per stick",
} as const;

const BASIS_HELP = {
  PER_BATCH: "divided by the batch yield",
  PER_PIECE: "charged for every piece fried",
  PER_STICK: "charged once per stick sold",
} as const;

const UNIT_LABEL = { G: "g", ML: "ml", PC: "pc" } as const;

export default async function ProductCostingPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "costing.write");

  const product = await db.product.findUnique({
    where: { id: productId },
    include: { category: { select: { name: true } } },
  });
  if (!product) notFound();

  const [recipe, ingredients, versions, priceItem] = await Promise.all([
    db.recipe.findFirst({
      where: { productId, isActive: true },
      include: {
        lines: {
          include: { ingredient: { select: { id: true, name: true, baseUnit: true, currentCostPerBaseUnit: true } } },
          orderBy: [{ allocationBasis: "asc" }, { createdAt: "asc" }],
        },
      },
      orderBy: { version: "desc" },
    }),
    db.ingredient.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.productCostVersion.findMany({ where: { productId }, orderBy: { effectiveFrom: "desc" }, take: 10 }),
    db.priceListItem.findFirst({
      where: { productId, priceList: { isActive: true, scopeType: "COMPANY" } },
    }),
  ]);

  const currentVersion = versions[0];
  const breakdown = currentVersion ? (currentVersion.breakdown as unknown as CostBreakdown) : null;
  const price = priceItem?.pricePerStick ?? null;
  const grossProfit = price && currentVersion ? dec(price).minus(currentVersion.costPerStick) : null;
  const marginPct = grossProfit && price ? percentOf(grossProfit, price) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${product.name} — costing`}
        subtitle={`${product.category.name} · ${product.piecesPerStick.toString()} pieces per stick · ${
          price ? `${formatPHP(price)} per stick` : "no price set"
        }`}
        action={<Link href="/costing" className="text-sm font-medium text-brand-700 hover:underline">← All products</Link>}
      />

      {currentVersion ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Card><CardBody>
            <p className="text-xs uppercase tracking-wide text-stone-500">Cost / piece</p>
            <p className="mt-1 font-mono text-lg font-medium">{formatPHP(currentVersion.costPerPiece)}</p>
          </CardBody></Card>
          <Card><CardBody>
            <p className="text-xs uppercase tracking-wide text-stone-500">Cost / stick</p>
            <p className="mt-1 font-mono text-lg font-medium">{formatPHP(currentVersion.costPerStick)}</p>
          </CardBody></Card>
          <Card><CardBody>
            <p className="text-xs uppercase tracking-wide text-stone-500">Gross profit</p>
            <p className="mt-1 font-mono text-lg font-medium">{grossProfit ? formatPHP(grossProfit) : "—"}</p>
          </CardBody></Card>
          <Card><CardBody>
            <p className="text-xs uppercase tracking-wide text-stone-500">Margin</p>
            <p className={`mt-1 font-mono text-lg font-medium ${marginPct?.lessThan(30) ? "text-red-700" : ""}`}>
              {marginPct ? formatPct(marginPct, 1) : "—"}
            </p>
          </CardBody></Card>
        </div>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Recipe {recipe ? `v${recipe.version}` : ""}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {writable ? (
            <EntityForm
              action={saveRecipe.bind(null, recipe?.id ?? null)}
              returnTo={`/costing/${productId}`}
              submitLabel={recipe ? "Save recipe" : "Create recipe"}
            >
              <input type="hidden" name="productId" value={productId} />
              <Field
                label="Batch yield (pieces)"
                name="batchYieldPieces"
                required
                hint="How many pieces one batch produces. Every per-batch line is divided by this."
              >
                <NumberInput id="batchYieldPieces" name="batchYieldPieces" defaultValue={recipe?.batchYieldPieces.toString() ?? "200"} required />
              </Field>
              <Field label="Notes" name="notes">
                <TextArea id="notes" name="notes" defaultValue={recipe?.notes ?? ""} />
              </Field>
            </EntityForm>
          ) : (
            <p className="text-sm text-stone-600">
              Batch yield: {recipe?.batchYieldPieces.toString() ?? "—"} pieces
            </p>
          )}

          {!recipe ? (
            <EmptyState
              title="No recipe yet"
              action="Set a batch yield above, then add the ingredients this product consumes."
            />
          ) : recipe.lines.length === 0 ? (
            <EmptyState title="Recipe has no ingredients" action="Add the raw materials, oil, packaging and sauce below." />
          ) : (
            <div className="overflow-x-auto rounded-md border border-stone-200">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Ingredient</th>
                    <th className="px-3 py-2 text-left">Allocation</th>
                    <th className="px-3 py-2 text-right">Quantity</th>
                    <th className="px-3 py-2 text-right">Unit cost</th>
                    <th className="px-3 py-2 text-right">Wastage</th>
                    <th className="px-3 py-2 text-right">Line cost</th>
                    <th className="px-3 py-2 text-right">Per stick</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {recipe.lines.map((line) => {
                    const detail = breakdown?.lines.find(
                      (l) => l.ingredientId === line.ingredientId && l.allocationBasis === line.allocationBasis,
                    );
                    return (
                      <tr key={line.id}>
                        <td className="px-3 py-2">
                          <span className="font-medium text-stone-900">{line.ingredient.name}</span>
                          <span className="ml-2 text-xs text-stone-500">{line.componentType.toLowerCase()}</span>
                        </td>
                        <td className="px-3 py-2">
                          <Badge>{BASIS_LABEL[line.allocationBasis]}</Badge>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {line.qtyInBaseUnit.toString()} {UNIT_LABEL[line.ingredient.baseUnit]}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {formatPHP(line.ingredient.currentCostPerBaseUnit)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {dec(line.wastagePct).times(100).toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {detail ? formatPHP(detail.totalCost) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-medium">
                          {detail ? formatPHP(detail.perStick) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {writable ? (
                            <RemoveButton
                              label="Remove"
                              confirmText={`Remove ${line.ingredient.name} from the ${product.name} recipe? The cost will be recalculated.`}
                              action={removeRecipeLine.bind(null, line.id)}
                            />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {recipe && writable ? (
            <div className="rounded-md border border-stone-200 p-3">
              <p className="mb-2 text-sm font-medium text-stone-700">Add or update an ingredient</p>
              <EntityForm
                action={saveRecipeLine.bind(null, recipe.id, null)}
                returnTo={`/costing/${productId}`}
                submitLabel="Save line"
              >
                <Field label="Ingredient" name="ingredientId" required>
                  <Select id="ingredientId" name="ingredientId" required defaultValue="">
                    <option value="">— select —</option>
                    {ingredients.map((ingredient) => (
                      <option key={ingredient.id} value={ingredient.id}>
                        {ingredient.name} ({formatPHP(ingredient.currentCostPerBaseUnit)}/{UNIT_LABEL[ingredient.baseUnit]})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Allocation"
                  name="allocationBasis"
                  required
                  hint="Per batch: flour and eggs. Per piece: frying oil. Per stick: the stick, cup and sauce."
                >
                  <Select id="allocationBasis" name="allocationBasis" defaultValue="PER_BATCH">
                    {(["PER_BATCH", "PER_PIECE", "PER_STICK"] as const).map((basis) => (
                      <option key={basis} value={basis}>{BASIS_LABEL[basis]} — {BASIS_HELP[basis]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Quantity in base units" name="qtyInBaseUnit" required hint="Grams, millilitres or pieces, matching the ingredient.">
                  <NumberInput id="qtyInBaseUnit" name="qtyInBaseUnit" required placeholder="0" />
                </Field>
                <Field label="Wastage %" name="wastagePct" required hint="Trim, spillage and breakage on this line. 0 if none.">
                  <NumberInput id="wastagePct" name="wastagePct" defaultValue="0" required />
                </Field>
                <Field label="Component type" name="componentType" required hint="Groups the cost card so you can see what packaging really costs you.">
                  <Select id="componentType" name="componentType" defaultValue="RAW">
                    <option value="RAW">Raw material</option>
                    <option value="OIL">Cooking oil</option>
                    <option value="PACKAGING">Packaging</option>
                    <option value="CONDIMENT">Condiment / sauce</option>
                    <option value="CONSUMABLE">Other consumable</option>
                  </Select>
                </Field>
              </EntityForm>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {breakdown ? (
        <Card>
          <CardHeader><CardTitle>Where the money goes — one stick</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <ul className="space-y-2">
              {(Object.entries(breakdown.byComponent) as [string, string][])
                .filter(([, value]) => Number(value) > 0)
                .sort((a, b) => Number(b[1]) - Number(a[1]))
                .map(([component, value]) => {
                  const share = Number(breakdown.costPerStick) > 0
                    ? (Number(value) / Number(breakdown.costPerStick)) * 100
                    : 0;
                  return (
                    <li key={component}>
                      <div className="flex justify-between text-sm">
                        <span className="capitalize text-stone-700">{component.toLowerCase()}</span>
                        <span className="font-mono tabular-nums">{formatPHP(value)} · {share.toFixed(0)}%</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-stone-100">
                        <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.min(share, 100)}%` }} />
                      </div>
                    </li>
                  );
                })}
            </ul>
            <div className="border-t border-stone-100 pt-3 text-sm">
              <div className="flex justify-between"><span className="text-stone-500">Of which wastage</span><span className="font-mono">{formatPHP(breakdown.wastageCost)}</span></div>
              <div className="flex justify-between font-medium"><span>Total cost per stick</span><span className="font-mono">{formatPHP(breakdown.costPerStick)}</span></div>
            </div>
            <p className="text-xs text-stone-500">
              Batch of {Number(breakdown.batchYieldPieces).toLocaleString("en-PH")} pieces ·{" "}
              {formatPHP(breakdown.perBatchTotal)} of per-batch ingredients ÷ yield ={" "}
              {formatPHP(breakdown.costPerPiece)} a piece × {Number(breakdown.piecesPerStick)} pieces +{" "}
              {formatPHP(breakdown.perStickTotal)} per-stick items = {formatPHP(breakdown.costPerStick)}.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {versions.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Cost history</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-stone-100 text-sm">
              {versions.map((version, index) => {
                const older = versions[index + 1];
                const delta = older && !older.costPerStick.isZero()
                  ? dec(version.costPerStick).minus(older.costPerStick).dividedBy(older.costPerStick).times(100)
                  : null;
                return (
                  <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-stone-600">
                      {version.effectiveFrom.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
                      <span className="ml-2 text-xs uppercase tracking-wide text-stone-400">
                        {version.triggeredBy.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatPHP(version.costPerStick)}
                      {delta ? (
                        <span className={delta.isPositive() ? " text-red-700" : " text-emerald-700"}>
                          {" "}({delta.isPositive() ? "+" : ""}{delta.toFixed(1)}%)
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-stone-500">
              Cost versions are never edited. A shift uses the version that applied on its business
              date, so changing a price today cannot move last week&apos;s reported profit.
            </p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
