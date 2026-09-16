import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { regenerateSuggestions } from "@/lib/actions/procurement";
import { generateSuggestions, supplierPerformance } from "@/lib/procurement-service";
import { dec, formatPHP } from "@/lib/money";
import { OrderBuilder } from "./order-builder";
import { DismissButton } from "./dismiss-button";
import { ActionButton } from "@/components/action-button";
import { DataTable, PageHeader } from "@/components/data-table";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";

/**
 * The morning order list (spec §9): what is running out, how urgently, and what to buy.
 * Every suggestion says why in plain language, and every quantity is editable.
 */
export default async function ProcurementPage() {
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const canOrder = can(user, "procurement.approve");

  const [suggestions, stored, orders, branches, performance] = await Promise.all([
    generateSuggestions(db),
    db.replenishmentSuggestion.findMany({ where: { status: { in: ["NEW", "DISMISSED"] } } }),
    db.purchaseOrder.findMany({
      include: { lines: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    db.branch.findMany({ select: { id: true, code: true, name: true } }),
    supplierPerformance(db),
  ]);

  const dismissed = new Set(
    stored.filter((s) => s.status === "DISMISSED").map((s) => `${s.itemId}|${s.locationId}`),
  );
  const storedId = new Map(stored.map((s) => [`${s.itemId}|${s.locationId}`, s.id]));

  const live = suggestions.filter((s) => !dismissed.has(`${s.itemId}|${s.locationId}`));
  const urgent = live.filter((s) => s.triggered && s.daysOfCover && s.daysOfCover.lessThan(3));
  const overstocked = live.filter((s) => s.overstocked);
  const orderable = live.filter((s) => s.triggered && s.suggestedQty.greaterThan(0));
  const branchName = new Map(branches.map((b) => [b.id, `${b.code} · ${b.name}`]));

  // Group what can be ordered by supplier and destination, since that is one PO.
  const groups = new Map<string, typeof orderable>();
  for (const item of orderable) {
    if (!item.preferredSupplierId) continue;
    const key = `${item.preferredSupplierId}|${item.locationId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const noSupplier = orderable.filter((s) => !s.preferredSupplierId);

  const tone = (status: string) =>
    status === "RECEIVED" ? "success" : status === "CANCELLED" ? "danger"
      : status === "ORDERED" || status === "PARTIALLY_RECEIVED" ? "warning" : "neutral";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Procurement"
        subtitle="What to buy, how much, and why — worked out from what the carts actually sold."
        action={canOrder ? <ActionButton action={regenerateSuggestions} label="Recalculate" pendingLabel="Working…" /> : null}
      />

      {urgent.length > 0 ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-medium">
            {urgent.length} item{urgent.length === 1 ? "" : "s"} run out within three days.
          </span>{" "}
          {urgent.slice(0, 3).map((u) => `${u.itemName} (${u.daysOfCover!.toFixed(1)} days)`).join(", ")}
          {urgent.length > 3 ? ", …" : ""}
        </div>
      ) : null}

      {overstocked.length > 0 ? (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">
            {overstocked.length} item{overstocked.length === 1 ? " is" : "s are"} overstocked.
          </span>{" "}
          More than a month of cover on {overstocked.map((o) => o.itemName).join(", ")} — cash sitting
          on a shelf, and perishables risk spoiling.
        </div>
      ) : null}

      {live.length === 0 ? (
        <EmptyState
          title="Nothing needs reordering"
          action="Every item is above its reorder point. Suggestions appear as carts sell and the commissary consumes stock."
        />
      ) : (
        <Card>
          <CardHeader><CardTitle>Needs attention</CardTitle></CardHeader>
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-left">Where</th>
                    <th className="px-3 py-2 text-right">On hand</th>
                    <th className="px-3 py-2 text-right">Used / day</th>
                    <th className="px-3 py-2 text-right">Cover</th>
                    <th className="px-3 py-2 text-right">Suggested</th>
                    <th className="px-3 py-2 text-left">Why</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {live.map((item) => {
                    const cover = item.daysOfCover;
                    return (
                      <tr key={`${item.itemId}|${item.locationId}`}>
                        <td className="px-3 py-2 font-medium text-stone-900">{item.itemName}</td>
                        <td className="px-3 py-2 text-stone-600">{item.locationName}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{item.onHand.toFixed(0)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{item.avgDailyUsage.toFixed(0)}</td>
                        <td className={`px-3 py-2 text-right font-mono tabular-nums ${cover && cover.lessThan(3) ? "font-medium text-red-700" : ""}`}>
                          {cover ? `${cover.toFixed(1)} d` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-medium">
                          {item.suggestedQty.greaterThan(0) ? item.suggestedQty.toFixed(0) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-500">{item.reason}</td>
                        <td className="px-3 py-2 text-right">
                          {canOrder && storedId.get(`${item.itemId}|${item.locationId}`) ? (
                            <DismissButton suggestionId={storedId.get(`${item.itemId}|${item.locationId}`)!} />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-stone-500">
              Usage is measured over trading days, not calendar days, so a cart that rests on
              Sundays is not made to look slower than it is. Every figure is a starting point —
              edit the quantity before ordering.
            </p>
          </CardBody>
        </Card>
      )}

      {noSupplier.length > 0 ? (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">{noSupplier.length} item{noSupplier.length === 1 ? "" : "s"} have no preferred supplier</span>{" "}
          so no order can be raised: {noSupplier.map((n) => n.itemName).join(", ")}. Set one under{" "}
          <Link href="/suppliers" className="font-medium underline">Suppliers</Link>.
        </div>
      ) : null}

      {canOrder ? [...groups.entries()].map(([key, items]) => {
        const [supplierId, branchId] = key.split("|");
        return (
          <OrderBuilder
            key={key}
            supplierId={supplierId!}
            supplierName={items[0]!.preferredSupplierName ?? "Supplier"}
            branchId={branchId!}
            branchName={branchName.get(branchId!) ?? branchId!}
            items={items.map((item) => ({
              itemId: item.itemId,
              itemName: item.itemName,
              suggestedQty: item.suggestedQty.toFixed(0),
              purchaseUnitName: item.purchaseUnitName ?? "unit",
              baseUnitsPerPurchaseUnit: item.baseUnitsPerPurchaseUnit ?? "1",
              lastPurchasePrice: item.lastPurchasePrice ?? "0",
            }))}
          />
        );
      }) : null}

      <DataTable
        rows={orders.map((o) => ({ ...o, id: o.poNo }))}
        href={(row) => `/procurement/${row.poNo}`}
        empty={{
          title: "No purchase orders yet",
          action: "Build one from the suggestions above, or add lines by hand.",
        }}
        columns={[
          { header: "Reference", cell: (o) => o.reference },
          { header: "Destination", cell: (o) => branchName.get(o.destinationBranchId) ?? "—" },
          { header: "Lines", numeric: true, cell: (o) => o.lines.length },
          { header: "Value", numeric: true, cell: (o) => formatPHP(o.totalAmount) },
          {
            header: "Expected",
            cell: (o) => (o.expectedAt ? o.expectedAt.toISOString().slice(0, 10) : "—"),
          },
          { header: "Status", cell: (o) => <Badge tone={tone(o.status)}>{o.status.replace("_", " ").toLowerCase()}</Badge> },
        ]}
      />

      {performance.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Supplier performance</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-stone-100 text-sm">
              {performance.map((supplier) => (
                <li key={supplier.id} className="flex items-center justify-between py-2">
                  <span>
                    <span className="font-medium text-stone-900">{supplier.name}</span>
                    <span className="block text-xs text-stone-500">
                      {supplier.orders} order{supplier.orders === 1 ? "" : "s"} · {supplier.leadTimeDays}-day quoted lead time
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    <span className={`font-mono ${supplier.fillRatePct && Number(supplier.fillRatePct) < 95 ? "text-amber-700" : "text-stone-700"}`}>
                      {supplier.fillRatePct ? `${supplier.fillRatePct}% delivered` : "—"}
                    </span>
                    {supplier.lateOrders > 0 ? (
                      <span className="block text-red-700">{supplier.lateOrders} late</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
