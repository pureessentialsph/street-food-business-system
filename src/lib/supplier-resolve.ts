import type { ScopedDb } from "@/lib/db";

/**
 * A supplier chosen from the list, or typed as a name. Shared by every form that
 * offers "add a new supplier" so they all behave the same way: an exact name match
 * reuses the existing supplier rather than creating a second one, and a genuinely new
 * name creates a stub for someone to complete on /suppliers later.
 */
export async function resolveSupplier(
  db: ScopedDb,
  supplierId: string | null,
  typedName: string | undefined | null,
): Promise<{ id: string | null; created: string | null }> {
  const name = typedName?.trim();
  if (!name) return { id: supplierId, created: null };

  const existing = await db.supplier.findFirst({ where: { name } });
  if (existing) return { id: existing.id, created: null };

  const created = await db.supplier.create({
    data: { companyId: db.$companyId, name, leadTimeDays: 1 },
  });
  return { id: created.id, created: created.name };
}
