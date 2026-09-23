import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      companyId: string;
      role: Role;
      employeeId: string | null;
      scopeBranchIds: string[];
      /** Unix seconds the token was minted; null if the claim is missing. */
      issuedAt: number | null;
    } & DefaultSession["user"];
  }

  interface User {
    companyId: string;
    role: Role;
    employeeId: string | null;
    scopeBranchIds: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** Unix seconds this session was authenticated. Survives token rotation. */
    authenticatedAt: number;
    userId: string;
    companyId: string;
    role: Role;
    employeeId: string | null;
    scopeBranchIds: string[];
  }
}
