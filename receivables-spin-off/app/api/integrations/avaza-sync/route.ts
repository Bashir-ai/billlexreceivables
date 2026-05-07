export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { UserRole } from "@prisma/client"
import { runAvazaSync } from "@/lib/integrations/avaza-sync"

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const dryRun = body?.dryRun === true
    const startDate = typeof body?.startDate === "string" ? body.startDate : null
    const endDate = typeof body?.endDate === "string" ? body.endDate : null

    const result = await runAvazaSync({ dryRun, startDate, endDate })
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      { error: "Avaza sync failed", message: error?.message || String(error) },
      { status: 500 }
    )
  }
}

