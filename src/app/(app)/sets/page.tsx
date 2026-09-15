import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { removeSetComponent, saveSetComponent, saveSetDefinition } from "@/lib/actions/masterdata";
import { dec, divide, formatPHP, sum } from "@/lib/money";
import { sticksToPieces } from "@/lib/units";
import { PageHeader } from "@/components/data-table";
import { EntityForm, RemoveButton } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";
import { Badge, Checkbox, Field, NumberInput, Select, TextArea, TextInput } from "@/components/ui/field";

const MODE_EXPLAINER = {
  PER_COMPONENT:
    "Each product carries an equal share of the incentive and is credited on its own. Selling through four of five components earns 4/5 of the money.",
  ALL_COMPONENTS:
    "All-or-nothing: the weakest component decides. One product left unsold means no incentive at all.",
  PROPORTIONAL:
    "Pays the weakest component's ratio of the incentive — no cliff, but a vendor can earn without finishing a set.",
} as const;

export default async function SetsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "company.manage");

  const sets = await db.setDefinition.findMany({
    include: {
      components: {
        include: { product: { select: { id: true, name: true, piecesPerStick: true } } },
        orderBy: { product: { name: "asc" } },
      },
    },
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
  });

  const products = await db.product.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  const editing = params.edit ? sets.find((s) => s.id === params.edit) ?? null : null;
  const showForm = writable && (params.new === "1" || editing);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sets"
        subtitle="A set is the vendor's daily target: a fixed number of sticks of each product. It exists only to compute incentive."
        action={writable && !showForm ? <Link href="/sets?new=1"><Button>New set</Button></Link> : null}
      />

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>{editing ? `Edit ${editing.code}` : "New set"}</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={saveSetDefinition.bind(null, editing?.id ?? null)} returnTo="/sets">
              <Field label="Code" name="code" required hint="e.g. STD-SET">
                <TextInput id="code" name="code" defaultValue={editing?.code ?? ""} required autoCapitalize="characters" />
              </Field>
              <Field label="Name" name="name" required>
                <TextInput id="name" name="name" defaultValue={editing?.name ?? "Standard Cart Set"} required />
              </Field>
              <Field label="Incentive for a full set (₱)" name="incentiveAmount" required hint="Split equally across components under per-component counting.">
                <NumberInput id="incentiveAmount" name="incentiveAmount" defaultValue={editing?.incentiveAmount.toString() ?? "250"} required />
              </Field>
              <Field label="Counting mode" name="completionMode" required hint={MODE_EXPLAINER[editing?.completionMode ?? "PER_COMPONENT"]}>
                <Select id="completionMode" name="completionMode" defaultValue={editing?.completionMode ?? "PER_COMPONENT"}>
                  <option value="PER_COMPONENT">Per component (each product counts on its own)</option>
                  <option value="ALL_COMPONENTS">All components (weakest decides)</option>
                  <option value="PROPORTIONAL">Proportional (fraction of the weakest)</option>
                </Select>
              </Field>
              <Field
                label="Max credits per component"
                name="maxSetsPerComponent"
                hint="Blank = unlimited. Set to 1 to stop a vendor earning three credits from fishball alone."
              >
                <TextInput id="maxSetsPerComponent" name="maxSetsPerComponent" inputMode="numeric" defaultValue={editing?.maxSetsPerComponent?.toString() ?? ""} placeholder="unlimited" />
              </Field>
              <Field label="Effective from" name="effectiveFrom" required hint="Payroll before this date keeps the old set.">
                <TextInput id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={editing ? editing.effectiveFrom.toISOString().slice(0, 10) : today} required />
              </Field>
              <Field label="Notes" name="notes">
                <TextArea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
              </Field>
              <div className="flex items-end">
                <Checkbox label="Active" name="isActive" defaultChecked={editing?.isActive ?? true} />
              </div>
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      {sets.length === 0 ? (
        <EmptyState
          title="No sets defined yet"
          action="Create the standard set: 50 sticks each of kwek-kwek, calamares, squidball, fishball and kikiam."
        />
      ) : null}

      {sets.map((set) => {
        const totalSticks = sum(set.components.map((c) => c.requiredSticks));
        const totalPieces = sum(
          set.components.map((c) => sticksToPieces(c.requiredSticks, c.product.piecesPerStick)),
        );
        const share =
          set.components.length > 0
            ? divide(set.incentiveAmount, set.components.length)
            : null;

        return (
          <Card key={set.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>
                  {set.code} · {set.name}{" "}
                  {set.isActive ? <Badge tone="success">active</Badge> : <Badge tone="danger">inactive</Badge>}
                </CardTitle>
                {writable ? (
                  <Link href={`/sets?edit=${set.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                    Edit set
                  </Link>
                ) : null}
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-stone-500">Incentive</p>
                  <p className="font-mono text-base font-medium">{formatPHP(set.incentiveAmount)}</p>
                </div>
                <div>
                  <p className="text-stone-500">Per component</p>
                  <p className="font-mono text-base font-medium">{share ? formatPHP(share) : "—"}</p>
                </div>
                <div>
                  <p className="text-stone-500">Total sticks</p>
                  <p className="font-mono text-base font-medium">{totalSticks.toFixed(0)}</p>
                </div>
                <div>
                  <p className="text-stone-500">Total pieces</p>
                  <p className="font-mono text-base font-medium">{totalPieces.toFixed(0)}</p>
                </div>
              </div>

              <p className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600">
                {MODE_EXPLAINER[set.completionMode]}
                {set.maxSetsPerComponent
                  ? ` Capped at ${set.maxSetsPerComponent} credit${set.maxSetsPerComponent === 1 ? "" : "s"} per component.`
                  : " Components may stack credits without limit."}
              </p>

              {set.components.length === 0 ? (
                <EmptyState title="This set has no components" action="Add a product below to make it count for anything." />
              ) : (
                <div className="overflow-x-auto rounded-md border border-stone-200">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Product</th>
                        <th className="px-3 py-2 text-right">Required sticks</th>
                        <th className="px-3 py-2 text-right">Pcs / stick</th>
                        <th className="px-3 py-2 text-right">= Pieces</th>
                        <th className="px-3 py-2 text-right">Credit worth</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {set.components.map((component) => (
                        <tr key={component.id}>
                          <td className="px-3 py-2 font-medium">{component.product.name}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {component.requiredSticks.toFixed(0)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {component.product.piecesPerStick.toFixed(0)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {sticksToPieces(component.requiredSticks, component.product.piecesPerStick).toFixed(0)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {share ? formatPHP(share) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {writable ? (
                              <RemoveButton
                                label="Remove"
                                confirmText={`Remove ${component.product.name} from ${set.code}? Vendors stop earning credit for it.`}
                                action={removeSetComponent.bind(null, component.id)}
                              />
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {writable ? (
                <div className="rounded-md border border-stone-200 p-3">
                  <p className="mb-2 text-sm font-medium text-stone-700">Add or update a component</p>
                  <EntityForm action={saveSetComponent.bind(null, set.id)} returnTo="/sets" submitLabel="Save component">
                    <Field label="Product" name={`product-${set.id}`} required>
                      <Select id={`product-${set.id}`} name="productId" required defaultValue="">
                        <option value="">— select —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.piecesPerStick.toFixed(0)} pcs/stick)
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Required sticks" name={`sticks-${set.id}`} required hint="50 in the standard set.">
                      <NumberInput id={`sticks-${set.id}`} name="requiredSticks" defaultValue="50" required />
                    </Field>
                  </EntityForm>
                </div>
              ) : null}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
