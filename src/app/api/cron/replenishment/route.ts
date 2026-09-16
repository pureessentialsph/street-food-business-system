import { NextResponse } from "next/server";
import { rawDb, scopedDb } from "@/lib/db";
import { storeSuggestions } from "@/lib/procurement-service";

/**
 * Nightly replenishment run (spec §9), so the order list is waiting in the morning.
 *
 * Protected by CRON_SECRET: without it set, the route refuses rather than exposing a
 * write endpoint to anyone who finds the URL.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured, so this endpoint is disabled." },
      { status: 503 },
    );
  }

  const provided = request.headers.get("authorization")?.replace("Bearer ", "");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companies = await rawDb.company.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });

  const results: { company: string; suggestions: number }[] = [];
  for (const company of companies) {
    const count = await storeSuggestions(scopedDb(company.id));
    results.push({ company: company.code, suggestions: count });
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
