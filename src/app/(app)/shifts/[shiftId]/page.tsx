import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { approveShift } from "@/lib/actions/shifts";
import { dec, formatPHP, formatPct, sum } from "@/lib/money";
import { piecesToSticks } from "@/lib/units";
import { formatBusinessDate, fromDateColumn } from "@/lib/businessDate";
import { ClosingGrid } from "./closing-grid";
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
    },
  });
  if (!shift) notFound();

  const [cart, vendor, products, closer] = await Promise.all([
    db.cart.findUnique({ where: { id: shift.cartId }, include: { branch: true, location: true } }),
    db.employee.findUnique({ where: { id: shift.employeeId } }),
    db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    shift.closedById ? db.user.findUnique({ where: { id: shift.closedById } }) : null,
  ]);

  const productName = new Map(products.map((p) => [p.id, p.name]));

  // What has been issued so far, across the load-out and every refill.
  const issuedTotals = new Map<string, { qty: ReturnType<typeof dec>; pps: string; price: string }>();
  for (const issue of shift.issues) {
    for (const line of issue.lines) {
      const current = issuedTotals.get(line.productId);
      issuedTotals.set(line.productId, {
        qty: (current?.qty ?? dec(0)).plus(line.qtyPieces.toString()),
        pps: line.piecesPerStick.toString(),
        price: line.pricePerStick.toString(),
      });
    }
  }

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
          </CardBody>
        </Card>
      ) : null}

      {shift.issues.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Issued so far</CardTitle></CardHeader>
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-right">Pieces</th>
                    <th className="px-3 py-2 text-right">Sticks</th>
                    <th className="px-3 py-2 text-right">Value at retail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {[...issuedTotals.entries()].map(([productId, data]) => (
                    <tr key={productId}>
                      <td className="px-3 py-2 font-medium">{productName.get(productId) ?? productId}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{data.qty.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {piecesToSticks(data.qty, data.pps).toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatPHP(piecesToSticks(data.qty, data.pps).times(data.price))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
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
        <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Approved and locked. Corrections now need a reversing adjustment, not an edit.
        </div>
      ) : null}
    </div>
  );
}
