/**
 * Rebuild every cached StockBalance from the append-only ledger.
 *
 *   pnpm rebuild:balances
 *
 * The ledger is the source of truth. If the cache ever disagrees, this is the fix —
 * and the fact that it can be rebuilt at all is what makes the cache safe to keep.
 */
import { rawDb, scopedDb } from "../src/lib/db";
import { rebuildBalances } from "../src/lib/inventory-service";

async function main() {
  const companies = await rawDb.company.findMany({ select: { id: true, code: true } });
  for (const company of companies) {
    const { rebuilt, drift } = await rebuildBalances(scopedDb(company.id));
    console.log(
      `${company.code}: ${rebuilt} balances rebuilt, ${drift} had drifted from the ledger.`,
    );
  }
  await rawDb.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
