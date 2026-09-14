import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { navFor, ROLE_LABELS } from "@/lib/rbac";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const nav = navFor(user);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="text-sm font-semibold text-stone-900">
            Street Food <span className="text-brand-600">System</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-stone-500 sm:inline">
              {user.name} · {ROLE_LABELS[user.role]}
            </span>
            <SignOutButton />
          </div>
        </div>
        <nav className="mx-auto max-w-7xl overflow-x-auto px-2 pb-2">
          <ul className="flex gap-1 whitespace-nowrap">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-md px-3 py-2 text-sm text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
