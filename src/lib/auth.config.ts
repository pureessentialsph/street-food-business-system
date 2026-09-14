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
      const signedIn = Boolean(auth?.user);
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
