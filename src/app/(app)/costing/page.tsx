import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { recalculateAllCosts } from "@/lib/actions/costing";
import { dec, formatPHP, formatPct, percentOf } from "@/lib/money";
import { setEconomics } from "@/lib/engines/costing";
import { DataTable, PageHeader } from "@/components/data-table";
import { ActionButton } from "@/components/action-button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";

/** Margin health at a glance, plus what moved recently and why. */
export default async function CostingPage() {
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "costing.write");

  const [products, versions, prices, recent, sets] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      include: {
        category: { select: { name: true } },
        recipes: { where: { isActive: true }, select: { id: true, version: true, _count: { select: { lines: true } } } },
      },
      orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
    }),
    db.productCostVersion.findMany({ orderBy: { effectiveFrom: "desc" } }),
    db.priceListItem.findMany({
      where: { priceList: { isActive: true, scopeType: "COMPANY" } },
      select: { productId: true, pricePerStick: true },
    }),
    db.productCostVersion.findMany({
      where: { triggeredBy: { in: ["INGREDIENT_COST_CHANGE", "RECIPE_EDITED"] } },
      include: { product: { select: { name: true } } },
      orderBy: { effectiveFrom: "desc" },
      take: 5,
    }),
    db.setDefinition.findMany({
      where: { isActive: true },
      include: { components: { include: { product: { select: { id: true, name: true } } } } },
    }),
  ]);

  // Latest cost per product, and the one before it, so a move can be shown as a delta.
  const latest = new Map<string, (typeof versions)[number]>();
  const previous = new Map<string, (typeof versions)[number]>();
  for (const v of versions) {
    if (!latest.has(v.productId)) latest.set(v.productId, v);
    else if (!previous.has(v.productId)) previous.set(v.productId, v);
  }
  const priceOf = new Map(prices.map((p) => [p.productId, p.pricePerStick]));

  const rows = products.map((product) => {
    const cost = latest.get(product.id);
    const price = priceOf.get(product.id) ?? null;
    const costPerStick = cost ? cost.costPerStick : null;
    const grossProfit = price && costPerStick ? dec(price).minus(costPerStick) : null;
    const marginPct = grossProfit && price ? percentOf(grossProfit, price) : null;
    const prior = previous.get(product.id);
    const delta =
      cost && prior && !prior.costPerStick.isZero()
        ? dec(cost.costPerStick).minus(prior.costPerStick).dividedBy(prior.costPerStick).times(100)
        : null;
    return { ...product, costPerStick, price, grossProfit, marginPct, delta };
  });

  const uncosted = rows.filter((r) => !r.costPerStick);
  const thin = rows.filter((r) => r.marginPct && r.marginPct.lessThan(30));

  // What one full set costs to load and what it is worth sold out.
  const setCards = sets.map((set) => {
    const components = set.components
      .map((component) => {
        const cost = latest.get(component.product.id);
        const price = priceOf.get(component.product.id);
        if (!cost || !price) return null;
        return {
          costPerStick: cost.costPerStick.toString(),
          pricePerStick: price.toString(),
          requiredSticks: component.requiredSticks.toString(),
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    return {
      id: set.id,
      code: set.code,
      complete: components.length === set.components.length && set.components.length > 0,
      economics: components.length > 0 ? setEconomics(components) : null,
    };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Costing"
        subtitle="What every product actually costs to put on a stick, and what is left after you sell it."
        action={
          writable ? (
            <ActionButton action={recalculateAllCosts} label="Recalculate all" pendingLabel="Recalculating…" />
          ) : null
        }
      />

      {uncosted.length > 0 ? (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">{uncosted.length} product{uncosted.length === 1 ? " has" : "s have"} no recipe yet.</span>{" "}
          Without one there is no cost, so no margin and no COGS on a shift:{" "}
          {uncosted.map((p) => p.name).join(", ")}.
        </div>
      ) : null}

      {thin.length > 0 ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-medium">Thin margin warning.</span>{" "}
          {thin.map((p) => `${p.name} at ${formatPct(p.marginPct!, 1)}`).join(", ")} —
          under 30% leaves little room for wastage and cash shortages.
        </div>
      ) : null}

      {recent.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Recent cost changes</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-stone-100 text-sm">
              {recent.map((version) => (
                <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium text-stone-900">{version.product.name}</span>{" "}
                    <span className="text-stone-500">
                      {version.triggeredBy === "INGREDIENT_COST_CHANGE" ? "ingredient price changed" : "recipe edited"}
                      {version.note ? ` — ${version.note}` : ""}
                    </span>
                  </span>
                  <span className="font-mono text-stone-700">
                    {formatPHP(version.costPerStick)} / stick ·{" "}
                    {version.effectiveFrom.toLocaleDateString("en-PH", { day: "numeric", month: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <DataTable
        rows={rows}
        href={(row) => `/costing/${row.id}`}
        empty={{ title: "No products to cost", action: "Add products first, then give each one a recipe." }}
        columns={[
          { header: "Product", cell: (r) => r.name },
          { header: "Category", cell: (r) => r.category.name },
          { header: "Pcs / stick", numeric: true, cell: (r) => r.piecesPerStick.toString() },
          {
            header: "Recipe",
            cell: (r) =>
              r.recipes[0]
                ? <Badge tone="success">{r.recipes[0]._count.lines} lines</Badge>
                : <Badge tone="warning">none</Badge>,
          },
          {
            header: "Cost / stick",
            numeric: true,
            cell: (r) => (r.costPerStick ? formatPHP(r.costPerStick) : "—"),
          },
          {
            header: "Change",
            numeric: true,
            cell: (r) =>
              r.delta ? (
                <span className={r.delta.isPositive() ? "text-red-700" : "text-emerald-700"}>
                  {r.delta.isPositive() ? "+" : ""}{r.delta.toFixed(1)}%
                </span>
              ) : "—",
          },
          { header: "Price / stick", numeric: true, cell: (r) => (r.price ? formatPHP(r.price) : "—") },
          { header: "Gross profit", numeric: true, cell: (r) => (r.grossProfit ? formatPHP(r.grossProfit) : "—") },
          {
            header: "Margin",
            numeric: true,
            cell: (r) =>
              r.marginPct ? (
                <span className={r.marginPct.lessThan(30) ? "font-medium text-red-700" : "text-stone-900"}>
                  {formatPct(r.marginPct, 1)}
                </span>
              ) : "—",
          },
        ]}
      />

      {setCards.some((s) => s.economics) ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {setCards.filter((s) => s.economics).map((set) => (
            <Card key={set.id}>
              <CardHeader>
                <CardTitle>{set.code} — one full set</CardTitle>
              </CardHeader>
              <CardBody className="space-y-1 text-sm">
                {!set.complete ? (
                  <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                    Some components have no cost or price yet, so this is partial.
                  </p>
                ) : null}
                <div className="flex justify-between"><span className="text-stone-500">Cost to load</span><span className="font-mono">{formatPHP(set.economics!.cost)}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">Worth sold out</span><span className="font-mono">{formatPHP(set.economics!.revenue)}</span></div>
                <div className="flex justify-between font-medium"><span>Gross profit</span><span className="font-mono">{formatPHP(set.economics!.grossProfit)}</span></div>
                <div className="flex justify-between"><span className="text-stone-500">Margin</span><span className="font-mono">{set.economics!.marginPct ? formatPct(set.economics!.marginPct, 1) : "—"}</span></div>
                <p className="pt-2 text-xs text-stone-500">
                  Compare this gross profit against the set incentive on the{" "}
                  <Link href="/sets" className="font-medium text-brand-700 hover:underline">Sets</Link> screen
                  before changing what a vendor earns.
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
