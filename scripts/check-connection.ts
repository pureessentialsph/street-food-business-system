/**
 * Verifies the runtime (pooled) connection, not just the migration one — they use
 * different ports and pooling modes and can fail independently.
 *
 *   set -a; . ./.env.production.local; set +a; pnpm exec tsx scripts/check-connection.ts
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const db = new PrismaClient();
  const host = (process.env.DATABASE_URL ?? "").split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`Runtime connection → ${host}`);

  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name`;
  console.log(`Tables (${tables.length}): ${tables.map((t) => t.table_name).join(", ")}`);
  console.log(`Companies: ${await db.company.count()}`);
  console.log(`Users: ${await db.user.count()}`);

  await db.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
