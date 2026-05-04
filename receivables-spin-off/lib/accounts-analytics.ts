import { UserRole } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { finderFeeRollupForUser } from "@/lib/accounts-rollup"
import { managementFeeRollupForUser } from "@/lib/management-fee-helpers"

type PersonnelScope = {
  viewerRole: UserRole
  viewerUserId: string
  targetUserId?: string | null
}

type DateRangeInput = {
  startDate?: string | null
  endDate?: string | null
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

function buildMonthWindows(start: Date, end: Date): Array<{ key: string; label: string; start: Date; end: Date }> {
  const cursor = startOfMonth(start)
  const last = startOfMonth(end)
  const out: Array<{ key: string; label: string; start: Date; end: Date }> = []
  while (cursor.getTime() <= last.getTime()) {
    const current = new Date(cursor)
    out.push({
      key: monthKey(current),
      label: monthLabel(current),
      start: new Date(current.getFullYear(), current.getMonth(), 1, 0, 0, 0, 0),
      end: new Date(current.getFullYear(), current.getMonth() + 1, 0, 23, 59, 59, 999),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return out
}

async function resolveUserIds(scope: PersonnelScope): Promise<string[]> {
  if (scope.viewerRole === UserRole.EXTERNAL) return [scope.viewerUserId]
  if ((scope.viewerRole === UserRole.ADMIN || scope.viewerRole === UserRole.MANAGER) && scope.targetUserId) {
    return [scope.targetUserId]
  }
  const users = await prisma.user.findMany({
    where: { role: { not: UserRole.CLIENT } },
    select: { id: true },
    orderBy: { name: "asc" },
  })
  return users.map((u) => u.id)
}

export async function getPersonnelAnalytics(scope: PersonnelScope, input: DateRangeInput): Promise<{
  range: { from: string; to: string }
  monthlyPersonnelCost: Array<{ monthKey: string; monthLabel: string; totalCost: number }>
  peopleComparison: Array<{
    userId: string
    name: string
    role: UserRole
    paidOut: number
    accrued: number
    netBalance: number
  }>
}> {
  const now = new Date()
  const parsedStart = parseDate(input.startDate)
  const parsedEnd = parseDate(input.endDate)
  const end = parsedEnd ?? now
  const start = parsedStart ?? new Date(end.getFullYear(), end.getMonth() - 11, 1)
  const months = buildMonthWindows(start, end)
  const userIds = await resolveUserIds(scope)

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, role: true },
  })

  const [payments, allTimeLedger] = await Promise.all([
    prisma.userFinancialTransaction.findMany({
      where: {
        userId: { in: userIds },
        type: "PAYMENT",
        transactionDate: { gte: start, lte: end },
      },
      select: { userId: true, amount: true, transactionDate: true },
    }),
    prisma.userFinancialTransaction.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _sum: { amount: true },
    }),
  ])

  const monthlyMap = new Map(months.map((m) => [m.key, 0]))
  const paidOutByUser = new Map<string, number>()
  for (const p of payments) {
    const key = monthKey(p.transactionDate)
    if (monthlyMap.has(key)) {
      monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + Math.abs(p.amount))
    }
    paidOutByUser.set(p.userId, (paidOutByUser.get(p.userId) ?? 0) + Math.abs(p.amount))
  }

  const accruedByUser = new Map<string, number>()
  for (const user of users) {
    const startYm = start.getFullYear() * 100 + (start.getMonth() + 1)
    const endYm = end.getFullYear() * 100 + (end.getMonth() + 1)
    const [compAgg, finder, mgmt] = await Promise.all([
      prisma.compensationEntry.findMany({
        where: {
          userId: user.id,
          periodYear: { gte: start.getFullYear(), lte: end.getFullYear() },
        },
        select: { periodYear: true, periodMonth: true, totalEarned: true },
      }),
      finderFeeRollupForUser(user.id, start, end),
      managementFeeRollupForUser(user.id, start, end),
    ])
    const compEarned = compAgg
      .filter((r) => {
        const ym = r.periodYear * 100 + r.periodMonth
        return ym >= startYm && ym <= endYm
      })
      .reduce((sum, r) => sum + r.totalEarned, 0)
    accruedByUser.set(
      user.id,
      compEarned + finder.totalEarned + mgmt.totalEarned
    )
  }

  const netByUser = new Map<string, number>(
    allTimeLedger.map((r) => [r.userId, r._sum.amount ?? 0])
  )

  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    monthlyPersonnelCost: months.map((m) => ({
      monthKey: m.key,
      monthLabel: m.label,
      totalCost: monthlyMap.get(m.key) ?? 0,
    })),
    peopleComparison: users.map((u) => ({
      userId: u.id,
      name: u.name,
      role: u.role,
      paidOut: paidOutByUser.get(u.id) ?? 0,
      accrued: accruedByUser.get(u.id) ?? 0,
      netBalance: netByUser.get(u.id) ?? 0,
    })),
  }
}

