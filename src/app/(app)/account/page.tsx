import { requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/rbac";
import { PageHeader } from "@/components/data-table";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordForm } from "@/components/password-form";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <div className="space-y-5">
      <PageHeader title="Your account" subtitle="Who you are signed in as, and your password." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Signed in as</CardTitle></CardHeader>
          <CardBody className="space-y-1 text-sm text-stone-600">
            <p>Name: <span className="font-medium text-stone-900">{user.name}</span></p>
            <p>Email: <span className="font-medium text-stone-900">{user.email}</span></p>
            <p>Role: <span className="font-medium text-stone-900">{ROLE_LABELS[user.role]}</span></p>
            <p className="pt-2 text-xs text-stone-500">
              Your name, email and role are set by an owner. Ask one to change them.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Change your password</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-stone-600">
              Changing it signs out every other device signed in as you, including one you
              have forgotten about. Do this straight away if you think anyone else has seen it.
            </p>
            <PasswordForm />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
