export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { materializeOperationsTodos } from "@/lib/operations-materialize"

/** Nightly (or manual) idempotent sync of operations todos from collections + payroll queues */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const result = await materializeOperationsTodos()
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error("operations-materialize cron:", error)
    return NextResponse.json(
      { success: false, message: error?.message || String(error) },
      { status: 500 }
    )
  }
}
