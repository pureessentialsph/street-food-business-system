import Link from "next/link";

/**
 * Pieces the guide is built from. Kept plain and server-rendered: this page has to be
 * readable on a phone at 5am beside a cart, so it carries no client JavaScript.
 */

export function GuideSection({
  id, title, lead, children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-stone-200 pt-6 first:border-0 first:pt-0">
      <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
      {lead ? <p className="mt-1 text-sm text-stone-600">{lead}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/** A numbered walkthrough. Each step names the screen it happens on. */
export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="space-y-3">{children}</ol>;
}

export function Step({
  n, title, where, children,
}: {
  n: number;
  title: string;
  where?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-stone-900">
          {title}
          {where ? (
            <>
              {" "}
              <Link href={where} className="font-normal text-brand-700 hover:underline">
                {where}
              </Link>
            </>
          ) : null}
        </p>
        {children ? <div className="mt-1 space-y-2 text-sm text-stone-600">{children}</div> : null}
      </div>
    </li>
  );
}

/** Something that will cost money or time if ignored. Used sparingly on purpose. */
export function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {children}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-600">{children}</div>
  );
}

export function Table({
  head, rows,
}: {
  head: string[];
  rows: (React.ReactNode | string)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-stone-200">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            {head.map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={j === 0 ? "px-3 py-2 font-medium text-stone-900" : "px-3 py-2 text-stone-600"}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
