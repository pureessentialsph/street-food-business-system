import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { approveShift } from "@/lib/actions/shifts";
import { dec, formatPHP, formatPct, sum } from "@/lib/money";
import { piecesToSticks } from "@/lib/units";
import { formatBusinessDate, fromDateColumn } from "@/lib/businessDate";
import { CartLoad, type LoadRow } from "./cart-load";
import { ClosingGrid } from "./closing-grid";
import { EmptyShiftActions } from "./empty-shift-actions";
import { ReopenForm } from "./reopen-form";
import { SuppliesForm } from "./supplies-form";
import { IssueForm } from "./issue-form";
import { ActionButton } from "@/components/action-button";
import { PageHeader } from "@/components/data-table";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";

export default async function ShiftPage({
  params,
}: {
  params: Promise<{ shiftId: string }>;
}) {
  const { shiftId } = await params;
  const user = await requireUser();
  const db = scopedDb(user.companyId);

  const shift = await db.cartShift.findUnique({
    where: { id: shiftId },
    include: {
      issues: { include: { lines: true }, orderBy: { seq: "asc" } },
      lines: true,
      supplies: true,
    },
  });
  if (!shift) notFound();

  const [cart, vendor, products, closer, supplyItems, branchStock] = await Promise.all([
    db.cart.findUnique({ where: { id: shift.cartId }, include: { branch: true, location: true } }),
    db.employee.findUnique({ where: { id: shift.employeeId } }),
    db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    shift.closedById ? db.user.findUnique({ where: { id: shift.closedById } }) : null,
    // Sauce, cups, bags, sticks and oil — issued for traceability, never charged twice.
    db.ingredient.findMany({
      where: { isActive: true, category: { in: ["PACKAGING", "CONDIMENT", "OIL", "CONSUMABLE"] } },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    db.stockBalance.findMany({
      where: { itemType: "INGREDIENT", locationType: "BRANCH", locationId: shift.branchId },
    }),
  ]);

  const branchOnHand = new Map(branchStock.map((b) => [b.itemId, b.qty.toString()]));

  const productName = new Map(products.map((p) => [p.id, p.name]));

  // What has been issued so far, across the load-out and every refill.
  const issuedTotals = new Map<string, { qty: ReturnType<typeof dec>; pps: string; price: string; cost: string }>();
  for (const issue of shift.issues) {
    for (const line of issue.lines) {
      const current = issuedTotals.get(line.productId);
      issuedTotals.set(line.productId, {
        qty: (current?.qty ?? dec(0)).plus(line.qtyPieces.toString()),
        pps: line.piecesPerStick.toString(),
        price: line.pricePerStick.toString(),
        cost: line.unitCostPerPiece.toString(),
      });
    }
  }

  const supplyName = new Map(supplyItems.map((i) => [i.id, i.name]));
  const supplyUnit = new Map(supplyItems.map((i) => [i.id, i.baseUnit as string]));

  const canClose = can(user, "shift.close") && shift.status !== "APPROVED";
  const canApprove = can(user, "shift.approve") && shift.closedById !== user.id;
  const isClosed = shift.status !== "OPEN";

  const tone = shift.status === "APPROVED" || shift.status === "CLOSED" ? "success"
    : shift.status === "DISPUTED" ? "danger" : "warning";

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${cart?.code ?? "Cart"} — ${vendor ? `${vendor.firstName} ${vendor.lastName}` : "no vendor"}`}
        subtitle={`${formatBusinessDate(fromDateColumn(shift.businessDate))} · ${cart?.location?.name ?? "unassigned"} · ${cart?.branch.code ?? ""}`}
        action={<Link href="/shifts" className="text-sm font-medium text-brand-700 hover:underline">← Daily Close</Link>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={tone}>{shift.status.toLowerCase()}</Badge>
        {shift.issues.length > 0 ? (
          <span className="text-sm text-stone-500">
            {shift.issues.length} issuance{shift.issues.length === 1 ? "" : "s"}
            {shift.issues.filter((i) => i.isRefill).length > 0
              ? ` (${shift.issues.filter((i) => i.isRefill).length} refill)` : ""}
          </span>
        ) : null}
        {shift.vendorAcknowledged ? (
          <Badge tone="success">vendor acknowledged</Badge>
        ) : isClosed ? (
          <Badge tone="warning">not acknowledged</Badge>
        ) : null}
      </div>

      {isClosed ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card><CardBody>
            <p className="text-xs uppercase tracking-wide text-stone-500">Net sales</p>
            <p className="mt-1 font-mono text-lg font-medium">{formatPHP(shift.netSales)}</p>
          </CardBody></Card>
          <Card><CardBody>
            <p className="text-xs uppercase tracking-wide text-stone-500">Cash variance</p>
            <p className={`mt-1 font-mono text-lg font-medium ${shift.cashVariance.isNegative() ? "text-red-700" : ""}`}>
              {formatPHP(shift.cashVariance)}
            </p>
          </CardBody></Card>
          <Card><CardBody>
            <p className="text-xs uppercase tracking-wide text-stone-500">Gross profit</p>
            <p className="mt-1 font-mono text-lg font-medium">{formatPHP(shift.grossProfit)}</p>
          </CardBody></Card>
          <Card><CardBody>
            <p className="text-xs uppercase tracking-wide text-stone-500">Waste cost</p>
            <p className="mt-1 font-mono text-lg font-medium">{formatPHP(shift.wasteCost)}</p>
          </CardBody></Card>
        </div>
      ) : null}

      {shift.status === "OPEN" && can(user, "shift.open") ? (
        <Card>
          <CardHeader>
            <CardTitle>{shift.issues.length === 0 ? "Issue the load-out / Labas" : "Refill"}</CardTitle>
          </CardHeader>
          <CardBody>
            <IssueForm
              shiftId={shift.id}
              isRefill={shift.issues.length > 0}
              products={products.map((p) => ({
                id: p.id,
                name: p.name,
                piecesPerStick: p.piecesPerStick.toString(),
                alreadyIssued: (issuedTotals.get(p.id)?.qty ?? dec(0)).toFixed(0),
              }))}
            />

            <div className="mt-4">
              <SuppliesForm
                shiftId={shift.id}
                supplies={supplyItems.map((item) => ({
                  id: item.id,
                  name: item.name,
                  baseUnit: item.baseUnit,
                  onHand: branchOnHand.get(item.id) ?? "0",
                }))}
              />
            </div>

            {issuedTotals.size === 0 ? (
              <div className="mt-4">
                <EmptyShiftActions shiftId={shift.id} cartCode={cart?.code ?? "this cart"} />
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {shift.issues.length > 0 || shift.supplies.length > 0 ? (
        <CartLoad
          shiftId={shift.id}
          canCount={can(user, "shift.close") && shift.status !== "APPROVED"}
          rows={[
            ...[...issuedTotals.entries()].map<LoadRow>(([productId, data]) => {
              const closed = shift.lines.find((l) => l.productId === productId);
              return {
                id: productId,
                name: productName.get(productId) ?? productId,
                kind: "PRODUCT",
                unit: "PC",
                issued: data.qty.toFixed(0),
                returned: closed ? dec(closed.piecesReturned).toFixed(0) : null,
                wasted: closed ? dec(closed.piecesWasted).toFixed(0) : null,
                sold: closed ? dec(closed.piecesSold).toFixed(0) : null,
                consumed: null,
                unitCost: data.cost,
              };
            }),
            ...shift.supplies.map<LoadRow>((supply) => ({
              id: supply.ingredientId,
              name: supplyName.get(supply.ingredientId) ?? supply.ingredientId,
              kind: "SUPPLY",
              unit: supplyUnit.get(supply.ingredientId) ?? "PC",
              issued: dec(supply.qtyIssued).toFixed(0),
              returned: supply.qtyReturned === null ? null : dec(supply.qtyReturned).toFixed(0),
              wasted: null,
              sold: null,
              consumed: supply.qtyConsumed === null ? null : dec(supply.qtyConsumed).toFixed(0),
              unitCost: supply.unitCost.toString(),
            })),
          ]}
        />
      ) : null}

      {canClose && issuedTotals.size > 0 ? (
        <ClosingGrid
          /**
           * Remount whenever the issued quantities change. The grid keeps its counts in
           * local state, so without this a refill issued after the page rendered would
           * leave the supervisor counting against stale "issued" figures.
           */
          key={`${shift.issues.length}-${sum(
            shift.issues.flatMap((i) => i.lines.map((l) => l.qtyPieces)),
          ).toFixed(0)}`}
          shiftId={shift.id}
          vendorName={vendor ? `${vendor.firstName} ${vendor.lastName}` : "the vendor"}
          alreadyClosed={isClosed}
          existing={{
            cashRemitted: shift.cashRemitted.toString(),
            digitalSales: shift.digitalSales.toString(),
            notes: shift.notes ?? "",
          }}
          lines={[...issuedTotals.entries()].map(([productId, data]) => {
            const existing = shift.lines.find((l) => l.productId === productId);
            return {
              productId,
              name: productName.get(productId) ?? productId,
              piecesIssued: data.qty.toFixed(0),
              piecesPerStick: data.pps,
              pricePerStick: data.price,
              returned: existing ? dec(existing.piecesReturned).toFixed(0) : "0",
              wasted: existing ? dec(existing.piecesWasted).toFixed(0) : "0",
              reason: existing?.wasteReason ?? "",
            };
          })}
        />
      ) : null}

      {isClosed && shift.lines.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Counted back</CardTitle></CardHeader>
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-right">Issued</th>
                    <th className="px-3 py-2 text-right">Returned</th>
                    <th className="px-3 py-2 text-right">Wasted</th>
                    <th className="px-3 py-2 text-right">Sold</th>
                    <th className="px-3 py-2 text-right">Sticks</th>
                    <th className="px-3 py-2 text-right">Net sales</th>
                    <th className="px-3 py-2 text-right">Sell-through</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {shift.lines.map((line) => {
                    const sellThrough = dec(line.piecesIssued).isZero()
                      ? null
                      : dec(line.piecesSold).dividedBy(line.piecesIssued).times(100);
                    return (
                      <tr key={line.id}>
                        <td className="px-3 py-2 font-medium">{productName.get(line.productId)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{dec(line.piecesIssued).toFixed(0)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{dec(line.piecesReturned).toFixed(0)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {dec(line.piecesWasted).toFixed(0)}
                          {line.wasteReason ? <span className="ml-1 text-xs text-stone-500">({line.wasteReason})</span> : null}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-medium">{dec(line.piecesSold).toFixed(0)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{dec(line.sticksSold).toFixed(1)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPHP(line.netSales)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {sellThrough ? formatPct(sellThrough, 1) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-stone-200 font-medium">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{sum(shift.lines.map((l) => l.piecesIssued)).toFixed(0)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{sum(shift.lines.map((l) => l.piecesReturned)).toFixed(0)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{sum(shift.lines.map((l) => l.piecesWasted)).toFixed(0)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{sum(shift.lines.map((l) => l.piecesSold)).toFixed(0)}</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPHP(shift.netSales)}</td>
                    <td className="px-3 py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-4 space-y-1 border-t border-stone-100 pt-3 text-sm">
              <div className="flex justify-between"><span className="text-stone-500">Expected cash</span><span className="font-mono">{formatPHP(shift.expectedCash)}</span></div>
              <div className="flex justify-between"><span className="text-stone-500">Cash remitted</span><span className="font-mono">{formatPHP(shift.cashRemitted)}</span></div>
              <div className="flex justify-between font-medium">
                <span>Variance</span>
                <span className={`font-mono ${shift.cashVariance.isNegative() ? "text-red-700" : ""}`}>
                  {formatPHP(shift.cashVariance)}
                </span>
              </div>
              <div className="flex justify-between pt-2"><span className="text-stone-500">Cost of goods sold</span><span className="font-mono">{formatPHP(shift.cogs)}</span></div>
              <div className="flex justify-between font-medium"><span>Gross profit</span><span className="font-mono">{formatPHP(shift.grossProfit)}</span></div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {shift.status === "CLOSED" ? (
        <Card>
          <CardHeader><CardTitle>Approval</CardTitle></CardHeader>
          <CardBody className="space-y-2">
            <p className="text-sm text-stone-600">
              Closed by {closer?.name ?? "—"}. A shift can never be approved by the person who
              closed it — the same person recorded the counts that set the vendor&apos;s pay.
            </p>
            {canApprove ? (
              <ActionButton
                action={approveShift.bind(null, shift.id)}
                label="Approve shift"
                pendingLabel="Approving…"
                variant="primary"
              />
            ) : (
              <p className="rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-600">
                {can(user, "shift.approve")
                  ? "You closed this shift, so someone else must approve it."
                  : "Waiting on an area manager, owner or admin to approve."}
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {shift.status === "APPROVED" ? (
        <div className="space-y-3">
          <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Approved and locked. Corrections are recorded adjustments, never edits.
          </div>
          {can(user, "company.manage") ? <ReopenForm shiftId={shift.id} /> : null}
        </div>
      ) : null}
    </div>
  );
}
