import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { rawDb } from "./db";
import type { SessionUser } from "./rbac";

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
  // Only needed once a second operator exists with the same email (spec §15.1).
  companyCode: z.string().trim().optional(),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        companyCode: { label: "Company code", type: "text" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, companyCode } = parsed.data;

        const candidates = await rawDb.user.findMany({
          where: {
            email,
            isActive: true,
            company: {
              isActive: true,
              ...(companyCode ? { code: companyCode.toUpperCase() } : {}),
            },
          },
          include: { scopes: { select: { branchId: true } } },
        });

        // Email is unique per company, so an ambiguous login must name its company.
        if (candidates.length !== 1) return null;
        const user = candidates[0]!;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        await rawDb.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        const sessionUser: SessionUser = {
          id: user.id,
          companyId: user.companyId,
          email: user.email,
          name: user.name,
          role: user.role,
          employeeId: user.employeeId,
          scopeBranchIds: user.scopes.map((s) => s.branchId),
        };
        return sessionUser as unknown as never;
      },
    }),
  ],
});

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

/** Use in every server component and server action. Throws if not signed in. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.companyId) throw new Error("Not authenticated");
  return {
    id: user.id,
    companyId: user.companyId,
    email: user.email ?? "",
    name: user.name ?? "",
    role: user.role,
    employeeId: user.employeeId ?? null,
    scopeBranchIds: user.scopeBranchIds ?? [],
  };
}
