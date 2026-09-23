"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/rbac";

/**
 * Left sidebar. Fixed on desktop; on a phone it collapses behind a hamburger so the
 * supervisor keeps the full width for the closing grid (spec §13).
 */
export function Sidebar({
  nav, userName, roleLabel, companyName,
}: {
  nav: NavItem[];
  userName: string;
  roleLabel: string;
  companyName: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {nav.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "block rounded-md px-3 py-2.5 text-sm transition-colors",
              active
                ? "bg-brand-50 font-medium text-brand-800"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-stone-200 px-4 py-3">
      <Link
        href="/account"
        onClick={() => setOpen(false)}
        className="block truncate text-sm font-medium text-stone-800 hover:underline"
      >
        {userName}
      </Link>
      <p className="text-xs text-stone-500">{roleLabel}</p>
      <button
        type="button"
        onClick={() => void signOut({ redirectTo: "/login" })}
        className="mt-2 text-xs font-medium text-stone-600 underline hover:text-stone-900"
      >
        Sign out
      </button>
    </div>
  );

  const brand = (
    <div className="flex h-14 items-center border-b border-stone-200 px-4">
      <Link href="/dashboard" className="text-sm font-semibold text-stone-900" onClick={() => setOpen(false)}>
        Street Food <span className="text-brand-600">System</span>
      </Link>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-stone-200 bg-white px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="-ml-1 rounded-md p-2 text-stone-700 hover:bg-stone-100"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-stone-900">
          Street Food <span className="text-brand-600">System</span>
        </span>
      </header>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-stone-900/40"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            {brand}
            {links}
            {footer}
          </aside>
        </div>
      ) : null}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-stone-200 bg-white lg:flex">
        {brand}
        <p className="px-4 pt-3 text-xs uppercase tracking-wide text-stone-400">{companyName}</p>
        {links}
        {footer}
      </aside>
    </>
  );
}
