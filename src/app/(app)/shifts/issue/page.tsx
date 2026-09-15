import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can, seesAllBranches } from "@/lib/rbac";
import { businessDateFor, formatBusinessDate, toDateColumn } from "@/lib/businessDate";
import { dec } from "@/lib/money";
import { BatchIssueBoard } from "./batch-issue-board";
import { PageHeader } from "@/components/data-table";
import { EmptyState } from "@/components/ui/card";

/**
 * Morning load-out for every cart at once (spec §2). The supervisor does this standing
 * at the branch with carts leaving, so defaults matter more than flexibility.
 */
export default async function BatchIssuePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  if (!can(user, "shift.open")) {
    return <EmptyState title="You cannot issue stock" action="Ask a supervisor or owner to do the load-out." />;
  }

  const company = await db.company.findFirst({ where: { id: user.companyId } });
  const businessDate = params.date ?? businessDateFor(
    new Date(), company?.businessDayCutoffHour ?? 4, company?.timezone ?? "Asia/Manila",
  );
  const dateColumn = toDateColumn(businessDate);
  const branchFilter = seesAllBranches(user) ? {} : { branchId: { in: user.scopeBranchIds } };

  const [carts, shifts, products, history] = await Promise.all([
    db.cart.findMany({
      where: { status: "ACTIVE", ...branchFilter },
      include: { branch: { select: { code: true } }, location: { select: { name: true } } },
      orderBy: { code: "asc" },
    }),
    db.cartShift.findMany({
      where: { businessDate: dateColumn, ...branchFilter },
      include: { issues: { include: { lines: true } } },
    }),
    // Every sellable product, not only the five in the set — carts also carry drinks,
    // fries and anything else priced.
    db.product.findMany({
      where: { isActive: true },
      include: { setComponents: { select: { id: true } } },
      orderBy: { name: "asc" },
    }),
    // What each cart issued over its last 7 closed days, for the "same as usual" default.
    db.cartShift.findMany({
      where: { status: { in: ["CLOSED", "APPROVED"] }, ...branchFilter },
      include: { issues: { include: { lines: true } } },
      orderBy: { businessDate: "desc" },
      take: 80,
    }),
  ]);

  // Average pieces per product per cart across its recent days.
  const usual = new Map<string, Map<string, number>>();
  const daysSeen = new Map<string, Set<string>>();
  for (const shift of history) {
    const perCart = usual.get(shift.cartId) ?? new Map<string, number>();
    const days = daysSeen.get(shift.cartId) ?? new Set<string>();
    if (days.size >= 7 && !days.has(shift.businessDate.toISOString())) continue;
    days.add(shift.businessDate.toISOString());
    for (const issue of shift.issues) {
      for (const line of issue.lines) {
        perCart.set(line.productId, (perCart.get(line.productId) ?? 0) + Number(line.qtyPieces));
      }
    }
    usual.set(shift.cartId, perCart);
    daysSeen.set(shift.cartId, days);
  }

  const shiftByCart = new Map(shifts.map((s) => [s.cartId, s]));

  const rows = carts.map((cart) => {
    const shift = shiftByCart.get(cart.id);
    const days = daysSeen.get(cart.id)?.size ?? 0;
    const averages = new Map<string, string>();
    if (days > 0) {
      for (const [productId, total] of usual.get(cart.id) ?? []) {
        averages.set(productId, String(Math.round(total / days)));
      }
    }
    return {
      cartId: cart.id,
      code: cart.code,
      branch: cart.branch.code,
      location: cart.location?.name ?? "unassigned",
      shiftId: shift?.id ?? null,
      status: shift?.status ?? null,
      hasVendor: Boolean(cart.defaultVendorId),
      alreadyIssued: shift
        ? dec(
            shift.issues.flatMap((i) => i.lines).reduce((acc, l) => acc + Number(l.qtyPieces), 0),
          ).toFixed(0)
        : "0",
      defaults: Object.fromEntries(averages),
    };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Batch issue / Labas"
        subtitle={`${formatBusinessDate(businessDate)} · load out every cart in one pass`}
        action={<Link href="/shifts" className="text-sm font-medium text-brand-700 hover:underline">← Daily Close</Link>}
      />

      {products.length === 0 ? (
        <EmptyState
          title="No products to issue"
          action="Add some products first — carts can only be loaded with what exists."
        />
      ) : (
        <BatchIssueBoard
          carts={rows}
          products={products.map((p) => ({
            id: p.id,
            name: p.name,
            piecesPerStick: p.piecesPerStick.toString(),
            inSet: p.setComponents.length > 0,
          }))}
        />
      )}
    </div>
  );
}
