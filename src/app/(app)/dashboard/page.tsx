import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { businessDateFor, formatBusinessDate } from "@/lib/businessDate";
import { navFor, ROLE_LABELS, seesAllBranches } from "@/lib/rbac";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/card";

export default async function DashboardPage() {
  const user = await requireUser();
  const db = scopedDb(user.companyId);

  const company = await db.company.findFirst({ where: { id: user.companyId } });
  const branches = await db.branch.findMany({
    where: seesAllBranches(user) ? {} : { id: { in: user.scopeBranchIds } },
    orderBy: { code: "asc" },
  });

  const businessDate = businessDateFor(
    new Date(),
    company?.businessDayCutoffHour ?? 4,
    company?.timezone ?? "Asia/Manila",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">
          {ROLE_LABELS[user.role]} dashboard
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {company?.name} · business date {formatBusinessDate(businessDate)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Your access</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1 text-sm text-stone-600">
            <p>
              Role: <span className="font-medium text-stone-900">{ROLE_LABELS[user.role]}</span>
            </p>
            <p>
              Branches:{" "}
              <span className="font-medium text-stone-900">
                {seesAllBranches(user) ? "All (company-wide)" : `${branches.length} in scope`}
              </span>
            </p>
            <p>
              Menu items:{" "}
              <span className="font-medium text-stone-900">{navFor(user).length}</span>
            </p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Branches you can see</CardTitle>
          </CardHeader>
          <CardBody>
            {branches.length === 0 ? (
              <EmptyState
                title="No branches in your scope yet"
                action="An owner or admin assigns you to a branch in Settings → Users."
              />
            ) : (
              <ul className="divide-y divide-stone-100 text-sm">
                {branches.map((branch) => (
                  <li key={branch.id} className="flex items-center justify-between py-2">
                    <span className="font-medium text-stone-900">
                      {branch.code} · {branch.name}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-stone-500">
                      {branch.type}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phase 0 — foundation</CardTitle>
        </CardHeader>
        <CardBody>
          <EmptyState
            title="Sales, shifts, costing and payroll arrive in later phases"
            action="Next: Phase 1 master data — branches, carts, products with pieces-per-stick, and the standard set."
          />
        </CardBody>
      </Card>
    </div>
  );
}
