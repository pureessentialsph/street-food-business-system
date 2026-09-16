import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can, seesAllBranches } from "@/lib/rbac";
import {
  deleteExpense, postDueRecurringExpenses, saveExpense,
  saveExpenseCategory, saveRecurringExpense, setExpenseStatus,
} from "@/lib/actions/expenses";
import { dec, formatPHP, sum } from "@/lib/money";
import { DataTable, PageHeader, SearchBar } from "@/components/data-table";
import { ActionButton } from "@/components/action-button";
import { EntityForm, RemoveButton } from "@/components/entity-form";
import { StatusButtons } from "./status-buttons";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Checkbox, Field, NumberInput, Select, TextInput } from "@/components/ui/field";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; category?: string; recurring?: string; status?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const canWrite = can(user, "expense.write");
  const canApprove = can(user, "expense.approve");

  // Branches in scope, plus their carts — the ids a scoped user may see spending for.
  const scopedCarts = seesAllBranches(user)
    ? []
    : await db.cart.findMany({
        where: { branchId: { in: user.scopeBranchIds } },
        select: { id: true },
      });
  const visibleScopeIds = [...user.scopeBranchIds, ...scopedCarts.map((c) => c.id)];

  const [categories, expenses, branches, carts, recurring] = await Promise.all([
    db.expenseCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.expense.findMany({
      where: {
        ...(params.status ? { status: params.status as "DRAFT" | "APPROVED" | "REJECTED" } : {}),
        // A supervisor sees their own branches' spending, not the company's books.
        ...(seesAllBranches(user)
          ? {}
          : { scopeType: { not: "COMPANY" }, scopeId: { in: visibleScopeIds } }),
      },
      include: { category: true },
      orderBy: { businessDate: "desc" },
      take: 100,
    }),
    db.branch.findMany({
      where: { isActive: true, ...(seesAllBranches(user) ? {} : { id: { in: user.scopeBranchIds } }) },
      orderBy: { code: "asc" },
    }),
    db.cart.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } }),
    db.recurringExpense.findMany({ include: { category: true }, orderBy: { nextRunDate: "asc" } }),
  ]);

  const scopeName = new Map<string, string>([
    ...branches.map((b) => [b.id, `${b.code} · ${b.name}`] as const),
    ...carts.map((c) => [c.id, `${c.code} · ${c.name}`] as const),
  ]);

  const pending = expenses.filter((e) => e.status === "DRAFT");
  const approvedTotal = sum(expenses.filter((e) => e.status === "APPROVED").map((e) => e.amount));
  const today = new Date().toISOString().slice(0, 10);
  const dueCount = recurring.filter((r) => r.isActive && r.nextRunDate <= new Date()).length;

  const showForm = canWrite && params.new === "1";
  const showCategory = canWrite && params.category === "1";
  const showRecurring = canWrite && params.recurring === "1";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenses"
        subtitle="Everything between gross profit and what you actually keep. Only approved expenses reach the P&L."
        action={
          canWrite && !showForm && !showCategory && !showRecurring ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/expenses?category=1"><Button variant="secondary">Categories</Button></Link>
              <Link href="/expenses?recurring=1"><Button variant="secondary">Recurring</Button></Link>
              <Link href="/expenses?new=1"><Button>Record expense</Button></Link>
            </div>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Approved, in the P&L</p>
          <p className="mt-1 font-mono text-lg font-medium">{formatPHP(approvedTotal)}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Waiting for approval</p>
          <p className={`mt-1 font-mono text-lg font-medium ${pending.length ? "text-amber-700" : ""}`}>{pending.length}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Recurring due</p>
          <p className="mt-1 font-mono text-lg font-medium">{dueCount}</p>
        </CardBody></Card>
      </div>

      {dueCount > 0 && canWrite ? (
        <div className="flex items-center justify-between rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            <span className="font-medium">{dueCount} recurring expense{dueCount === 1 ? "" : "s"} due.</span>{" "}
            Rent and permits should not wait on someone remembering.
          </span>
          <ActionButton action={postDueRecurringExpenses} label="Post them" pendingLabel="Posting…" />
        </div>
      ) : null}

      {showCategory ? (
        <Card>
          <CardHeader><CardTitle>New expense category</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={saveExpenseCategory.bind(null, null)} returnTo="/expenses">
              <Field label="Name" name="name" required hint="e.g. LPG, Rent, Transport, Cart repair">
                <TextInput id="name" name="name" required />
              </Field>
              <Field label="Kind" name="kind" required hint="Operating costs hit profit; capital spend does not.">
                <Select id="kind" name="kind" defaultValue="OPEX">
                  <option value="OPEX">Operating expense</option>
                  <option value="COGS">Cost of goods</option>
                  <option value="CAPEX">Capital spend</option>
                </Select>
              </Field>
              <Field label="Sort order" name="sortOrder">
                <TextInput id="sortOrder" name="sortOrder" inputMode="numeric" defaultValue="0" />
              </Field>
              <div className="flex items-end gap-4">
                <Checkbox label="Company overhead" name="isOverhead" />
                <Checkbox label="Active" name="isActive" defaultChecked />
              </div>
            </EntityForm>
            <div className="mt-4 flex flex-wrap gap-2">
              {categories.map((category) => (
                <Badge key={category.id} tone={category.kind === "OPEX" ? "neutral" : category.kind === "COGS" ? "warning" : "success"}>
                  {category.name} · {category.kind.toLowerCase()}
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {showRecurring ? (
        <Card>
          <CardHeader><CardTitle>Recurring expense</CardTitle></CardHeader>
          <CardBody>
            <EntityForm action={saveRecurringExpense} returnTo="/expenses" submitLabel="Schedule">
              <Field label="Category" name="categoryId" required>
                <Select id="categoryId" name="categoryId" required defaultValue="">
                  <option value="">— select —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Applies to" name="scopeType" required>
                <Select id="scopeType" name="scopeType" defaultValue="BRANCH">
                  <option value="COMPANY">Whole company</option>
                  <option value="BRANCH">One branch</option>
                  <option value="CART">One cart</option>
                </Select>
              </Field>
              <Field label="Which one" name="scopeId" hint="Leave blank for company-wide.">
                <Select id="scopeId" name="scopeId" defaultValue="">
                  <option value="">— company-wide —</option>
                  <optgroup label="Branches">
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                  </optgroup>
                  <optgroup label="Carts">
                    {carts.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                  </optgroup>
                </Select>
              </Field>
              <Field label="Amount (₱)" name="amount" required>
                <NumberInput id="amount" name="amount" required placeholder="0.00" />
              </Field>
              <Field label="Frequency" name="frequency" required>
                <Select id="frequency" name="frequency" defaultValue="MONTHLY">
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                </Select>
              </Field>
              <Field label="Next due" name="nextRunDate" required>
                <TextInput id="nextRunDate" name="nextRunDate" type="date" defaultValue={today} required />
              </Field>
              <Field label="Description" name="description" required>
                <TextInput id="description" name="description" required placeholder="e.g. Stall rent — Morayta" />
              </Field>
            </EntityForm>

            {recurring.length > 0 ? (
              <ul className="mt-4 divide-y divide-stone-100 text-sm">
                {recurring.map((item) => (
                  <li key={item.id} className="flex items-center justify-between py-2">
                    <span>
                      <span className="font-medium text-stone-900">{item.description}</span>
                      <span className="block text-xs text-stone-500">
                        {item.category.name} · {item.frequency.toLowerCase()} · next {item.nextRunDate.toISOString().slice(0, 10)}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums">{formatPHP(item.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>Record an expense</CardTitle></CardHeader>
          <CardBody>
            {categories.length === 0 ? (
              <p className="text-sm text-stone-600">
                Create a category first —{" "}
                <Link href="/expenses?category=1" className="font-medium text-brand-700 underline">add one</Link>.
              </p>
            ) : (
              <EntityForm action={saveExpense.bind(null, null)} returnTo="/expenses">
                <Field label="Date" name="businessDate" required>
                  <TextInput id="businessDate" name="businessDate" type="date" defaultValue={today} required />
                </Field>
                <Field label="Category" name="categoryId" required>
                  <Select id="categoryId" name="categoryId" required defaultValue="">
                    <option value="">— select —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind.toLowerCase()})</option>)}
                  </Select>
                </Field>
                <Field label="Applies to" name="scopeType" required hint="Cart-level costs make a cart's true profit visible.">
                  <Select id="scopeType" name="scopeType" defaultValue="BRANCH">
                    <option value="COMPANY">Whole company (overhead)</option>
                    <option value="BRANCH">One branch</option>
                    <option value="CART">One cart</option>
                  </Select>
                </Field>
                <Field label="Which one" name="scopeId">
                  <Select id="scopeId" name="scopeId" defaultValue="">
                    <option value="">— company-wide —</option>
                    <optgroup label="Branches">
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                    </optgroup>
                    <optgroup label="Carts">
                      {carts.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                    </optgroup>
                  </Select>
                </Field>
                <Field label="Amount (₱)" name="amount" required>
                  <NumberInput id="amount" name="amount" required placeholder="0.00" />
                </Field>
                <Field label="Paid by" name="paymentMethod" required>
                  <Select id="paymentMethod" name="paymentMethod" defaultValue="CASH">
                    <option value="CASH">Cash</option>
                    <option value="GCASH">GCash</option>
                    <option value="BANK">Bank transfer</option>
                    <option value="CREDIT">On credit</option>
                  </Select>
                </Field>
                <Field label="What was it for" name="description" required>
                  <TextInput id="description" name="description" required placeholder="e.g. LPG refill for Morayta carts" />
                </Field>
                <Field label="Receipt reference" name="attachmentKey" hint="Receipt number or where the paper copy is filed. File upload arrives in Phase 9.">
                  <TextInput id="attachmentKey" name="attachmentKey" placeholder="e.g. OR-4471" />
                </Field>
              </EntityForm>
            )}
          </CardBody>
        </Card>
      ) : null}

      <SearchBar
        placeholder="Filter by status…"
        filters={
          <Select name="status" defaultValue={params.status ?? ""} className="w-44">
            <option value="">All statuses</option>
            <option value="DRAFT">Waiting approval</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </Select>
        }
      />

      <DataTable
        rows={expenses}
        empty={{
          title: "No expenses recorded",
          action: "Record your LPG, rent, transport and repairs — without them the P&L only shows gross profit.",
        }}
        columns={[
          { header: "Date", cell: (e) => e.businessDate.toISOString().slice(0, 10) },
          { header: "Category", cell: (e) => e.category.name },
          {
            header: "Applies to",
            cell: (e) => (e.scopeType === "COMPANY" ? "Company" : scopeName.get(e.scopeId ?? "") ?? "—"),
          },
          { header: "Description", cell: (e) => e.description },
          { header: "Paid by", cell: (e) => e.paymentMethod.toLowerCase() },
          { header: "Amount", numeric: true, cell: (e) => formatPHP(e.amount) },
          {
            header: "Status",
            cell: (e) => (
              <Badge tone={e.status === "APPROVED" ? "success" : e.status === "REJECTED" ? "danger" : "warning"}>
                {e.status === "DRAFT" ? "waiting" : e.status.toLowerCase()}
              </Badge>
            ),
          },
          {
            header: "",
            cell: (e) => (
              <div className="flex items-center justify-end gap-2">
                {canApprove && e.status === "DRAFT" ? <StatusButtons expenseId={e.id} /> : null}
                {canWrite && e.status !== "APPROVED" ? (
                  <RemoveButton
                    label="Delete"
                    confirmText={`Delete this ${formatPHP(e.amount)} expense?`}
                    action={deleteExpense.bind(null, e.id)}
                  />
                ) : null}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
