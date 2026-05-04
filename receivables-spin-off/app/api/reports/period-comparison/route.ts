export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { UserRole } from "@prisma/client"
import {
  buildPeriodComparisonReport,
  metricsToCsvRows,
  PeriodComparisonMode,
} from "@/lib/period-comparison-report"

function parseMode(raw: string | null): PeriodComparisonMode {
  if (raw === "quarter" || raw === "semester") return raw
  return "month"
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    if (session.user.role === UserRole.CLIENT) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const mode = parseMode(searchParams.get("mode"))
    const asOf = searchParams.get("asOf")
    const format = searchParams.get("format")?.toLowerCase()

    const viewerUserId = session.user.role === UserRole.STAFF ? session.user.id : undefined

    const payload = await buildPeriodComparisonReport(
      { role: session.user.role as UserRole, email: session.user.email ?? null },
      mode,
      asOf ?? undefined,
      viewerUserId
    )

    if (format === "csv" || request.headers.get("accept")?.includes("text/csv")) {
      const csv = metricsToCsvRows(payload)
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="period-comparison-${mode}-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    }

    return NextResponse.json(payload)
  } catch (error: any) {
    console.error("period-comparison GET:", error)
    return NextResponse.json(
      { error: "Report failed", message: error?.message || String(error) },
      { status: 500 }
    )
  }
}
