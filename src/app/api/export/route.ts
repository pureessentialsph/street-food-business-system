import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can, seesAllBranches } from "@/lib/rbac";
import { buildPnl, type PnlScope } from "@/lib/pnl-service";
import { dec } from "@/lib/money";

/**
 * CSV export (spec §12 Phase 9). Plain CSV rather than xlsx so it opens in anything,
 * including the spreadsheet the owner already uses.
 */

function csv(rows: (string | number | null)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell === null ? "" : String(cell);
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(","),
    )
    .join("\r\n");
}

export async function GET(request: Request) {
  const user = await requireUser();
  if (!can(user, "reports.read")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "pnl";
  const db = scopedDb(user.companyId);

  const to = new Date(`${url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const from = new Date(
    `${url.searchParams.get("from") ?? new Date(to.getTime() - 29 * 86400000).toISOString().slice(0, 10)}T00:00:00.000Z`,
  );

  if (kind === "shifts") {
    const shifts = await db.cartShift.findMany({
      where: {
        businessDate: { gte: from, lte: to },
        ...(seesAllBranches(user) ? {} : { branchId: { in: user.scopeBranchIds } }),
      },
      orderBy: { businessDate: "asc" },
    });
    const carts = await db.cart.findMany({ select: { id: true, code: true } });
    const employees = await db.employee.findMany({ select: { id: true, firstName: true, lastName: true } });
    const cartCode = new Map(carts.map((c) => [c.id, c.code]));
    const vendor = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));

    const body = csv([
      ["Business date", "Cart", "Vendor", "Status", "Net sales", "COGS", "Gross profit",
        "Waste cost", "Expected cash", "Cash remitted", "Cash variance", "Acknowledged"],
      ...shifts.map((s) => [
        s.businessDate.toISOString().slice(0, 10),
        cartCode.get(s.cartId) ?? "",
        vendor.get(s.employeeId) ?? "",
        s.status,
        s.netSales.toFixed(2),
        s.cogs.toFixed(2),
        s.grossProfit.toFixed(2),
        s.wasteCost.toFixed(2),
        s.expectedCash.toFixed(2),
        s.cashRemitted.toFixed(2),
        s.cashVariance.toFixed(2),
        s.vendorAcknowledged ? "yes" : "no",
      ]),
    ]);

    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="shifts-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const level = (url.searchParams.get("level") ?? "COMPANY").toUpperCase();
  const id = url.searchParams.get("id");
  const scope: PnlScope =
    level === "BRANCH" && id ? { level: "BRANCH", id }
      : level === "CART" && id ? { level: "CART", id }
        : { level: "COMPANY" };

  const report = await buildPnl(db, from, to, scope, {
    allocateOverhead: url.searchParams.get("overhead") === "1",
  });

  const body = csv([
    ["Street Food Business System — profit and loss"],
    [`Period`, from.toISOString().slice(0, 10), "to", to.toISOString().slice(0, 10)],
    [],
    ["Name", "Net sales", "COGS", "Gross profit", "Vendor pay", "Wastage",
      "Expenses", "Overhead", "Operating profit", "Net profit", "Margin %"],
    ...report.rows.map((r) => [
      r.name, r.netSales, r.cogs, r.grossProfit, r.labourCost, r.wasteCost,
      r.directExpenses, r.allocatedOverhead, r.operatingProfit, r.netProfit, r.marginPct ?? "",
    ]),
    [],
    ["TOTAL",
      report.totals.netSales.toFixed(2),
      report.totals.cogs.toFixed(2),
      report.totals.grossProfit.toFixed(2),
      report.totals.labourCost.toFixed(2),
      report.totals.wasteCost.toFixed(2),
      report.totals.directExpenses.toFixed(2),
      report.overheadTotal,
      report.totals.operatingProfit.toFixed(2),
      report.totals.netProfit.toFixed(2),
      report.totals.operatingMarginPct ? report.totals.operatingMarginPct.toFixed(1) : "",
    ],
    [],
    ["Shifts included", report.shiftCount],
    ["Shifts held back (open or disputed)", report.heldShifts],
    ["Note", "Wastage sits below gross profit so product margins stay comparable across carts."],
  ]);

  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="pnl-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
