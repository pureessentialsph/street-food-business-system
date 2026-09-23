"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { lockoutMinutes } from "@/lib/actions/login-status";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    // No optimistic UI anywhere near auth or money (spec §13): wait for the server.
    const result = await signIn("credentials", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      companyCode: String(form.get("companyCode") ?? ""),
      redirect: false,
    });

    if (result?.error) {
      /**
       * Distinguish "wrong password" from "too many tries" only after the attempt has
       * already failed, and only from the throttle bucket belonging to this address —
       * so the message never reveals whether the email exists.
       */
      const minutes = await lockoutMinutes(String(form.get("email") ?? ""));
      setPending(false);
      setError(
        minutes === null
          ? "Those credentials did not match an active account."
          : `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
      return;
    }
    setPending(false);
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-stone-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="h-11 w-full rounded-md border border-stone-300 px-3 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-stone-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-11 w-full rounded-md border border-stone-300 px-3 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <details className="text-sm text-stone-500">
            <summary className="cursor-pointer">Company code (only if asked)</summary>
            <input
              name="companyCode"
              type="text"
              autoCapitalize="characters"
              className="mt-2 h-11 w-full rounded-md border border-stone-300 px-3 uppercase focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </details>

          {error ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
