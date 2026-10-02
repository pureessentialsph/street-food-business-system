"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reverseCashMovement } from "@/lib/actions/cash";
import { Button } from "@/components/ui/button";

/** Corrections are reversals, so this asks why and keeps the answer. */
export function ReverseButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-stone-500 hover:text-red-700 hover:underline"
      >
        reverse
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={`Why reverse ${label}?`}
        className="h-9 w-full min-w-[12rem] rounded-md border border-stone-300 px-2 text-xs"
      />
      {error ? <p role="alert" className="text-xs font-medium text-red-700">{error}</p> : null}
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={pending || reason.trim().length < 5}
          onClick={() =>
            startTransition(async () => {
              const result = await reverseCashMovement(id, reason);
              if (!result.ok) setError(result.error);
              else {
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          {pending ? "…" : "Reverse"}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
