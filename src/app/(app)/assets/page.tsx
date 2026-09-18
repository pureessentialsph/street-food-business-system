import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can, seesAllBranches } from "@/lib/rbac";
import { assignAsset, deleteAsset, saveAsset } from "@/lib/actions/assets";
import { formatPHP, sum } from "@/lib/money";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { DeleteButton, EntityForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Field, NumberInput, Select, TextArea, TextInput } from "@/components/ui/field";
import { ComboSelect } from "@/components/combo-select";

const STATUS_LABELS = {
  IN_USE: "in use",
  IN_STORAGE: "in storage",
  IN_REPAIR: "in repair",
  RETIRED: "retired",
  LOST: "lost",
} as const;

const CONDITION_LABELS = {
  GOOD: "good",
  NEEDS_REPAIR: "needs repair",
  UNSERVICEABLE: "unserviceable",
} as const;

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; edit?: string; new?: string; move?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const writable = can(user, "masterdata.write");
  const deletable = can(user, "masterdata.delete");
  const q = params.q?.trim() ?? "";

  const branchFilter = seesAllBranches(user) ? {} : { branchId: { in: user.scopeBranchIds } };

  const [assets, branches, carts, employees, suppliers, categories] = await Promise.all([
    db.asset.findMany({
      where: {
        ...(params.status ? { status: params.status as never } : {}),
        ...(q
          ? {
              OR: [
                { tag: { contains: q, mode: "insensitive" as const } },
                { name: { contains: q, mode: "insensitive" as const } },
                { serialNo: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: "asc" }, { tag: "asc" }],
    }),
    db.branch.findMany({
      where: { isActive: true, ...(seesAllBranches(user) ? {} : { id: { in: user.scopeBranchIds } }) },
      orderBy: { code: "asc" },
    }),
    db.cart.findMany({ where: { ...branchFilter }, orderBy: { code: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { lastName: "asc" } }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.assetCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);

  /**
   * An asset whose category has since been dropped from the list still edits cleanly,
   * and the list never loses an option that something is actually using.
   */
  const categoryNames = Array.from(
    new Set([...categories.map((c) => c.name), ...assets.map((a) => a.category)]),
  ).sort();

  /** One lookup for every kind of holder, so a row can name where a thing actually is. */
  const holderName = new Map<string, string>();
  for (const b of branches) holderName.set(b.id, `${b.code} · ${b.name}`);
  for (const c of carts) holderName.set(c.id, `${c.code} · ${c.name}`);
  for (const e of employees) holderName.set(e.id, `${e.firstName} ${e.lastName}`);
  const whereIs = (a: { locationType: string | null; locationId: string | null }) =>
    a.locationId ? holderName.get(a.locationId) ?? "— unknown —" : "— unassigned —";

  const editing = params.edit ? assets.find((a) => a.id === params.edit) ?? null : null;
  const moving = params.move ? assets.find((a) => a.id === params.move) ?? null : null;
  const showForm = writable && (params.new === "1" || editing);
  const today = new Date().toISOString().slice(0, 10);

  const history = moving
    ? await db.assetAssignment.findMany({
        where: { assetId: moving.id },
        orderBy: { movedOn: "desc" },
        take: 10,
      })
    : [];

  const live = assets.filter((a) => a.status !== "RETIRED" && a.status !== "LOST");
  const bookValue = sum(live.map((a) => a.acquisitionCost));

  const statusTone = (s: string) =>
    s === "IN_USE" ? "success" : s === "LOST" || s === "RETIRED" ? "danger" : "warning";

  const locationFields = (
    defaults: { locationType: string | null; locationId: string | null },
    idPrefix: string,
  ) => (
    <>
      <Field label="Where is it" name={`${idPrefix}locationType`} hint="Leave blank if it is not assigned anywhere yet.">
        <Select id={`${idPrefix}locationType`} name="locationType" defaultValue={defaults.locationType ?? ""}>
          <option value="">— unassigned —</option>
          <option value="BRANCH">Branch / commissary</option>
          <option value="CART">Cart</option>
          <option value="EMPLOYEE">A person</option>
          <option value="WAREHOUSE">Warehouse</option>
        </Select>
      </Field>
      <Field label="Which one" name={`${idPrefix}locationId`}>
        <Select id={`${idPrefix}locationId`} name="locationId" defaultValue={defaults.locationId ?? ""}>
          <option value="">— none —</option>
          <optgroup label="Branches & warehouses">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </optgroup>
          <optgroup label="Carts">
            {carts.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </optgroup>
          <optgroup label="People">
            {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
          </optgroup>
        </Select>
      </Field>
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Assets"
        subtitle="Fryers, tanks, tongs, motor carts — the durable things a cart needs. Not stock: equipment is not consumed by selling, so it stays out of the inventory ledger."
        action={writable && !showForm ? <Link href="/assets?new=1"><Button>New asset</Button></Link> : null}
      />

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>{editing ? `Edit ${editing.tag}` : "New asset"}</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={saveAsset.bind(null, editing?.id ?? null)} returnTo="/assets">
              <Field label="Tag" name="tag" required hint="Stickered on the thing itself, e.g. AST-0012">
                <TextInput id="tag" name="tag" defaultValue={editing?.tag ?? ""} required autoCapitalize="characters" />
              </Field>
              <Field label="What is it" name="name" required>
                <TextInput id="name" name="name" defaultValue={editing?.name ?? ""} required placeholder="e.g. Deep fryer, twin basket" />
              </Field>
              <Field
                label="Category"
                name="category"
                required
                hint="Pick one, or add a new one — it is saved and offered next time."
              >
                <ComboSelect
                  name="category"
                  newName="category"
                  required
                  options={categoryNames.map((c) => ({ value: c, label: c }))}
                  defaultValue={editing?.category ?? ""}
                  placeholder="e.g. Refrigeration"
                  addLabel="+ Add a new category"
                />
              </Field>
              <Field label="Serial number" name="serialNo" hint="If it has one. Helps when two look identical.">
                <TextInput id="serialNo" name="serialNo" defaultValue={editing?.serialNo ?? ""} />
              </Field>
              <Field label="Acquired on" name="acquiredOn" required>
                <TextInput id="acquiredOn" name="acquiredOn" type="date" defaultValue={editing ? editing.acquiredOn.toISOString().slice(0, 10) : today} required />
              </Field>
              <Field label="What it cost (₱)" name="acquisitionCost" required hint="What you paid for it, not what it is worth now.">
                <NumberInput id="acquisitionCost" name="acquisitionCost" defaultValue={editing?.acquisitionCost.toString() ?? ""} required />
              </Field>
              <Field
                label="Bought from"
                name="supplierId"
                hint="Type a new name and the supplier is created — add their contact and lead time later."
              >
                <ComboSelect
                  name="supplierId"
                  newName="supplierName"
                  options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                  defaultValue={editing?.supplierId ?? ""}
                  emptyLabel="— not recorded —"
                  placeholder="e.g. Quiapo Restaurant Supply"
                  addLabel="+ Add a new supplier"
                />
              </Field>
              <Field label="Condition" name="condition" required>
                <Select id="condition" name="condition" defaultValue={editing?.condition ?? "GOOD"}>
                  {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Status" name="status" required>
                <Select id="status" name="status" defaultValue={editing?.status ?? "IN_USE"}>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </Field>
              {locationFields(editing ?? { locationType: null, locationId: null }, "")}
              <Field label="Notes" name="notes">
                <TextArea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
              </Field>
            </EntityForm>
          </CardBody>
        </Card>
      ) : null}

      {moving ? (
        <Card>
          <CardHeader><CardTitle>Move {moving.tag} — {moving.name}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-stone-600">
              Currently at <span className="font-medium text-stone-900">{whereIs(moving)}</span>.
            </p>
            <EntityForm action={assignAsset.bind(null, moving.id)} returnTo="/assets" submitLabel="Record the move">
              {locationFields({ locationType: moving.locationType, locationId: moving.locationId }, "move-")}
              <Field label="Moved on" name="movedOn" required>
                <TextInput id="movedOn" name="movedOn" type="date" defaultValue={today} required />
              </Field>
              <Field label="Why" name="reason" hint="e.g. replacing the burnt-out fryer on CART-003">
                <TextInput id="reason" name="reason" />
              </Field>
            </EntityForm>

            {history.length ? (
              <div>
                <p className="mb-2 text-sm font-medium text-stone-700">Where it has been</p>
                <ul className="space-y-1 text-sm text-stone-600">
                  {history.map((move) => (
                    <li key={move.id}>
                      <span className="font-mono text-xs text-stone-500">
                        {move.movedOn.toISOString().slice(0, 10)}
                      </span>{" "}
                      {move.fromLocationId ? holderName.get(move.fromLocationId) ?? "elsewhere" : "unassigned"}
                      {" → "}
                      <span className="font-medium text-stone-900">
                        {move.toLocationId ? holderName.get(move.toLocationId) ?? "elsewhere" : "unassigned"}
                      </span>
                      {move.reason ? <span className="text-stone-500"> · {move.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <Card><CardBody>
          <p className="text-stone-500">Assets in service</p>
          <p className="font-mono text-base font-medium">{live.length}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-stone-500">What they cost</p>
          <p className="font-mono text-base font-medium">{formatPHP(bookValue)}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-stone-500">Needing attention</p>
          <p className="font-mono text-base font-medium">
            {assets.filter((a) => a.condition !== "GOOD" || a.status === "IN_REPAIR").length}
          </p>
        </CardBody></Card>
      </div>

      <SearchBar
        placeholder="Search tag, name or serial…"
        defaultValue={q}
        filters={
          <Select name="status" defaultValue={params.status ?? ""} className="w-44">
            <option value="">Any status</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        }
      />

      <DataTable
        rows={assets}
        empty={{
          title: q ? `No asset matches “${q}”` : "No assets yet",
          action: "Add the things a cart cannot trade without: the fryer, the LPG tank, the tongs, the cart itself.",
        }}
        columns={[
          { header: "Tag", cell: (a) => a.tag },
          { header: "What it is", cell: (a) => a.name },
          { header: "Category", cell: (a) => a.category },
          { header: "Where", cell: (a) => whereIs(a) },
          { header: "Cost", numeric: true, cell: (a) => formatPHP(a.acquisitionCost) },
          {
            header: "Condition",
            cell: (a) =>
              a.condition === "GOOD"
                ? <span className="text-stone-500">good</span>
                : <Badge tone={a.condition === "UNSERVICEABLE" ? "danger" : "warning"}>{CONDITION_LABELS[a.condition]}</Badge>,
          },
          { header: "Status", cell: (a) => <Badge tone={statusTone(a.status)}>{STATUS_LABELS[a.status]}</Badge> },
          {
            header: "",
            cell: (a) =>
              writable ? (
                <div className="flex items-center justify-end gap-2">
                  <Link href={`/assets?move=${a.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                    Move
                  </Link>
                  <Link href={`/assets?edit=${a.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                    Edit
                  </Link>
                  {deletable ? (
                    <DeleteButton kind="asset" label={a.tag} action={deleteAsset.bind(null, a.id)} />
                  ) : null}
                </div>
              ) : null,
          },
        ]}
      />
    </div>
  );
}
