import { requireUser } from "@/lib/auth";
import { scopedDb } from "@/lib/db";
import { navFor, ROLE_LABELS } from "@/lib/rbac";
import { Sidebar } from "./sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = scopedDb(user.companyId);
  const company = await db.company.findFirst({ where: { id: user.companyId } });

  return (
    <div className="min-h-screen">
      <Sidebar
        nav={navFor(user)}
        userName={user.name}
        roleLabel={ROLE_LABELS[user.role]}
        companyName={company?.name ?? ""}
      />
      <div className="lg:pl-60">
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
