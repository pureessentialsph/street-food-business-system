"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { closeShift } from "@/lib/actions/shifts";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

type Line = {
  productId: string;
  name: string;
  piecesIssued: string;
  piecesPerStick: string;
  pricePerStick: string;
  returned: string;
  wasted: string;
  reason: string;
};

const peso = (value: number) =>
  `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The closing count (spec §2, §13): a tight numeric grid for someone standing at the
 * branch with carts coming back one after another. Every figure updates live, so the
 * supervisor sees the expected cash before the vendor hands anything over.
 */
export function ClosingGrid({
  shiftId, lines: initial, vendorName, alreadyClosed, existing,
}: {
  shiftId: string;
  lines: Line[];
  vendorName: string;
  alreadyClosed: boolean;
  existing: { cashRemitted: string; digitalSales: string; notes: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<Line[]>(initial);
  const [cashRemitted, setCashRemitted] = useState(alreadyClosed ? existing.cashRemitted : "");
  const [digitalSales, setDigitalSales] = useState(alreadyClosed ? existing.digitalSales : "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [notes, setNotes] = useState(existing.notes);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => `close-${shiftId}-${Date.now()}`);

  function update(productId: string, field: "returned" | "wasted" | "reason", value: string) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, [field]: value } : l)));
  }

  const totals = useMemo(() => {
    let netSales = 0;
    let sold = 0;
    let issued = 0;
    let overCounted = false;
    let needsReason = false;

    for (const line of lines) {
      const i = Number(line.piecesIssued) || 0;
      const r = Number(line.returned) || 0;
      const w = Number(line.wasted) || 0;
      const s = i - r - w;
      if (s < 0) overCounted = true;
      if (i > 0 && w / i > 0.1 && !line.reason.trim()) needsReason = true;
      issued += i;
      sold += Math.max(s, 0);
      netSales += (Math.max(s, 0) * Number(line.pricePerStick)) / Number(line.piecesPerStick);
    }

    const expected = netSales - (Number(digitalSales) || 0);
    const variance = cashRemitted === "" ? null : (Number(cashRemitted) || 0) - expected;
    return { netSales, sold, issued, expected, variance, overCounted, needsReason };
  }, [lines, cashRemitted, digitalSales]);

  const blocked = totals.overCounted || totals.needsReason || cashRemitted === "";

  function submit() {
    setError(null);
    const formData = new FormData();
    for (const line of lines) {
      formData.set(`returned-${line.productId}`, line.returned || "0");
      formData.set(`wasted-${line.productId}`, line.wasted || "0");
      formData.set(`reason-${line.productId}`, line.reason);
    }
    formData.set("cashRemitted", cashRemitted || "0");
    formData.set("digitalSales", digitalSales || "0");
    formData.set("notes", notes);
    formData.set("idempotencyKey", idempotencyKey);
    if (acknowledged) {
      formData.set("vendorAcknowledged", "on");
      formData.set("acknowledgedVia", "VERBAL_CONFIRMED");
      formData.set("acknowledgedNote", `Counted in the presence of ${vendorName}`);
    }

    startTransition(async () => {
      const result = await closeShift(shiftId, formData);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{alreadyClosed ? "Re-count / Balik" : "Count back / Balik"}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-2 py-2 text-left">Product</th>
                <th className="px-2 py-2 text-right">Issued</th>
                <th className="px-2 py-2 text-right">Returned</th>
                <th className="px-2 py-2 text-right">Wasted</th>
                <th className="px-2 py-2 text-right">Sold</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {lines.map((line) => {
                const issued = Number(line.piecesIssued) || 0;
                const sold = issued - (Number(line.returned) || 0) - (Number(line.wasted) || 0);
                const wastageHigh = issued > 0 && (Number(line.wasted) || 0) / issued > 0.1;
                return (
                  <tr key={line.productId}>
                    <td className="px-2 py-2">
                      <span className="font-medium text-stone-900">{line.name}</span>
                      <span className="block text-xs text-stone-500">{line.piecesPerStick} pcs/stick</span>
                      {wastageHigh ? (
                        <input
                          aria-label={`Why was so much ${line.name} wasted?`}
                          placeholder="Why so much waste?"
                          value={line.reason}
                          onChange={(event) => update(line.productId, "reason", event.target.value)}
                          className="mt-1 h-10 w-full rounded-md border border-amber-300 bg-amber-50 px-2 text-xs"
                        />
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-stone-600">{issued}</td>
                    <td className="px-2 py-2 text-right">
                      <input
                        aria-label={`${line.name} returned`}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={line.returned === "0" ? "" : line.returned}
                        placeholder="0"
                        onChange={(event) => update(line.productId, "returned", event.target.value)}
                        className="h-12 w-20 rounded-md border border-stone-300 px-2 text-right font-mono text-base tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        aria-label={`${line.name} wasted`}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={line.wasted === "0" ? "" : line.wasted}
                        placeholder="0"
                        onChange={(event) => update(line.productId, "wasted", event.target.value)}
                        className="h-12 w-20 rounded-md border border-stone-300 px-2 text-right font-mono text-base tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </td>
                    <td className={`px-2 py-2 text-right font-mono text-base tabular-nums ${sold < 0 ? "font-bold text-red-700" : "font-medium"}`}>
                      {sold}
                      <span className="block text-xs font-normal text-stone-500">
                        {sold >= 0 ? `${(sold / Number(line.piecesPerStick)).toFixed(1)} sticks` : "impossible"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="digitalSales" className="mb-1 block text-sm font-medium text-stone-700">
              Digital payments (GCash etc.)
            </label>
            <input
              id="digitalSales"
              inputMode="decimal"
              placeholder="0.00"
              value={digitalSales}
              onChange={(event) => setDigitalSales(event.target.value)}
              className="h-12 w-full rounded-md border border-stone-300 px-3 text-right font-mono text-lg tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="cashRemitted" className="mb-1 block text-sm font-medium text-stone-700">
              Cash handed over
            </label>
            <input
              id="cashRemitted"
              inputMode="decimal"
              placeholder="0.00"
              value={cashRemitted}
              onChange={(event) => setCashRemitted(event.target.value)}
              className="h-12 w-full rounded-md border border-stone-300 px-3 text-right font-mono text-lg tabular-nums"
            />
          </div>
        </div>

        <div className="rounded-md bg-stone-50 p-3 text-sm">
          <div className="flex justify-between"><span className="text-stone-500">Sold</span><span className="font-mono tabular-nums">{totals.sold} of {totals.issued} pcs</span></div>
          <div className="flex justify-between"><span className="text-stone-500">Net sales</span><span className="font-mono tabular-nums">{peso(totals.netSales)}</span></div>
          <div className="flex justify-between"><span className="text-stone-500">Expected cash</span><span className="font-mono tabular-nums">{peso(totals.expected)}</span></div>
          {totals.variance !== null ? (
            <div className="flex justify-between border-t border-stone-200 pt-1 font-medium">
              <span>Variance</span>
              <span className={`font-mono tabular-nums ${totals.variance < -0.005 ? "text-red-700" : totals.variance > 0.005 ? "text-amber-700" : "text-emerald-700"}`}>
                {peso(totals.variance)}
                {Math.abs(totals.variance) > 100 ? " — will be disputed" : ""}
              </span>
            </div>
          ) : null}
        </div>

        <label className="flex items-start gap-2 rounded-md border border-stone-200 p-3 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 h-5 w-5 rounded border-stone-300 text-brand-600"
          />
          <span>
            <span className="font-medium text-stone-900">Counted in {vendorName}&apos;s presence</span>
            <span className="block text-xs text-stone-500">
              Required before any shortage can be deducted from pay. Without it the shift still
              closes and stock still moves, but no deduction is applied.
            </span>
          </span>
        </label>

        <div>
          <label htmlFor="notes" className="mb-1 block text-sm font-medium text-stone-700">Notes</label>
          <textarea
            id="notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Rain until 4pm, slow afternoon…"
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
          />
        </div>

        {totals.overCounted ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            Returns plus waste are more than what was issued. Recount before closing.
          </p>
        ) : null}
        {totals.needsReason ? (
          <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Wastage is over 10% of what was issued — say what happened.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        ) : null}

        <Button type="button" size="lg" className="w-full" disabled={pending || blocked} onClick={submit}>
          {pending ? "Closing…" : alreadyClosed ? "Save re-count" : "Close cart"}
        </Button>
      </CardBody>
    </Card>
  );
}
