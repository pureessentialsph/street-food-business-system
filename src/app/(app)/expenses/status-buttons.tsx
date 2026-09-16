"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setExpenseStatus } from "@/lib/actions/expenses";
import { Button } from "@/components/ui/button";

/** Approve or reject. Whoever recorded it cannot be the one to wave it through. */
export function StatusButtons({ expenseId }: { expenseId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go(status: "APPROVED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      const result = await setExpenseStatus(expenseId, status);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <Button type="button" size="sm" disabled={pending} onClick={() => go("APPROVED")}>Approve</Button>
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => go("REJECTED")}>Reject</Button>
      </div>
      {error ? <span className="max-w-[16rem] text-xs font-medium text-red-700">{error}</span> : null}
    </div>
  );
}
