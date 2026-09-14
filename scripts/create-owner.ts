/**
 * Create or update an OWNER login, prompting for the password so it never appears in
 * chat, in a command line, or in shell history.
 *
 *   set -a; . ./.env.production.local; set +a
 *   pnpm owner:create
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createInterface, type Interface } from "node:readline";

const MIN_PASSWORD_LENGTH = 12;

function ask(rl: Interface, prompt: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    if (hidden) {
      const target = rl as unknown as { _writeToOutput?: (s: string) => void };
      const original = target._writeToOutput?.bind(rl);
      target._writeToOutput = (chunk: string) => {
        if (!original) return;
        original(chunk.includes(prompt) ? chunk : "*");
      };
      rl.question(prompt, (answer) => {
        target._writeToOutput = original;
        process.stdout.write("\n");
        resolve(answer);
      });
      return;
    }
    rl.question(prompt, resolve);
  });
}

async function main() {
  const db = new PrismaClient();
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  const companyCode = (process.env.COMPANY_CODE ?? "SFS").toUpperCase();
  const company = await db.company.findUnique({ where: { code: companyCode } });
  if (!company) {
    console.error(`No company with code ${companyCode}. Run \`pnpm db:seed\` first.`);
    process.exit(1);
  }

  console.log(`Company: ${company.name} (${company.code})`);
  const email = (await ask(rl, "Owner email: ")).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("That is not a valid email address.");
    process.exit(1);
  }
  const name = (await ask(rl, "Full name [Business Owner]: ")).trim() || "Business Owner";

  const password = await ask(rl, "Password (hidden): ", true);
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  const confirm = await ask(rl, "Confirm password: ", true);
  if (password !== confirm) {
    console.error("Passwords do not match.");
    process.exit(1);
  }
  rl.close();

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.user.upsert({
    where: { companyId_email: { companyId: company.id, email } },
    update: { passwordHash, name, role: "OWNER", isActive: true },
    create: { companyId: company.id, email, name, role: "OWNER", passwordHash },
  });

  console.log(`\nOwner ready: ${user.email} (${user.id}) for ${company.code}.`);
  console.log("Sign in at /login. The password was never written to disk or history.");
  await db.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
