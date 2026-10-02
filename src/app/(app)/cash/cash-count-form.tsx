"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { recordCashCount } from "@/lib/actions/cash";
import { DENOMINATIONS, countCash, denominationTotal } from "@/lib/engines/cash-book";
import { formatPHP } from "@/lib/money";
import { Button } from "@/components/ui/button";

/**
 * Counting the box. Keyed in the way it is counted — notes and coins, largest first —
 * because an owner holding a stack of hundreds should not have to do the multiplication
 * before they can type anything.
 *
 * The difference against the book is shown live, before anything is saved, so the
 * answer to "did I miscount?" comes while the money is still on the table.
 */
export function CashCountForm({ expected, today }: { expected: string; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [businessDate, setBusinessDate] = useState(today);
  const [note, setNote] = useState("");
  const [writeOff, setWriteOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = useMemo(
    () => DENOMINATIONS.map((d) => ({ denomination: d, count: Number(counts[d] ?? 0) || 0 })),
    [counts],
  );
  const counted = denominationTotal(lines);
  const outcome = countCash(expected, counted.toFixed(4));
  const anyCounted = lines.some((line) => line.count > 0);
  const matches = outcome.variance === "0.00";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {DENOMINATIONS.map((d) => (
          <label key={d} className="block">
            <span className="text-xs text-stone-500">₱{d.toLocaleString("en-PH")}</span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              aria-label={`Number of ${d} peso notes or coins`}
              value={counts[d] ?? ""}
              /**
               * Read the value out before the updater runs. React clears currentTarget
               * once the handler returns, and a functional update is called later — so
               * reaching into the event from inside it throws the moment someone types.
               */
              onChange={(event) => {
                const typed = event.currentTarget.value;
                setCounts((c) => ({ ...c, [d]: typed }));
              }}
              className="h-11 w-full rounded-md border border-stone-300 px-2 font-mono text-sm tabular-nums"
              placeholder="0"
            />
          </label>
        ))}
      </div>

      <div className="rounded-md bg-stone-50 px-3 py-2 text-sm">
        <div className="flex justify-between">
          <span className="text-stone-500">Counted</span>
          <span className="font-mono tabular-nums">{formatPHP(outcome.counted)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-stone-500">The book says</span>
          <span className="font-mono tabular-nums">{formatPHP(outcome.expected)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-stone-200 pt-1 font-medium">
          <span>Difference</span>
          <span className={`font-mono tabular-nums ${outcome.variance.startsWith("-") ? "text-red-700" : ""}`}>
            {formatPHP(outcome.variance)}
          </span>
        </div>
        {anyCounted ? <p className="mt-1 text-xs text-stone-600">{outcome.verdict}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-stone-500">
          Counted on{" "}
          <input
            type="date"
            value={businessDate}
            max={today}
            onChange={(event) => setBusinessDate(event.currentTarget.value)}
            className="h-11 rounded-md border border-stone-300 px-2 text-sm"
          />
        </label>
        <input
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          placeholder="What do you think explains a difference?"
          className="h-11 min-w-[16rem] flex-1 rounded-md border border-stone-300 px-3 text-sm"
        />
      </div>

      {anyCounted && !matches ? (
        <label className="flex items-start gap-2 text-xs text-stone-600">
          <input
            type="checkbox"
            checked={writeOff}
            onChange={(event) => setWriteOff(event.currentTarget.checked)}
            className="mt-0.5"
          />
          <span>
            Write the difference off, so the book matches what is actually in the box. The count
            and the difference stay on the record either way — this only decides whether the
            running balance is corrected.
          </span>
        </label>
      ) : null}

      {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}

      <Button
        type="button"
        disabled={pending || !anyCounted}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await recordCashCount(
              lines.filter((line) => line.count > 0),
              { businessDate, note, writeOff },
            );
            if (!result.ok) setError(result.error);
            else {
              setCounts({});
              setNote("");
              setWriteOff(false);
              router.refresh();
            }
          })
        }
      >
        {pending ? "Recording…" : "Record this count"}
      </Button>
    </div>
  );
}
