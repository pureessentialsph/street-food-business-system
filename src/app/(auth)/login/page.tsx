import { redirect } from "next/navigation";
import { loadSignedInUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  /**
   * The same test every page applies, not a looser one of its own. Send a session on to
   * the dashboard that the dashboard will refuse — one whose password has since changed,
   * say — and the two bounce the browser between them until it gives up with
   * ERR_TOO_MANY_REDIRECTS.
   */
  if (await loadSignedInUser()) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-stone-900">Street Food Business System</h1>
          <p className="mt-1 text-sm text-stone-500">Sign in to continue</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
