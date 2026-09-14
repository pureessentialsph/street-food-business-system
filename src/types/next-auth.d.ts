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
    userId: string;
    companyId: string;
    role: Role;
    employeeId: string | null;
    scopeBranchIds: string[];
  }
}
