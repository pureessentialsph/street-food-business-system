"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissSuggestion } from "@/lib/actions/procurement";

/** Dismissing needs a reason — otherwise nobody remembers why the order never happened. */
export function DismissButton({ suggestionId }: { suggestionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="text-xs font-medium text-stone-500 hover:text-stone-800 hover:underline"
      >
        Dismiss
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        aria-label="Why dismiss this suggestion?"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why?"
        className="h-9 w-32 rounded-md border border-stone-300 px-2 text-xs"
      />
      <button
        type="button"
        disabled={pending || !reason.trim()}
        onClick={() =>
          startTransition(async () => {
            await dismissSuggestion(suggestionId, reason);
            router.refresh();
          })
        }
        className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
      >
        {pending ? "…" : "OK"}
      </button>
    </div>
  );
}
