"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reverseLedgerEntry } from "@/lib/actions/inventory";

/**
 * Undo one ledger row. Asks for a reason before it will do anything, because a
 * correction with no explanation is the thing that makes a ledger untrustworthy six
 * months later — and because it is the last chance to notice you picked the wrong row.
 */
export function ReverseEntryButton({ txnId, describe }: { txnId: string; describe: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="whitespace-nowrap">
      <button
        type="button"
        disabled={pending}
        className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
        onClick={() => {
          const reason = window.prompt(
            `Undo ${describe}?\n\nThe row stays on the ledger and a correction is posted beside it. Say why:`,
          );
          if (reason === null) return;
          startTransition(async () => {
            const result = await reverseLedgerEntry(txnId, reason);
            setError(result.ok ? null : result.error);
            if (result.ok) router.refresh();
          });
        }}
      >
        {pending ? "…" : "Undo"}
      </button>
      {error ? <span className="ml-2 text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
