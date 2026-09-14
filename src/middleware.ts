import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Edge-safe: authConfig carries no Prisma or bcrypt import.
export const { auth: middleware } = NextAuth(authConfig);
export default middleware;

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"],
};
