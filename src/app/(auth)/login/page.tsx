import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

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
