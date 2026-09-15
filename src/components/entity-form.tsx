"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/helpers";

/**
 * Form shell for every master-data screen. Optimistic UI is banned here (spec §13):
 * the button stays disabled until the server has actually written the row.
 */
export function EntityForm({
  action, children, submitLabel = "Save", returnTo, compact = false,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel?: string;
  returnTo: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const outcome = await action(formData);
      setResult(outcome);
      if (outcome.ok) {
        router.push(returnTo);
        router.refresh();
      }
    });
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {result && !result.ok ? (
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">{result.error}</p>
          {fieldErrors ? (
            <ul className="mt-1 list-inside list-disc text-xs">
              {Object.entries(fieldErrors).map(([field, messages]) => (
                <li key={field}>
                  <span className="font-medium capitalize">
                    {field.replace(/([A-Z])/g, " $1").toLowerCase()}
                  </span>
                  : {messages.join(" ")}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className={compact ? "space-y-3" : "grid gap-4 sm:grid-cols-2"}>{children}</div>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(returnTo)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Archive / restore, with a confirmation because it changes what operators can pick. */
export function ArchiveButton({
  action, isActive, label,
}: {
  action: () => Promise<ActionResult>;
  isActive: boolean;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant={isActive ? "secondary" : "primary"}
      disabled={pending}
      onClick={() => {
        if (isActive && !confirm(`Archive ${label}? It stays on past reports but can no longer be selected.`)) return;
        startTransition(async () => {
          await action();
          router.refresh();
        });
      }}
    >
      {pending ? "…" : isActive ? "Archive" : "Restore"}
    </Button>
  );
}

/** Inline destructive action with a confirmation, for rows inside a card. */
export function RemoveButton({
  action, label, confirmText,
}: {
  action: () => Promise<ActionResult>;
  label: string;
  confirmText: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
      onClick={() => {
        if (!confirm(confirmText)) return;
        startTransition(async () => {
          await action();
          router.refresh();
        });
      }}
    >
      {pending ? "…" : label}
    </button>
  );
}

