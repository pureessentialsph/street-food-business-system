/**
 * Idempotent seed (spec §3 rule 6): running it twice leaves the same state.
 *
 * Seeds TWO companies on purpose. The second one exists so the tenant-isolation test
 * has something real to fail against — it is the proof that selling this system to a
 * second cart operator will not leak the first one's data (spec §15.1).
 */
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

/**
 * Fixtures — demo staff logins and the second company — carry known passwords. They are
 * indispensable in development and a gift to an attacker in production, so they ship
 * only when explicitly asked for.
 */
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const WANT_FIXTURES = process.env.SEED_FIXTURES === "true" || !IS_PRODUCTION;

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL;
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD;

type SeedUser = {
  email: string;
  name: string;
  role: Role;
  password: string;
  branchCodes: string[];
};

async function seedCompany(input: {
  code: string;
  name: string;
  branches: { code: string; name: string; type: "BRANCH" | "COMMISSARY" | "WAREHOUSE" }[];
  users: SeedUser[];
}) {
  const company = await db.company.upsert({
    where: { code: input.code },
    update: { name: input.name },
    create: { code: input.code, name: input.name },
  });

  for (const branch of input.branches) {
    await db.branch.upsert({
      where: { companyId_code: { companyId: company.id, code: branch.code } },
      update: { name: branch.name, type: branch.type },
      create: { companyId: company.id, code: branch.code, name: branch.name, type: branch.type },
    });
  }

  for (const user of input.users) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    const row = await db.user.upsert({
      where: { companyId_email: { companyId: company.id, email: user.email } },
      update: { name: user.name, role: user.role, passwordHash, isActive: true },
      create: {
        companyId: company.id,
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash,
      },
    });

    for (const code of user.branchCodes) {
      const branch = await db.branch.findUnique({
        where: { companyId_code: { companyId: company.id, code } },
      });
      if (!branch) continue;
      await db.userBranchScope.upsert({
        where: { userId_branchId: { userId: row.id, branchId: branch.id } },
        update: {},
        create: { companyId: company.id, userId: row.id, branchId: branch.id },
      });
    }
  }

  return company;
}

async function main() {
  // Never create a login from environment variables in production. A stray .env on a
  // developer's laptop is enough to put a known password on the live database — which is
  // exactly what happened once. Production owners come from `pnpm owner:create`, which
  // prompts for the password and writes it nowhere.
  const owner: SeedUser[] =
    !IS_PRODUCTION && OWNER_EMAIL && OWNER_PASSWORD
      ? [
          {
            email: OWNER_EMAIL,
            name: "Business Owner",
            role: "OWNER",
            password: OWNER_PASSWORD,
            branchCodes: [],
          },
        ]
      : [];

  const demoStaff: SeedUser[] = !WANT_FIXTURES
    ? []
    : [
      {
        email: "supervisor1@streetfood.local",
        name: "Branch 1 Supervisor",
        role: "SUPERVISOR",
        password: "ChangeMe123!",
        branchCodes: ["BR-01"],
      },
      {
        email: "supervisor2@streetfood.local",
        name: "Branch 2 Supervisor",
        role: "SUPERVISOR",
        password: "ChangeMe123!",
        branchCodes: ["BR-02"],
      },
      {
        email: "areamanager@streetfood.local",
        name: "Area Manager",
        role: "AREA_MANAGER",
        password: "ChangeMe123!",
        branchCodes: ["BR-01", "BR-02"],
      },
      {
        email: "commissary@streetfood.local",
        name: "Commissary Lead",
        role: "COMMISSARY",
        password: "ChangeMe123!",
        branchCodes: ["CMY-01"],
      },
      {
        email: "hr@streetfood.local",
        name: "HR Officer",
        role: "HR",
        password: "ChangeMe123!",
        branchCodes: [],
      },
    ];

  const primary = await seedCompany({
    code: "SFS",
    name: "Street Food Business",
    branches: [
      { code: "CMY-01", name: "Main Commissary", type: "COMMISSARY" },
      { code: "BR-01", name: "Branch 1 — University Belt", type: "BRANCH" },
      { code: "BR-02", name: "Branch 2 — Industrial Park", type: "BRANCH" },
    ],
    users: [...owner, ...demoStaff],
  });

  // Tenant-isolation fixture. Deliberately reuses the primary owner's email, which is
  // why User.email is unique per company and not globally.
  //
  // NEVER seeded in production: a live deployment must not carry a second company with a
  // known password. Set SEED_FIXTURES=true (CI and local dev do) to include it.
  if (!WANT_FIXTURES) {
    const ownerNote = owner.length
      ? `Owner ${OWNER_EMAIL} created.`
      : "No owner created — run `pnpm owner:create` to add one without a password in your shell history.";
    console.log(`Seeded ${primary.code} (${primary.id}). Fixtures skipped. ${ownerNote}`);
    return;
  }

  // Mirrors the primary owner's email on purpose: proving one email can belong to two
  // operators is the point of the fixture.
  const sharedEmail = OWNER_EMAIL ?? "owner@streetfood.local";

  const secondary = await seedCompany({
    code: "TENANT2",
    name: "Second Operator (isolation fixture)",
    branches: [{ code: "BR-01", name: "Other Operator Branch 1", type: "BRANCH" }],
    users: [
      {
        email: sharedEmail,
        name: "Other Operator Owner",
        role: "OWNER",
        password: "OtherOperator123!",
        branchCodes: ["BR-01"],
      },
    ],
  });

  console.log(`Seeded ${primary.code} (${primary.id}) and ${secondary.code} (${secondary.id}).`);
  console.log(`Sign in as ${OWNER_EMAIL ?? "supervisor1@streetfood.local"} with company code SFS.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
