export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@prisma/client"
import { POST as calculateCompensationForUser } from "@/app/api/users/[id]/compensation/calculate/route"

function monthsBetweenInclusive(startYear: number, startMonth: number, endYear: number, endMonth: number) {
  const out: Array<{ year: number; month: number }> = []
  const cursor = new Date(startYear, startMonth - 1, 1)
  const end = new Date(endYear, endMonth - 1, 1)
  while (cursor <= end) {
    out.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return out
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const userId = id

    // Check permissions: user can view own, admin/manager can view all
    if (session.user.id !== userId && session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const startYear = searchParams.get("startYear") ? parseInt(searchParams.get("startYear")!) : null
    const endYear = searchParams.get("endYear") ? parseInt(searchParams.get("endYear")!) : null
    const startMonth = searchParams.get("startMonth") ? parseInt(searchParams.get("startMonth")!) : null
    const endMonth = searchParams.get("endMonth") ? parseInt(searchParams.get("endMonth")!) : null

    // Deterministic default window: YTD through current month when no explicit range is provided.
    const now = new Date()
    const fromYear = startYear ?? now.getFullYear()
    const fromMonth = startMonth ?? 1
    const toYear = endYear ?? now.getFullYear()
    const toMonth = endMonth ?? now.getMonth() + 1
    const targetMonths = monthsBetweenInclusive(fromYear, fromMonth, toYear, toMonth)
      .filter((target) => {
        const targetDate = new Date(target.year, target.month - 1, 1)
        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        // Only auto-sync closed periods. Current month remains open until month-end.
        return targetDate < currentMonthStart
      })

    const syncedMonths: Array<{ year: number; month: number }> = []
    const failedMonths: Array<{ year: number; month: number; reason: string }> = []
    const monthDeletionMarkers = await prisma.userFinancialTransaction.findMany({
      where: {
        userId,
        relatedType: "COMPENSATION_ENTRY_DELETED",
      },
      select: {
        relatedId: true,
      },
    })
    const deletedMonthKeys = new Set(monthDeletionMarkers.map((row) => row.relatedId))

    // Auto-sync compensation entries so Accounts reflects latest settings schedule.
    for (const target of targetMonths) {
      const monthKey = `${target.year}-${target.month.toString().padStart(2, "0")}`
      if (deletedMonthKeys.has(monthKey)) {
        failedMonths.push({
          year: target.year,
          month: target.month,
          reason: "Skipped due to admin manual deletion",
        })
        continue
      }
      try {
        const req = new Request("http://localhost/internal/comp-entries-sync", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-cron": "compensation-calculate",
            ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
          },
          body: JSON.stringify({
            year: target.year,
            month: target.month,
            forceRecalculate: true,
          }),
        })
        const result = await calculateCompensationForUser(req, { params: Promise.resolve({ id: userId }) })
        if (!result.ok) {
          const payload = await result.json().catch(() => ({}))
          failedMonths.push({
            year: target.year,
            month: target.month,
            reason: payload?.error || `HTTP ${result.status}`,
          })
          continue
        }
        syncedMonths.push({ year: target.year, month: target.month })
      } catch (error: any) {
        failedMonths.push({
          year: target.year,
          month: target.month,
          reason: error?.message || "Unknown sync error",
        })
      }
    }

    const where: any = { userId }
    where.periodYear = { gte: fromYear, lte: toYear }
    where.AND = [
      {
        OR: [
          { periodYear: { gt: fromYear } },
          { periodYear: fromYear, periodMonth: { gte: fromMonth } },
        ],
      },
      {
        OR: [
          { periodYear: { lt: toYear } },
          { periodYear: toYear, periodMonth: { lte: toMonth } },
        ],
      },
    ]

    const entries = await prisma.compensationEntry.findMany({
      where,
      orderBy: [
        { periodYear: 'desc' },
        { periodMonth: 'desc' },
      ],
      include: {
        compensation: true,
      },
    })

    // Fetch transactions for each entry
    const entriesWithTransactions = await Promise.all(
      entries.map(async (entry) => {
        const transactions = await prisma.userFinancialTransaction.findMany({
          where: {
            relatedId: entry.id,
            relatedType: "COMPENSATION_ENTRY",
          },
          orderBy: { transactionDate: 'desc' },
        })
        return {
          ...entry,
          transactions,
        }
      })
    )

    return NextResponse.json({
      entries: entriesWithTransactions,
      sync: {
        from: { year: fromYear, month: fromMonth },
        to: { year: toYear, month: toMonth },
        attemptedMonths: targetMonths.length,
        syncedMonths,
        failedMonths,
      },
    })
  } catch (error: any) {
    console.error("Error fetching compensation entries:", error)
    return NextResponse.json(
      { error: error.message || "Failed to fetch compensation entries" },
      { status: 500 }
    )
  }
}
