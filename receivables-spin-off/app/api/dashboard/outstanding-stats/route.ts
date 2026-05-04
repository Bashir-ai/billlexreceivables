export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getOutstandingAndYtdStats } from "@/lib/dashboard-analytics"

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const asOfDate = searchParams.get("asOfDate")
  const ytdYearRaw = searchParams.get("ytdYear")
  const ytdYear = ytdYearRaw ? Number(ytdYearRaw) : null

  const data = await getOutstandingAndYtdStats(
    { role: session.user.role, email: session.user.email },
    { asOfDate, ytdYear }
  )
  return NextResponse.json(data)
}

