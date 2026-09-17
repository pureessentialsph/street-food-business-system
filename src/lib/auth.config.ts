import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the auth setup: no Prisma, no bcrypt. Middleware imports this one
 * so the login gate can run at the edge; src/lib/auth.ts adds the credentials provider.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      /**
       * Must agree with requireUser() on what "signed in" means. A session token can
       * decode cleanly and still carry none of our fields — Auth.js hands back a user
       * object either way — and when that happened the gate waved the request through
       * and every page died on requireUser() with a raw 500 instead of asking the
       * operator to sign in again. Check the fields the app actually needs.
       */
      const sessionUser = auth?.user;
      const signedIn = Boolean(sessionUser?.id && sessionUser.companyId);
      const { pathname } = request.nextUrl;
      if (pathname === "/login") return true;
      return signedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.companyId = (user as { companyId: string }).companyId;
        token.role = (user as { role: string }).role;
        token.name = user.name ?? null;
        token.employeeId = (user as { employeeId: string | null }).employeeId ?? null;
        token.scopeBranchIds = (user as { scopeBranchIds: string[] }).scopeBranchIds ?? [];
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        ...session.user,
        id: (token.userId as string) ?? "",
        companyId: (token.companyId as string) ?? "",
        role: (token.role as never) ?? "VENDOR",
        employeeId: (token.employeeId as string | null) ?? null,
        scopeBranchIds: (token.scopeBranchIds as string[]) ?? [],
      };
      return session;
    },
  },
} satisfies NextAuthConfig;
