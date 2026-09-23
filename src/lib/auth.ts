import { redirect } from "next/navigation";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig, isSignedIn } from "./auth.config";
import { rawDb } from "./db";
import {
  addressFrom, checkLoginAllowed, clearLoginFailures, recordLoginFailure,
} from "./login-throttle";
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
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, companyCode } = parsed.data;

        /**
         * Throttle BEFORE anything expensive or revealing. Checking first means a
         * locked-out attacker cannot use this endpoint to make the server hash
         * passwords for them, and cannot learn whether an email exists by timing.
         */
        const address = addressFrom(request);
        const throttle = await checkLoginAllowed(email, address);
        if (throttle.lockedOut) return null;

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
        if (candidates.length !== 1) {
          await recordLoginFailure(email, address);
          return null;
        }
        const user = candidates[0]!;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          await recordLoginFailure(email, address);
          return null;
        }
        await clearLoginFailures(email, address);

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

/**
 * Use in every server component and server action. Sends the operator to the login
 * page rather than throwing: a session that has expired, or a token that decodes but
 * carries none of our fields, is an ordinary end-of-day event, not a crash. It used
 * to throw, which Next.js rendered as "a server-side exception has occurred" on every
 * page and as "Something went wrong. Nothing was saved." on every form.
 *
 * redirect() throws NEXT_REDIRECT, which toActionError re-throws so server actions
 * bounce to the login page too instead of swallowing it as a generic failure.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await loadSignedInUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * THE definition of a usable session. Every caller goes through this, the login page
 * included — when that page and this disagree about who is signed in, the two redirect
 * at each other until the browser gives up. That has now happened twice.
 *
 * Two things a token cannot tell us on its own, so both cost one indexed lookup:
 *  - the account may have been deactivated since sign-in;
 *  - the password may have been changed since sign-in, which has to invalidate every
 *    session issued before it. A JWT cannot be revoked — it is valid wherever it is
 *    held until it expires — so the account carries the stamp and we check against it.
 */
export async function loadSignedInUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!isSignedIn(user)) return null;

  const account = await rawDb.user.findUnique({
    where: { id: user.id },
    select: { isActive: true, passwordChangedAt: true },
  });
  if (!account?.isActive) return null;

  const predatesThePasswordChange =
    account.passwordChangedAt !== null &&
    (user.issuedAt === null || user.issuedAt * 1000 < account.passwordChangedAt.getTime());
  if (predatesThePasswordChange) return null;

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
