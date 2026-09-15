import Link from "next/link";
import { PageHeader } from "@/components/data-table";
import { Card, CardBody } from "@/components/ui/card";

/**
 * A linked-but-unbuilt module. Better than a 404: it says what the screen will do, which
 * phase builds it, and where to go meanwhile.
 */
export function ComingSoon({
  title, subtitle, phase, does, next,
}: {
  title: string;
  subtitle: string;
  phase: string;
  does: string[];
  next?: { href: string; label: string };
}) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <CardBody className="space-y-4">
          <div className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
            Arrives in {phase}
          </div>
          <div>
            <p className="text-sm font-medium text-stone-800">What this screen will do</p>
            <ul className="mt-2 space-y-1.5 text-sm text-stone-600">
              {does.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true" className="text-stone-400">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          {next ? (
            <p className="text-sm text-stone-600">
              In the meantime:{" "}
              <Link href={next.href} className="font-medium text-brand-700 hover:underline">
                {next.label}
              </Link>
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
