"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/helpers";

/** A button that runs a server action and reports what it did. No optimistic UI. */
export function ActionButton({
  action, label, pendingLabel = "Working…", variant = "secondary",
}: {
  action: () => Promise<ActionResult>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="text-right">
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await action();
            setMessage(result.ok ? result.message ?? "Done." : result.error);
            router.refresh();
          })
        }
      >
        {pending ? pendingLabel : label}
      </Button>
      {message ? <p className="mt-1 max-w-xs text-xs text-stone-600">{message}</p> : null}
    </div>
  );
}
