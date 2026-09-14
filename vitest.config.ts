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
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
