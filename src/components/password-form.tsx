"use client";

import { useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import { changeOwnPassword } from "@/lib/actions/account";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import type { ActionResult } from "@/lib/actions/errors";

/**
 * Not EntityForm: this one ends the session rather than returning to a list, and it
 * clears what was typed whichever way it goes. Three password boxes left populated on a
 * shared back-office laptop is the sort of thing this screen exists to prevent.
 */
export function PasswordForm() {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const outcome = await changeOwnPassword(formData);
      setResult(outcome);
      form.reset();
      if (outcome.ok) setDone(true);
    });
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div role="status" className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-900">
          <p className="font-medium">{result?.ok ? result.message : "Password changed."}</p>
        </div>
        <Button type="button" onClick={() => void signOut({ redirectTo: "/login" })}>
          Sign in again
        </Button>
      </div>
    );
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-4">
      {result && !result.ok ? (
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          {result.error}
        </div>
      ) : null}

      <Field label="Current password" name="currentPassword" required error={fieldErrors?.currentPassword}>
        <TextInput
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <Field
        label="New password"
        name="newPassword"
        required
        error={fieldErrors?.newPassword}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short phrase you can remember beats a short password you cannot.`}
      >
        <TextInput
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
        />
      </Field>

      <Field label="New password again" name="confirmPassword" required>
        <TextInput
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
