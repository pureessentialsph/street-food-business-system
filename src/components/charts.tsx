"use client";

import { useState } from "react";

/**
 * Charts for the dashboard. Deliberately hand-drawn SVG with a hover layer rather than
 * a charting library: one series, one axis, thin marks, rounded data-ends anchored to
 * the baseline, and a recessive grid.
 *
 * The single series colour is brand-600 (#ea580c), which passes the lightness,
 * chroma and contrast checks against this surface. A second hue is deliberately absent
 * — a target is drawn as a reference line, never as a second series on a second scale.
 */

const SERIES = "#ea580c";
const INK_MUTED = "#78716c";
const GRID = "#e7e5e4";

const peso = (value: number) =>
  `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pesoShort = (value: number) =>
  value >= 1000 ? `₱${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : `₱${value.toFixed(0)}`;

export type TrendPoint = { label: string; value: number; sublabel?: string };

/**
 * Daily sales over the trailing window. Bars, because days are discrete buckets and
 * the question is "how big was each day", not "what is the trajectory".
 */
export function TrendBars({
  points, reference, referenceLabel, height = 160,
}: {
  points: TrendPoint[];
  reference?: number;
  referenceLabel?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-stone-500">No sales in this window yet.</p>;
  }

  /**
   * Scale to the DATA, not the reference line. A target far above actual sales would
   * otherwise flatten every bar to a sliver — the chart would be about the target
   * instead of about the days. When the reference does not fit, it is annotated in the
   * footer rather than drawn.
   */
  const dataMax = Math.max(...points.map((p) => p.value), 1);
  const referenceFits = reference !== undefined && reference > 0 && reference <= dataMax * 1.4;
  const max = referenceFits ? Math.max(dataMax, reference) : dataMax;
  const width = 100;
  const gap = 2; // a 2px surface gap between adjacent bars
  const barWidth = Math.max((width - gap * (points.length - 1)) / points.length, 1);
  const plotHeight = height - 22; // leave room for the x labels

  const y = (value: number) => plotHeight - (value / max) * plotHeight;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={`Daily net sales for the last ${points.length} days`}
      >
        {/* recessive gridlines at quarters */}
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            key={fraction}
            x1="0" x2={width}
            y1={y(max * fraction)} y2={y(max * fraction)}
            stroke={GRID} strokeWidth="0.3" vectorEffect="non-scaling-stroke"
          />
        ))}

        {referenceFits ? (
          <line
            x1="0" x2={width} y1={y(reference)} y2={y(reference)}
            stroke={INK_MUTED} strokeWidth="1" strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {points.map((point, index) => {
          const barHeight = Math.max(plotHeight - y(point.value), point.value > 0 ? 1.5 : 0);
          return (
            <rect
              key={point.label}
              x={index * (barWidth + gap)}
              y={plotHeight - barHeight}
              width={barWidth}
              height={barHeight}
              rx="1.2"
              fill={SERIES}
              opacity={hover === null || hover === index ? 1 : 0.45}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              style={{ transition: "opacity 120ms" }}
            />
          );
        })}
      </svg>

      <div className="mt-1 flex justify-between text-[11px] text-stone-500">
        <span>{points[0]?.label}</span>
        {reference !== undefined && reference > 0 && referenceLabel ? (
          <span className="text-stone-400">
            {referenceFits ? "┄ " : ""}{referenceLabel} {pesoShort(reference)}
            {referenceFits ? "" : " (above this range)"}
          </span>
        ) : null}
        <span>{points.at(-1)?.label}</span>
      </div>

      {hover !== null && points[hover] ? (
        <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-md bg-stone-900 px-2 py-1 text-xs text-white shadow-lg">
          <span className="font-medium">{points[hover]!.label}</span>{" "}
          {peso(points[hover]!.value)}
          {points[hover]!.sublabel ? <span className="text-stone-300"> · {points[hover]!.sublabel}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export type RankRow = { id: string; label: string; value: number; sublabel?: string; href?: string };

/**
 * Ranked magnitude — top carts, top products. Horizontal bars, because the labels are
 * words and words read better along the axis than rotated under it.
 */
export function RankBars({
  rows, valueFormat = peso, emptyMessage = "Nothing to rank yet.",
}: {
  rows: RankRow[];
  valueFormat?: (value: number) => string;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-stone-500">{emptyMessage}</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const share = Math.max((row.value / max) * 100, row.value > 0 ? 1.5 : 0);
        return (
          <li key={row.id}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-stone-700">{row.label}</span>
              <span className="whitespace-nowrap font-mono tabular-nums text-stone-900">
                {valueFormat(row.value)}
                {row.sublabel ? <span className="ml-2 text-xs text-stone-500">{row.sublabel}</span> : null}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-stone-100">
              <div className="h-2 rounded-full" style={{ width: `${share}%`, background: SERIES }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A headline figure. Not a chart — one number reads better as one number. */
export function StatTile({
  label, value, note, tone = "neutral",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "neutral" | "good" | "warning" | "bad";
}) {
  const toneClass = {
    neutral: "text-stone-900",
    good: "text-emerald-700",
    warning: "text-amber-700",
    bad: "text-red-700",
  }[tone];

  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className={`mt-1 font-mono text-xl font-medium tabular-nums ${toneClass}`}>{value}</p>
      {note ? <p className="mt-0.5 text-xs text-stone-500">{note}</p> : null}
    </div>
  );
}
