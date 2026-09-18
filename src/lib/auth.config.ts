import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the auth setup: no Prisma, no bcrypt. Middleware imports this one
 * so the login gate can run at the edge; src/lib/auth.ts adds the credentials provider.
 */
/**
 * The single definition of "signed in", shared by everything that asks.
 *
 * There are three such places — the middleware gate, requireUser() on every page and
 * action, and the login page deciding whether to bounce someone to the dashboard — and
 * they MUST agree. When the gate and requireUser() disagreed, a half-valid token got
 * waved through and died on the page with a 500. When the login page and the gate
 * disagreed, the same token sent the browser round /login -> /dashboard -> /login until
 * it gave up with ERR_TOO_MANY_REDIRECTS. A session token can decode cleanly and still
 * carry none of our fields, and Auth.js hands back a user object either way, so the
 * object existing proves nothing: only the fields the app actually needs do.
 */
export function isSignedIn<T extends { id?: string | null; companyId?: string | null }>(
  user: T | null | undefined,
): user is T & { id: string; companyId: string } {
  return Boolean(user?.id && user.companyId);
}

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (pathname === "/login") return true;
      return isSignedIn(auth?.user);
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
