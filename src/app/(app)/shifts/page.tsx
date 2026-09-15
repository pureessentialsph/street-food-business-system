import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can, seesAllBranches } from "@/lib/rbac";
import { businessDateFor, formatBusinessDate, toDateColumn } from "@/lib/businessDate";
import { dec, formatPHP, sum } from "@/lib/money";
import { OpenShiftButton } from "./open-shift-button";
import { PageHeader } from "@/components/data-table";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/field";

/**
 * The supervisor's home screen (spec §2): every cart for today in one list, so closing
 * eight carts is eight quick rows rather than eight page loads.
 */
export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const canOpen = can(user, "shift.open");

  const company = await db.company.findFirst({ where: { id: user.companyId } });
  const businessDate = params.date ?? businessDateFor(
    new Date(),
    company?.businessDayCutoffHour ?? 4,
    company?.timezone ?? "Asia/Manila",
  );
  const dateColumn = toDateColumn(businessDate);

  const branchFilter = seesAllBranches(user) ? {} : { branchId: { in: user.scopeBranchIds } };

  const [carts, shifts, employees] = await Promise.all([
    db.cart.findMany({
      where: { status: "ACTIVE", ...branchFilter },
      include: { branch: { select: { code: true } }, location: { select: { name: true } } },
      orderBy: { code: "asc" },
    }),
    db.cartShift.findMany({
      where: { businessDate: dateColumn, ...branchFilter },
      include: { lines: true, issues: { include: { lines: true } } },
    }),
    db.employee.findMany({ where: { isActive: true }, select: { id: true, firstName: true, lastName: true } }),
  ]);

  const vendorName = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
  const shiftByCart = new Map(shifts.map((s) => [s.cartId, s]));

  const closed = shifts.filter((s) => s.status === "CLOSED" || s.status === "APPROVED");
  const netSales = sum(closed.map((s) => s.netSales));
  const stillOpen = carts.filter((c) => shiftByCart.get(c.id)?.status === "OPEN").length;
  const notOpened = carts.filter((c) => !shiftByCart.has(c.id)).length;
  const disputed = shifts.filter((s) => s.status === "DISPUTED");

  const tone = (status?: string) =>
    status === "APPROVED" ? "success" : status === "CLOSED" ? "success"
      : status === "DISPUTED" ? "danger" : status === "OPEN" ? "warning" : "neutral";

  const label = (status?: string) =>
    status === "APPROVED" ? "approved" : status === "CLOSED" ? "closed"
      : status === "DISPUTED" ? "disputed" : status === "OPEN" ? "open" : "not opened";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Daily Close"
        subtitle={`${formatBusinessDate(businessDate)} · issue in the morning, count back at night`}
        action={
          canOpen ? (
            <Link
              href={`/shifts/issue?date=${businessDate}`}
              className="inline-flex h-11 items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
            >
              Batch issue
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Net sales today</p>
          <p className="mt-1 font-mono text-lg font-medium">{formatPHP(netSales)}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Still open</p>
          <p className={`mt-1 font-mono text-lg font-medium ${stillOpen ? "text-amber-700" : ""}`}>{stillOpen}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Not opened</p>
          <p className="mt-1 font-mono text-lg font-medium">{notOpened}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className="text-xs uppercase tracking-wide text-stone-500">Disputed</p>
          <p className={`mt-1 font-mono text-lg font-medium ${disputed.length ? "text-red-700" : ""}`}>{disputed.length}</p>
        </CardBody></Card>
      </div>

      {disputed.length > 0 ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-medium">
            {disputed.length} shift{disputed.length === 1 ? "" : "s"} disputed.
          </span>{" "}
          Cash is out by more than the threshold, so payroll is blocked until it is resolved.
        </div>
      ) : null}

      <div className="space-y-2">
        {carts.map((cart) => {
          const shift = shiftByCart.get(cart.id);
          const issuedPieces = shift
            ? sum(shift.issues.flatMap((i) => i.lines.map((l) => l.qtyPieces)))
            : dec(0);
          const refills = shift ? shift.issues.filter((i) => i.isRefill).length : 0;

          return (
            <Card key={cart.id}>
              <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-[180px]">
                  <p className="font-medium text-stone-900">
                    {cart.code} <span className="font-normal text-stone-500">· {cart.branch.code}</span>
                  </p>
                  <p className="text-xs text-stone-500">
                    {cart.location?.name ?? "unassigned"}
                    {shift ? ` · ${vendorName.get(shift.employeeId) ?? "—"}` : ""}
                  </p>
                </div>

                <div className="flex flex-1 flex-wrap items-center justify-end gap-4 text-sm">
                  {shift ? (
                    <>
                      <span className="font-mono tabular-nums text-stone-600">
                        {issuedPieces.toFixed(0)} pcs issued{refills ? ` · ${refills} refill${refills === 1 ? "" : "s"}` : ""}
                      </span>
                      {shift.status !== "OPEN" ? (
                        <span className="font-mono tabular-nums">
                          {formatPHP(shift.netSales)}
                          {!shift.cashVariance.isZero() ? (
                            <span className={shift.cashVariance.isNegative() ? " text-red-700" : " text-amber-700"}>
                              {" "}({shift.cashVariance.isNegative() ? "−" : "+"}{formatPHP(shift.cashVariance.abs())})
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      <Badge tone={tone(shift.status)}>{label(shift.status)}</Badge>
                      <Link
                        href={`/shifts/${shift.id}`}
                        className="inline-flex h-11 items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
                      >
                        {shift.status === "OPEN" ? "Close cart" : "View"}
                      </Link>
                    </>
                  ) : (
                    <>
                      <Badge>{label(undefined)}</Badge>
                      {canOpen ? (
                        <OpenShiftButton
                          cartId={cart.id}
                          cartCode={cart.code}
                          hasDefaultVendor={Boolean(cart.defaultVendorId)}
                          vendors={employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))}
                        />
                      ) : null}
                    </>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {carts.length === 0 ? (
        <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center">
          <p className="text-sm font-medium text-stone-700">No active carts in your scope</p>
          <p className="mt-1 text-sm text-stone-500">Add a cart, or ask an owner to put you on a branch.</p>
        </div>
      ) : null}
    </div>
  );
}
