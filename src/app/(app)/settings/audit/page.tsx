import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader, SearchBar } from "@/components/data-table";
import { Card, CardBody } from "@/components/ui/card";
import { Badge, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/card";

/**
 * Audit review (spec §4). Every mutation writes a row; this is where someone can
 * actually read them — including who looked at whose 201 file.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; action?: string; q?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();

  if (!can(user, "company.manage") && user.role !== "ADMIN") {
    return (
      <div className="space-y-5">
        <PageHeader title="Audit log" subtitle="Who changed what, and when" />
        <EmptyState title="Restricted" action="The audit log is visible to the owner and admins." />
      </div>
    );
  }

  const db = scopedDb(user.companyId);
  const entries = await db.auditLog.findMany({
    where: {
      ...(params.entity ? { entity: params.entity } : {}),
      ...(params.action ? { action: params.action } : {}),
    },
    orderBy: { at: "desc" },
    take: 200,
  });

  const [users, entities] = await Promise.all([
    db.user.findMany({ select: { id: true, name: true, role: true } }),
    db.auditLog.findMany({ select: { entity: true }, distinct: ["entity"], orderBy: { entity: "asc" } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const tone = (action: string) =>
    action === "DELETE" ? "danger" : action === "CREATE" ? "success"
      : action === "ARCHIVE" ? "warning" : "neutral";

  const documentViews = entries.filter((e) => e.entity === "EmployeeDocumentAccess").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        subtitle="Every mutation, and every view of an employment record"
        action={<Link href="/settings" className="text-sm font-medium text-brand-700 hover:underline">← Settings</Link>}
      />

      {documentViews > 0 ? (
        <div className="rounded-md bg-stone-50 px-4 py-3 text-sm text-stone-600">
          {documentViews} view{documentViews === 1 ? "" : "s"} of employee 201 files appear below.
          Employment records are restricted, and looking at one is itself recorded.
        </div>
      ) : null}

      <SearchBar
        placeholder="Filter…"
        filters={
          <>
            <Select name="entity" defaultValue={params.entity ?? ""} className="w-52">
              <option value="">All records</option>
              {entities.map((e) => <option key={e.entity} value={e.entity}>{e.entity}</option>)}
            </Select>
            <Select name="action" defaultValue={params.action ?? ""} className="w-40">
              <option value="">All actions</option>
              <option value="CREATE">Create</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
              <option value="ARCHIVE">Archive</option>
            </Select>
          </>
        }
      />

      <Card>
        <CardBody>
          {entries.length === 0 ? (
            <EmptyState title="Nothing matches" action="Try a different record type or action." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">When</th>
                    <th className="px-3 py-2 text-left">Who</th>
                    <th className="px-3 py-2 text-left">Action</th>
                    <th className="px-3 py-2 text-left">Record</th>
                    <th className="px-3 py-2 text-left">What changed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {entries.map((entry) => {
                    const before = entry.before as Record<string, unknown> | null;
                    const after = entry.after as Record<string, unknown> | null;
                    const changed = before && after
                      ? Object.keys(after)
                          .filter((key) => !["updatedAt", "createdAt"].includes(key))
                          .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
                          .slice(0, 4)
                      : [];
                    return (
                      <tr key={entry.id}>
                        <td className="whitespace-nowrap px-3 py-2 text-stone-600">
                          {entry.at.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
                        </td>
                        <td className="px-3 py-2">{entry.userId ? userName.get(entry.userId) ?? "—" : "system"}</td>
                        <td className="px-3 py-2"><Badge tone={tone(entry.action)}>{entry.action.toLowerCase()}</Badge></td>
                        <td className="px-3 py-2 text-stone-700">
                          {entry.entity}
                          <span className="block text-xs text-stone-400">{entry.entityId.slice(0, 10)}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-500">
                          {entry.entity === "EmployeeDocumentAccess"
                            ? "opened an employee's 201 file"
                            : changed.length > 0
                              ? changed.map((key) => `${key}: ${String(before?.[key] ?? "—")} → ${String(after?.[key] ?? "—")}`).join("; ")
                              : entry.action === "CREATE" ? "created" : entry.action === "DELETE" ? "removed" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-stone-500">
            Showing the most recent 200 entries. The log is append-only — nothing here can be
            edited or removed from inside the app.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
