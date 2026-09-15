import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Right-align and tabular-ise money and quantity columns. */
  numeric?: boolean;
  className?: string;
};

export function DataTable<T extends { id: string }>({
  rows, columns, href, empty,
}: {
  rows: T[];
  columns: Column<T>[];
  href?: (row: T) => string;
  empty: { title: string; action: string };
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center">
        <p className="text-sm font-medium text-stone-700">{empty.title}</p>
        <p className="mt-1 text-sm text-stone-500">{empty.action}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50 text-left">
            {columns.map((col) => (
              <th
                key={col.header}
                className={cn(
                  "px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-stone-500",
                  col.numeric && "text-right",
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-stone-50">
              {columns.map((col, index) => {
                const content = col.cell(row);
                return (
                  <td
                    key={col.header}
                    className={cn(
                      "px-4 py-2.5 align-middle",
                      col.numeric && "text-right font-mono tabular-nums",
                      col.className,
                    )}
                  >
                    {index === 0 && href ? (
                      <Link href={href(row)} className="font-medium text-brand-700 hover:underline">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SearchBar({
  placeholder, defaultValue, filters,
}: {
  placeholder: string;
  defaultValue?: string;
  filters?: React.ReactNode;
}) {
  return (
    <form className="flex flex-wrap items-end gap-2" method="get">
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-11 min-w-[200px] flex-1 rounded-md border border-stone-300 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      {filters}
      <button
        type="submit"
        className="h-11 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium text-stone-700 hover:bg-stone-100"
      >
        Filter
      </button>
    </form>
  );
}

export function PageHeader({
  title, subtitle, action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-stone-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
