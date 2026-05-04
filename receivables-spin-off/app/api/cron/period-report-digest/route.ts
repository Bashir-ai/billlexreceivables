export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

/** Placeholder cron hook — extend to email CSV or store snapshots when SMTP is configured. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get("authorization")
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json({
    ok: true,
    message: "Scheduled digest hook ready — attach email storage or alerting here.",
    hint: "GET /api/reports/period-comparison?format=csv exports the comparative report programmatically.",
  })
}
