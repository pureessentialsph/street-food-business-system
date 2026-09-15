import Link from "next/link";
import { notFound } from "next/navigation";
import type { ItemType } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { dec, formatPHP, sum } from "@/lib/money";
import { LOCATION_LABEL, TXN_LABEL, locationNames } from "@/lib/inventory-labels";
import { PageHeader } from "@/components/data-table";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";

/**
 * The trace: supplier → commissary → branch → cart → vendor → sold, returned or wasted.
 * Every row says who moved it, when, and why.
 */
export default async function ItemLedgerPage({
  params, searchParams,
}: {
  params: Promise<{ itemType: string; itemId: string }>;
  searchParams: Promise<{ location?: string }>;
}) {
  const { itemType: rawType, itemId } = await params;
  const { location } = await searchParams;
  const itemType = rawType.toUpperCase() as ItemType;
  if (itemType !== "PRODUCT" && itemType !== "INGREDIENT") notFound();

  const user = await requireUser();
  const db = scopedDb(user.companyId);

  const item =
    itemType === "PRODUCT"
      ? await db.product.findUnique({ where: { id: itemId }, select: { name: true, sku: true, piecesPerStick: true } })
      : await db.ingredient.findUnique({ where: { id: itemId }, select: { name: true, sku: true, baseUnit: true } });
  if (!item) notFound();

  const [transactions, balances, names, users] = await Promise.all([
    db.inventoryTransaction.findMany({
      where: { itemType, itemId, ...(location ? { locationId: location } : {}) },
      orderBy: [{ occurredAt: "desc" }],
      take: 200,
    }),
    db.stockBalance.findMany({ where: { itemType, itemId } }),
    locationNames(db as never),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);

  const userName = new Map(users.map((u) => [u.id, u.name]));
  const totalOnHand = sum(balances.map((b) => b.qty));

  // Running balance, oldest first, so the newest row shows today's position.
  let running = dec(0);
  const ordered = [...transactions].reverse().map((txn) => {
    running = running.plus(txn.qty.toString());
    return { ...txn, running: running.toFixed(0) };
  });
  const rows = ordered.reverse();

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${item.name} — stock ledger`}
        subtitle={`${item.sku} · ${dec(totalOnHand).toFixed(0)} on hand across ${balances.length} location${balances.length === 1 ? "" : "s"}`}
        action={<Link href="/inventory" className="text-sm font-medium text-brand-700 hover:underline">← All stock</Link>}
      />

      <Card>
        <CardHeader><CardTitle>Where it is now</CardTitle></CardHeader>
        <CardBody>
          {balances.length === 0 ? (
            <EmptyState title="No stock anywhere" action="Produce or receive some to start the trail." />
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {balances.map((balance) => (
                <li key={balance.id} className="flex items-center justify-between py-2">
                  <span>
                    <span className="font-medium text-stone-900">{names.get(balance.locationId) ?? balance.locationId}</span>{" "}
                    <span className="text-xs uppercase tracking-wide text-stone-400">{LOCATION_LABEL[balance.locationType]}</span>
                  </span>
                  <span className="font-mono tabular-nums">
                    <span className={dec(balance.qty).isNegative() ? "text-red-700" : ""}>{dec(balance.qty).toFixed(0)}</span>
                    <span className="ml-3 text-stone-500">{formatPHP(balance.avgUnitCost)} avg</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Movement history{location ? " — this location" : ""}
            {location ? (
              <Link href={`/inventory/ledger/${rawType}/${itemId}`} className="ml-2 text-xs font-normal text-brand-700 hover:underline">
                show all locations
              </Link>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title="Nothing has moved yet" action="Movements appear here the moment stock is produced, transferred or issued." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">When</th>
                    <th className="px-3 py-2 text-left">What happened</th>
                    <th className="px-3 py-2 text-left">Where</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Running</th>
                    <th className="px-3 py-2 text-left">Who</th>
                    <th className="px-3 py-2 text-left">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((txn) => {
                    const qty = dec(txn.qty);
                    return (
                      <tr key={txn.id}>
                        <td className="px-3 py-2 whitespace-nowrap text-stone-600">
                          {txn.occurredAt.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
                        </td>
                        <td className="px-3 py-2"><Badge>{TXN_LABEL[txn.type]}</Badge></td>
                        <td className="px-3 py-2">{names.get(txn.locationId) ?? txn.locationId}</td>
                        <td className={`px-3 py-2 text-right font-mono tabular-nums ${qty.isNegative() ? "text-red-700" : "text-emerald-700"}`}>
                          {qty.isPositive() ? "+" : ""}{qty.toFixed(0)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-500">{txn.running}</td>
                        <td className="px-3 py-2 text-stone-600">{txn.createdById ? userName.get(txn.createdById) ?? "—" : "system"}</td>
                        <td className="px-3 py-2 text-stone-500">{txn.reason ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-stone-500">
            The ledger is append-only. A mistake is corrected by posting an adjustment, never by
            editing or deleting a row — which is why this history can be trusted.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
