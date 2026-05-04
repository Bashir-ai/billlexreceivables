export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { runAvazaSync } from "@/lib/integrations/avaza-sync"

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const dryRun = searchParams.get("dryRun") === "true"
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    const result = await runAvazaSync({ dryRun, startDate, endDate })
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      { error: "Avaza sync failed", message: error?.message || String(error) },
      { status: 500 }
    )
  }
}

