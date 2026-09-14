/**
 * Local Postgres for development and tests — no Docker, no Homebrew.
 *
 * Production runs on Supabase; this exists so `pnpm test` can prove tenant isolation
 * against a real Postgres on a laptop, and so a new developer can run the app with one
 * command. Data lives in .pgdata/ (gitignored).
 *
 *   pnpm db:local start   # boot, then print the DATABASE_URL to use
 *   pnpm db:local stop
 */
import EmbeddedPostgres from "embedded-postgres";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const DATA_DIR = resolve(process.cwd(), ".pgdata");
const PORT = Number(process.env.LOCAL_DB_PORT ?? 54329);
const USER = "postgres";
const PASSWORD = "postgres";
const DATABASE = "sfs";

export const LOCAL_DATABASE_URL = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`;

async function main() {
  const command = process.argv[2] ?? "start";
  mkdirSync(DATA_DIR, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    createPostgresUser: false,
  });

  if (command === "stop") {
    await pg.stop();
    console.log("Local Postgres stopped.");
    return;
  }

  try {
    await pg.initialise();
  } catch {
    // Already initialised — normal on every run after the first.
  }

  await pg.start();
  try {
    await pg.createDatabase(DATABASE);
  } catch {
    // Already exists.
  }

  console.log(`Local Postgres up on port ${PORT}.`);
  console.log(`DATABASE_URL="${LOCAL_DATABASE_URL}"`);
  console.log(`DIRECT_URL="${LOCAL_DATABASE_URL}"`);
  if (command === "start") {
    console.log("Leave this process running, or use `pnpm db:local:detach`.");
    await new Promise(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
