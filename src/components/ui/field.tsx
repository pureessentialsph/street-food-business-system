import * as React from "react";
import { cn } from "@/lib/utils";

export function Field({
  label, name, hint, error, children, required,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string[];
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium text-stone-700">
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-stone-500">{hint}</p> : null}
      {error?.length ? (
        <p className="text-xs font-medium text-red-600">{error.join(" ")}</p>
      ) : null}
    </div>
  );
}

const baseInput =
  "h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-stone-100";

export function TextInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(baseInput, className)} {...props} />;
}

/** Right-aligned tabular numerals with a numeric keypad — supervisors enter these outdoors. */
export function NumberInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      inputMode="decimal"
      className={cn(baseInput, "text-right font-mono tabular-nums", className)}
      {...props}
    />
  );
}

export function Select({
  className, children, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(baseInput, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      className={cn(baseInput, "h-auto py-2", className)}
      {...props}
    />
  );
}

export function Checkbox({
  label, name, multiple = false, ...props
}: {
  label: string;
  /**
   * True when several boxes share this name and the form wants the list of ticked
   * values — branch scopes, say. Such a group must NOT emit the hidden field below:
   * "false" would arrive as one of the values and be read as a real selection.
   */
  multiple?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-center gap-2 text-sm text-stone-700">
      {/*
        A single unchecked checkbox sends nothing at all, so a schema default of `true`
        would quietly keep a record active however many times someone unticked the box.
        The hidden field always sends "false"; the checkbox overrides it when ticked,
        because the later value wins when the form is read.
      */}
      {name && !multiple ? <input type="hidden" name={name} value="false" /> : null}
      <input
        type="checkbox"
        name={name}
        className="h-5 w-5 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
        {...props}
      />
      {label}
    </label>
  );
}

export function Badge({
  tone = "neutral", children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-stone-100 text-stone-700",
    success: "bg-emerald-100 text-emerald-800",
    warning: "bg-amber-100 text-amber-800",
    danger: "bg-red-100 text-red-700",
  } as const;
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}
