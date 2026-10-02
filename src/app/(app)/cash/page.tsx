import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { recordCashMovement } from "@/lib/actions/cash";
import { cashPosition } from "@/lib/cash-service";
import { MANUAL_TYPES, TYPE_LABELS, signedAmount, type CashMovementType } from "@/lib/engines/cash-book";
import { businessDateFor, formatBusinessDate, fromDateColumn } from "@/lib/businessDate";
import { dec, formatPHP } from "@/lib/money";
import { StatTile } from "@/components/charts";
import { DataTable, PageHeader } from "@/components/data-table";
import { EntityForm } from "@/components/entity-form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Field, NumberInput, Select, TextInput } from "@/components/ui/field";
import { CashCountForm } from "./cash-count-form";
import { ReverseButton } from "./reverse-button";

/**
 * The cash book: what should be in the box, where it came from, and what the box
 * actually held when it was last counted.
 *
 * One box for the whole business. Carts do not hold a float overnight — they are issued
 * stock and hand the cash back the same night — so a balance per branch would be an
 * elaborate way of writing the same number in several places.
 */
export default async function CashPage() {
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const canManage = can(user, "cash.manage");

  const company = await db.company.findFirst({ where: { id: user.companyId } });
  const today = businessDateFor(
    new Date(),
    company?.businessDayCutoffHour ?? 4,
    company?.timezone ?? "Asia/Manila",
  );

  const [position, movements, counts] = await Promise.all([
    cashPosition(db),
    db.cashMovement.findMany({ orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }], take: 100 }),
    db.cashCountSession.findMany({ orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }], take: 10 }),
  ]);

  const totalFor = (type: CashMovementType) =>
    position.summary.byType.find((row) => row.type === type)?.amount ?? "0.00";
  const capital = dec(totalFor("CAPITAL"));
  const sales = dec(totalFor("SALES"));

  const reversedIds = new Set(movements.filter((m) => m.reversesId).map((m) => m.reversesId!));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cash"
        subtitle={`What should be in the box as of ${formatBusinessDate(today)}`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Cash on hand"
          value={formatPHP(position.balance)}
          note="what the book says should be there"
          tone={dec(position.balance).isNegative() ? "bad" : "neutral"}
        />
        <StatTile label="Capital put in" value={formatPHP(capital)} note="money you funded the business with" />
        <StatTile label="Sales remitted" value={formatPHP(sales)} note="cash handed in from shifts" />
        <StatTile
          label="Last count"
          value={position.lastCount ? formatPHP(position.lastCount.counted) : "—"}
          note={
            position.lastCount
              ? `${formatBusinessDate(position.lastCount.businessDate)} · ${
                  dec(position.lastCount.variance).isZero()
                    ? "matched the book"
                    : `${formatPHP(position.lastCount.variance)} against the book`
                }`
              : "the box has never been counted"
          }
          tone={
            position.lastCount && !dec(position.lastCount.variance).isZero() ? "warning" : "neutral"
          }
        />
      </div>

      {dec(position.balance).isNegative() ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-medium">The book says there is less than nothing in the box.</span>{" "}
          That usually means money went in that was never recorded — most often the capital you
          started with. Record it below and the balance will make sense again.
        </div>
      ) : null}

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Record money in or out</CardTitle></CardHeader>
            <CardBody>
              <p className="mb-3 text-sm text-stone-600">
                Capital you put in, money you take out for yourself, a supplier paid in cash, a
                trip to the bank. Sales, approved cash expenses and paid wages post themselves —
                you do not key those in here.
              </p>
              <EntityForm action={recordCashMovement} returnTo="/cash" submitLabel="Record" resetOnSuccess>
                <Field label="What kind" name="type">
                  <Select id="type" name="type" defaultValue="CAPITAL">
                    {MANUAL_TYPES.map((type) => (
                      <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount (₱)" name="amount">
                  <NumberInput id="amount" name="amount" step="0.01" min="0" />
                </Field>
                <Field label="Date" name="businessDate">
                  <TextInput id="businessDate" name="businessDate" type="date" defaultValue={today} />
                </Field>
                <Field
                  label="What was it"
                  name="note"
                  hint="A few words. This is what you will read back in a year."
                >
                  <TextInput id="note" name="note" placeholder="Opening capital for the cart" />
                </Field>
              </EntityForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Count the cash box</CardTitle></CardHeader>
            <CardBody>
              <p className="mb-3 text-sm text-stone-600">
                Count the notes and coins you are holding. The difference against the book appears
                as you type, before anything is saved.
              </p>
              <CashCountForm expected={position.balance} today={today} />
            </CardBody>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Where the money went</CardTitle></CardHeader>
        <CardBody>
          {position.summary.byType.length === 0 ? (
            <p className="text-sm text-stone-500">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {position.summary.byType.map((row) => (
                <li key={row.type} className="flex items-center justify-between py-2">
                  <span className="text-stone-700">
                    {row.label}{" "}
                    <span className="text-xs text-stone-400">
                      ({row.count} {row.count === 1 ? "entry" : "entries"})
                    </span>
                  </span>
                  <span
                    className={`font-mono tabular-nums ${dec(row.amount).isNegative() ? "text-red-700" : "text-emerald-700"}`}
                  >
                    {formatPHP(row.amount)}
                  </span>
                </li>
              ))}
              <li className="flex items-center justify-between py-2 font-medium">
                <span>Cash on hand</span>
                <span className="font-mono tabular-nums">{formatPHP(position.balance)}</span>
              </li>
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Every movement</CardTitle></CardHeader>
        <CardBody>
          <DataTable
            rows={movements.map((m) => ({ ...m, id: m.id }))}
            empty={{
              title: "No cash movements yet",
              action: "Record the capital you started with, and the rest follows from trading.",
            }}
            columns={[
              {
                header: "Date",
                cell: (m) => formatBusinessDate(fromDateColumn(m.businessDate)),
              },
              {
                header: "Kind",
                cell: (m) => (
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={signedAmount({ type: m.type as CashMovementType, amount: m.amount.toString() }).isNegative() ? "danger" : "success"}>
                      {TYPE_LABELS[m.type as CashMovementType]}
                    </Badge>
                    {m.refType ? <span className="text-xs text-stone-400">posted</span> : null}
                    {reversedIds.has(m.id) ? <span className="text-xs text-stone-400">reversed</span> : null}
                  </div>
                ),
              },
              { header: "What", cell: (m) => <span className="text-stone-700">{m.note}</span> },
              {
                header: "Amount",
                numeric: true,
                cell: (m) => {
                  const effect = signedAmount({ type: m.type as CashMovementType, amount: m.amount.toString() });
                  return (
                    <span className={`font-mono tabular-nums ${effect.isNegative() ? "text-red-700" : ""}`}>
                      {formatPHP(effect)}
                    </span>
                  );
                },
              },
              {
                header: "",
                numeric: true,
                cell: (m) =>
                  canManage && !m.refType && !m.reversesId && !reversedIds.has(m.id) ? (
                    <ReverseButton id={m.id} label={m.note} />
                  ) : null,
              },
            ]}
          />
        </CardBody>
      </Card>

      {counts.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Counts</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-stone-100 text-sm">
              {counts.map((count) => (
                <li key={count.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-stone-700">
                      {formatBusinessDate(fromDateColumn(count.businessDate))}
                    </span>
                    <span className="font-mono tabular-nums">
                      counted {formatPHP(count.counted)} · book {formatPHP(count.expected)} ·{" "}
                      <span className={dec(count.variance).isNegative() ? "text-red-700" : ""}>
                        {formatPHP(count.variance)}
                      </span>
                    </span>
                  </div>
                  {count.note ? <p className="mt-0.5 text-xs text-stone-500">{count.note}</p> : null}
                  {count.adjustmentId ? (
                    <p className="mt-0.5 text-xs text-stone-500">
                      The difference was written off, so the book was brought to this figure.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
