"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => void signOut({ redirectTo: "/login" })}>
      Sign out
    </Button>
  );
}
