import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb, scopedDb } from "../db";

/**
 * The Phase 0 checkpoint: two seeded companies, and no path from one to the other.
 * Requires a database — run `pnpm db:push && pnpm db:seed` first.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("tenant isolation (live database)", () => {
  let primaryId = "";
  let secondaryId = "";
  let secondaryBranchId = "";

  beforeAll(async () => {
    const primary = await rawDb.company.findUnique({ where: { code: "SFS" } });
    const secondary = await rawDb.company.findUnique({ where: { code: "TENANT2" } });
    if (!primary || !secondary) {
      throw new Error("Seed first: pnpm db:push && pnpm db:seed");
    }
    primaryId = primary.id;
    secondaryId = secondary.id;

    const branch = await rawDb.branch.findFirst({ where: { companyId: secondaryId } });
    secondaryBranchId = branch?.id ?? "";
    expect(secondaryBranchId).not.toBe("");
  });

  afterAll(async () => {
    await rawDb.$disconnect();
  });

  it("returns only the caller's branches from an unfiltered findMany", async () => {
    const db = scopedDb(primaryId);
    const branches = await db.branch.findMany();
    expect(branches.length).toBeGreaterThan(0);
    expect(branches.every((b) => b.companyId === primaryId)).toBe(true);
  });

  it("returns zero rows — not an error — for another tenant's record by id", async () => {
    const db = scopedDb(primaryId);
    expect(await db.branch.findUnique({ where: { id: secondaryBranchId } })).toBeNull();
    expect(await db.branch.findFirst({ where: { id: secondaryBranchId } })).toBeNull();
    expect(await db.branch.count({ where: { id: secondaryBranchId } })).toBe(0);
  });

  it("cannot update or delete across tenants", async () => {
    const db = scopedDb(primaryId);
    const updated = await db.branch.updateMany({
      where: { id: secondaryBranchId },
      data: { name: "HIJACKED" },
    });
    expect(updated.count).toBe(0);

    const deleted = await db.branch.deleteMany({ where: { id: secondaryBranchId } });
    expect(deleted.count).toBe(0);

    const survivor = await rawDb.branch.findUnique({ where: { id: secondaryBranchId } });
    expect(survivor?.name).not.toBe("HIJACKED");
  });

  it("stamps companyId on created rows without being asked", async () => {
    const db = scopedDb(primaryId);
    const code = `TEST-${Date.now()}`;
    const created = await db.branch.create({ data: { code, name: "Scope test branch" } as never });
    expect(created.companyId).toBe(primaryId);
    await rawDb.branch.delete({ where: { id: created.id } });
  });

  it("blocks an explicit attempt to query another company", async () => {
    const db = scopedDb(primaryId);
    await expect(
      db.branch.findMany({ where: { companyId: secondaryId } }),
    ).rejects.toThrow(/Cross-tenant query blocked/);
  });

  it("keeps the same email usable by two operators", async () => {
    const primaryOwner = await rawDb.user.findFirst({
      where: { companyId: primaryId, role: "OWNER" },
    });
    expect(primaryOwner).not.toBeNull();

    const duplicates = await rawDb.user.findMany({ where: { email: primaryOwner!.email } });
    expect(duplicates.length).toBe(2);
    expect(new Set(duplicates.map((u) => u.companyId)).size).toBe(2);
  });

  it("lets the second operator see only its own single branch", async () => {
    const db = scopedDb(secondaryId);
    const branches = await db.branch.findMany();
    expect(branches).toHaveLength(1);
    expect(branches[0]?.companyId).toBe(secondaryId);
  });
});
