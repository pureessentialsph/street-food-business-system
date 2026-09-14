import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-stone-200 bg-white shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-stone-100 px-5 py-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-sm font-semibold text-stone-900", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function EmptyState({ title, action }: { title: string; action: string }) {
  // Empty states name the next action, never "No data found" (spec §13).
  return (
    <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-5 py-8 text-center">
      <p className="text-sm font-medium text-stone-700">{title}</p>
      <p className="mt-1 text-sm text-stone-500">{action}</p>
    </div>
  );
}
