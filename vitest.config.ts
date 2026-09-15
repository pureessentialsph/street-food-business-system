import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Load .env so the tenant-isolation tests find DATABASE_URL. They skip without one, so
// `pnpm test` still works on a machine with no database (CI provides its own Postgres).
try {
  process.loadEnvFile(".env");
} catch {
  // No .env — DB-backed tests will skip.
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    testTimeout: 30_000,
    // The database-backed suites share one dev database and assert on global state
    // (every cached balance equals its ledger sum). Running files in parallel makes
    // them see each other's half-written fixtures.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
