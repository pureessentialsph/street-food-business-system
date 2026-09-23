"use server";

import { headers } from "next/headers";
import { addressFrom, lockoutFor } from "@/lib/login-throttle";

/**
 * Why a sign-in just failed, for the login form's message.
 *
 * Unauthenticated by necessity, and safe to be: the account bucket is keyed on the
 * caller's own address, so this can only report a lock the caller themselves caused.
 * It never says whether the email exists.
 */
export async function lockoutMinutes(email: string): Promise<number | null> {
  try {
    const requestHeaders = await headers();
    const address = addressFrom(new Request("http://local", { headers: requestHeaders }));
    return await lockoutFor(email.trim().toLowerCase(), address);
  } catch {
    // The message is a courtesy; failing to produce it must not break signing in.
    return null;
  }
}
