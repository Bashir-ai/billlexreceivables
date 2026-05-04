export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getInvoiceMonthlyStats } from "@/lib/dashboard-analytics"

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")

  const data = await getInvoiceMonthlyStats(
    { role: session.user.role, email: session.user.email },
    { startDate, endDate }
  )
  return NextResponse.json(data)
}

