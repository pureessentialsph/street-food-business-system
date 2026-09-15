import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { addTransferLine, dispatchTransfer } from "@/lib/actions/inventory";
import { dec, formatPHP, sum } from "@/lib/money";
import { LOCATION_LABEL, locationNames } from "@/lib/inventory-labels";
import { PageHeader } from "@/components/data-table";
import { ActionButton } from "@/components/action-button";
import { EntityForm } from "@/components/entity-form";
import { ReceiveTransferForm } from "./receive-form";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { Badge, Field, NumberInput, Select } from "@/components/ui/field";

export default async function TransferDetailPage({
  params,
}: {
  params: Promise<{ transferId: string }>;
}) {
  const { transferId } = await params;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "inventory.write");

  const transfer = await db.stockTransfer.findUnique({
    where: { id: transferId },
    include: { lines: true },
  });
  if (!transfer) notFound();

  const [products, ingredients, names, balances] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.ingredient.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    locationNames(db as never),
    db.stockBalance.findMany({
      where: { locationType: transfer.fromLocationType, locationId: transfer.fromLocationId },
    }),
  ]);

  const itemName = new Map<string, string>([
    ...products.map((p) => [p.id, p.name] as const),
    ...ingredients.map((i) => [i.id, i.name] as const),
  ]);
  const available = new Map(balances.map((b) => [b.itemId, b.qty]));
  const totalValue = sum(transfer.lines.map((l) => dec(l.qtySent).times(l.unitCost)));

  const tone = transfer.status === "RECEIVED" ? "success" : transfer.status === "IN_TRANSIT" ? "warning" : "neutral";

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${transfer.reference}`}
        subtitle={`${names.get(transfer.fromLocationId) ?? "?"} (${LOCATION_LABEL[transfer.fromLocationType]}) → ${names.get(transfer.toLocationId) ?? "?"} (${LOCATION_LABEL[transfer.toLocationType]})`}
        action={<Link href="/inventory/transfers" className="text-sm font-medium text-brand-700 hover:underline">← All transfers</Link>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={tone}>{transfer.status.replace("_", " ").toLowerCase()}</Badge>
        <span className="text-sm text-stone-500">
          {transfer.lines.length} line{transfer.lines.length === 1 ? "" : "s"} · {formatPHP(totalValue)}
        </span>
        {transfer.dispatchedAt ? (
          <span className="text-sm text-stone-500">
            Dispatched {transfer.dispatchedAt.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
          </span>
        ) : null}
        {transfer.receivedAt ? (
          <span className="text-sm text-stone-500">
            Received {transfer.receivedAt.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
          </span>
        ) : null}
      </div>

      <Card>
        <CardHeader><CardTitle>Lines</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {transfer.lines.length === 0 ? (
            <EmptyState title="Nothing on this transfer yet" action="Add the items and quantities being moved." />
          ) : (
            <div className="overflow-x-auto rounded-md border border-stone-200">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-right">Sent</th>
                    <th className="px-3 py-2 text-right">Received</th>
                    <th className="px-3 py-2 text-right">Unit cost</th>
                    <th className="px-3 py-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {transfer.lines.map((line) => {
                    const short = line.qtyReceived !== null && dec(line.qtyReceived).lessThan(line.qtySent);
                    return (
                      <tr key={line.id}>
                        <td className="px-3 py-2 font-medium">{itemName.get(line.itemId) ?? line.itemId}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{dec(line.qtySent).toFixed(0)}</td>
                        <td className={`px-3 py-2 text-right font-mono tabular-nums ${short ? "text-red-700" : ""}`}>
                          {line.qtyReceived === null ? "—" : dec(line.qtyReceived).toFixed(0)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPHP(line.unitCost)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {formatPHP(dec(line.qtySent).times(line.unitCost))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {writable && transfer.status === "DRAFT" ? (
            <div className="rounded-md border border-stone-200 p-3">
              <p className="mb-2 text-sm font-medium text-stone-700">Add an item</p>
              <EntityForm
                action={addTransferLine.bind(null, transfer.id)}
                returnTo={`/inventory/transfers/${transfer.id}`}
                submitLabel="Add line"
              >
                <Field label="Item type" name="itemType" required>
                  <Select id="itemType" name="itemType" defaultValue="PRODUCT">
                    <option value="PRODUCT">Finished product</option>
                    <option value="INGREDIENT">Ingredient</option>
                  </Select>
                </Field>
                <Field label="Item" name="itemId" required hint="Quantities on hand at the source are shown in brackets.">
                  <Select id="itemId" name="itemId" required defaultValue="">
                    <option value="">— select —</option>
                    <optgroup label="Products">
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({dec(available.get(p.id) ?? 0).toFixed(0)} on hand)
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Ingredients">
                      {ingredients.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({dec(available.get(i.id) ?? 0).toFixed(0)} on hand)
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                </Field>
                <Field label="Quantity" name="qtySent" required>
                  <NumberInput id="qtySent" name="qtySent" required placeholder="0" />
                </Field>
              </EntityForm>
            </div>
          ) : null}

          {writable && transfer.status === "DRAFT" && transfer.lines.length > 0 ? (
            <div className="flex justify-end">
              <ActionButton
                action={dispatchTransfer.bind(null, transfer.id)}
                label="Dispatch"
                pendingLabel="Dispatching…"
                variant="primary"
              />
            </div>
          ) : null}

          {writable && transfer.status === "IN_TRANSIT" ? (
            <ReceiveTransferForm
              transferId={transfer.id}
              lines={transfer.lines.map((line) => ({
                id: line.id,
                name: itemName.get(line.itemId) ?? line.itemId,
                qtySent: dec(line.qtySent).toFixed(0),
              }))}
            />
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
