import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { addPoLine, cancelPurchaseOrder, markOrdered } from "@/lib/actions/procurement";
import { dec, formatPHP } from "@/lib/money";
import { ReceiveForm } from "./receive-form";
import { ActionButton } from "@/components/action-button";
import { PageHeader } from "@/components/data-table";
import { EntityForm } from "@/components/entity-form";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { Badge, Field, NumberInput, Select, TextInput } from "@/components/ui/field";

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ poNo: string }>;
}) {
  const { poNo } = await params;
  const user = await requireUser();
  const db = scopedDb(user.companyId);

  const po = await db.purchaseOrder.findUnique({ where: { poNo }, include: { lines: true } });
  if (!po) notFound();

  const [supplier, branch, ingredients] = await Promise.all([
    db.supplier.findUnique({ where: { id: po.supplierId } }),
    db.branch.findUnique({ where: { id: po.destinationBranchId } }),
    db.ingredient.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  const ingredientName = new Map(ingredients.map((i) => [i.id, i.name]));
  const canOrder = can(user, "procurement.approve");
  const canReceive = can(user, "inventory.write");

  const tone = po.status === "RECEIVED" ? "success" : po.status === "CANCELLED" ? "danger"
    : po.status === "ORDERED" || po.status === "PARTIALLY_RECEIVED" ? "warning" : "neutral";

  return (
    <div className="space-y-5">
      <PageHeader
        title={po.reference}
        subtitle={`${supplier?.name ?? "Supplier"} → ${branch?.code ?? ""} ${branch?.name ?? ""}${
          po.expectedAt ? ` · expected ${po.expectedAt.toISOString().slice(0, 10)}` : ""
        }`}
        action={<Link href="/procurement" className="text-sm font-medium text-brand-700 hover:underline">← Procurement</Link>}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={tone}>{po.status.replace("_", " ").toLowerCase()}</Badge>
        <span className="font-mono text-stone-700">{formatPHP(po.totalAmount)}</span>
        {po.orderedAt ? <span className="text-stone-500">Placed {po.orderedAt.toISOString().slice(0, 10)}</span> : null}
        {po.receivedAt ? <span className="text-stone-500">Received {po.receivedAt.toISOString().slice(0, 10)}</span> : null}
      </div>

      <Card>
        <CardHeader><CardTitle>Lines</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {po.lines.length === 0 ? (
            <EmptyState title="Nothing on this order" action="Add what you are buying below." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Ingredient</th>
                    <th className="px-3 py-2 text-right">Ordered</th>
                    <th className="px-3 py-2 text-left">Unit</th>
                    <th className="px-3 py-2 text-right">Price / unit</th>
                    <th className="px-3 py-2 text-right">Base units</th>
                    <th className="px-3 py-2 text-right">Received</th>
                    <th className="px-3 py-2 text-right">Line total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {po.lines.map((line) => {
                    const orderedBase = dec(line.qtyPurchaseUnit).times(line.baseUnitsPerPurchaseUnit);
                    const short = dec(line.qtyReceivedBase).greaterThan(0) && dec(line.qtyReceivedBase).lessThan(orderedBase);
                    return (
                      <tr key={line.id}>
                        <td className="px-3 py-2 font-medium">{ingredientName.get(line.ingredientId) ?? line.ingredientId}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{dec(line.qtyPurchaseUnit).toFixed(2)}</td>
                        <td className="px-3 py-2 text-stone-600">{line.purchaseUnitName}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPHP(line.unitPrice)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-500">{orderedBase.toFixed(0)}</td>
                        <td className={`px-3 py-2 text-right font-mono tabular-nums ${short ? "text-amber-700" : ""}`}>
                          {dec(line.qtyReceivedBase).toFixed(0)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {formatPHP(dec(line.qtyPurchaseUnit).times(line.unitPrice))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {canOrder && (po.status === "APPROVED" || po.status === "SUGGESTED") ? (
            <div className="rounded-md border border-stone-200 p-3">
              <p className="mb-2 text-sm font-medium text-stone-700">Add a line by hand</p>
              <EntityForm action={addPoLine.bind(null, poNo)} returnTo={`/procurement/${poNo}`} submitLabel="Add line">
                <Field label="Ingredient" name="ingredientId" required>
                  <Select id="ingredientId" name="ingredientId" required defaultValue="">
                    <option value="">— select —</option>
                    {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </Select>
                </Field>
                <Field label="Quantity" name="qtyPurchaseUnit" required hint="In the supplier's own unit.">
                  <NumberInput id="qtyPurchaseUnit" name="qtyPurchaseUnit" required placeholder="0" />
                </Field>
                <Field label="Unit name" name="purchaseUnitName" required hint="e.g. sack 25kg, tray 300pcs">
                  <TextInput id="purchaseUnitName" name="purchaseUnitName" required />
                </Field>
                <Field label="Base units per unit" name="baseUnitsPerPurchaseUnit" required hint="25,000 g in a 25 kg sack.">
                  <NumberInput id="baseUnitsPerPurchaseUnit" name="baseUnitsPerPurchaseUnit" required placeholder="1" />
                </Field>
                <Field label="Price per unit (₱)" name="unitPrice" required>
                  <NumberInput id="unitPrice" name="unitPrice" required placeholder="0.00" />
                </Field>
              </EntityForm>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            {canOrder && po.status === "APPROVED" && po.lines.length > 0 ? (
              <ActionButton action={markOrdered.bind(null, poNo)} label="Mark as placed" pendingLabel="…" variant="primary" />
            ) : null}
            {canOrder && (po.status === "APPROVED" || po.status === "ORDERED") ? (
              <ActionButton action={cancelPurchaseOrder.bind(null, poNo)} label="Cancel order" pendingLabel="…" />
            ) : null}
          </div>
        </CardBody>
      </Card>

      {canReceive && (po.status === "ORDERED" || po.status === "PARTIALLY_RECEIVED") && po.lines.length > 0 ? (
        <ReceiveForm
          poNo={poNo}
          reference={po.reference}
          lines={po.lines.map((line) => ({
            id: line.id,
            name: ingredientName.get(line.ingredientId) ?? line.ingredientId,
            qtyPurchaseUnit: dec(line.qtyPurchaseUnit).toFixed(2),
            purchaseUnitName: line.purchaseUnitName,
            unitPrice: line.unitPrice.toFixed(2),
            baseUnitsPerPurchaseUnit: dec(line.baseUnitsPerPurchaseUnit).toFixed(0),
          }))}
        />
      ) : null}

      {po.status === "RECEIVED" || po.status === "PARTIALLY_RECEIVED" ? (
        <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Stock is in. Ingredient costs were updated to what the supplier actually charged, and any
          product whose recipe uses those ingredients has a fresh cost version — see{" "}
          <Link href="/costing" className="font-medium underline">Costing</Link>.
        </div>
      ) : null}
    </div>
  );
}
