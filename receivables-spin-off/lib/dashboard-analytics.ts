import { BillStatus, Prisma, UserRole } from "@prisma/client"
import { prisma } from "@/lib/prisma"

type ViewerScope = {
  role?: UserRole
  email?: string | null
}

type DateRangeInput = {
  startDate?: string | null
  endDate?: string | null
}

const OUTSTANDING_STATUSES: BillStatus[] = [BillStatus.SUBMITTED, BillStatus.APPROVED]

function parseDate(value?: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function billAccessWhere(scope: ViewerScope): Prisma.BillWhereInput {
  if (scope.role === UserRole.CLIENT && scope.email) {
    return { client: { email: scope.email } }
  }
  return {}
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}

function monthSeries(start: Date, end: Date): Array<{ key: string; label: string }> {
  const cursor = startOfMonth(start)
  const last = startOfMonth(end)
  const out: Array<{ key: string; label: string }> = []
  while (cursor.getTime() <= last.getTime()) {
    out.push({
      key: monthKey(cursor),
      label: cursor.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return out
}

export async function getInvoiceMonthlyStats(
  scope: ViewerScope,
  input: DateRangeInput
): Promise<{
  months: Array<{ monthKey: string; monthLabel: string; issuedCount: number; invoicedAmount: number; paidAmount: number }>
  totals: { issuedCount: number; invoicedAmount: number; paidAmount: number }
}> {
  const now = new Date()
  const parsedStart = parseDate(input.startDate)
  const parsedEnd = parseDate(input.endDate)
  const end = parsedEnd ?? now
  const start = parsedStart ?? new Date(end.getFullYear(), end.getMonth() - 11, 1)

  const baseWhere = billAccessWhere(scope)
  const bills = await prisma.bill.findMany({
    where: {
      deletedAt: null,
      ...baseWhere,
      OR: [
        { createdAt: { gte: start, lte: end } },
        { submittedAt: { gte: start, lte: end } },
        { paidAt: { gte: start, lte: end } },
      ],
    },
    select: {
      createdAt: true,
      submittedAt: true,
      paidAt: true,
      amount: true,
      status: true,
    },
  })

  const series = monthSeries(start, end)
  const buckets = new Map(
    series.map((m) => [
      m.key,
      { monthKey: m.key, monthLabel: m.label, issuedCount: 0, invoicedAmount: 0, paidAmount: 0 },
    ])
  )

  for (const bill of bills) {
    const issuedAt = bill.submittedAt ?? bill.createdAt
    if (issuedAt >= start && issuedAt <= end) {
      const key = monthKey(issuedAt)
      const row = buckets.get(key)
      if (row) {
        row.issuedCount += 1
        row.invoicedAmount += bill.amount
      }
    }
    if (bill.paidAt && bill.paidAt >= start && bill.paidAt <= end && bill.status === BillStatus.PAID) {
      const key = monthKey(bill.paidAt)
      const row = buckets.get(key)
      if (row) row.paidAmount += bill.amount
    }
  }

  const months = Array.from(buckets.values())
  return {
    months,
    totals: {
      issuedCount: months.reduce((s, m) => s + m.issuedCount, 0),
      invoicedAmount: months.reduce((s, m) => s + m.invoicedAmount, 0),
      paidAmount: months.reduce((s, m) => s + m.paidAmount, 0),
    },
  }
}

export async function getOutstandingAndYtdStats(
  scope: ViewerScope,
  input: { asOfDate?: string | null; ytdYear?: number | null }
): Promise<{
  asOf: string
  outstandingTotal: number
  outstandingServices: number
  outstandingExpenses: number
  receivedYtd: number
}> {
  const asOf = parseDate(input.asOfDate) ?? new Date()
  const year = input.ytdYear && input.ytdYear > 2000 ? input.ytdYear : asOf.getFullYear()
  const ytdStart = new Date(year, 0, 1, 0, 0, 0, 0)
  const ytdEnd = new Date(year, 11, 31, 23, 59, 59, 999)

  const baseWhere = billAccessWhere(scope)

  const [outstandingBills, ytdPaidAgg] = await Promise.all([
    prisma.bill.findMany({
      where: {
        deletedAt: null,
        ...baseWhere,
        status: { in: OUTSTANDING_STATUSES },
        createdAt: { lte: asOf },
      },
      select: {
        id: true,
        amount: true,
        expenses: { select: { id: true }, take: 1 },
      },
    }),
    prisma.bill.aggregate({
      where: {
        deletedAt: null,
        ...baseWhere,
        status: BillStatus.PAID,
        paidAt: { gte: ytdStart, lte: ytdEnd },
      },
      _sum: { amount: true },
    }),
  ])

  let outstandingServices = 0
  let outstandingExpenses = 0
  for (const bill of outstandingBills) {
    // Custom rule requested: expenses invoices are a separate bill class.
    const isExpenseInvoice = (bill.expenses?.length ?? 0) > 0
    if (isExpenseInvoice) outstandingExpenses += bill.amount
    else outstandingServices += bill.amount
  }

  return {
    asOf: asOf.toISOString(),
    outstandingTotal: outstandingServices + outstandingExpenses,
    outstandingServices,
    outstandingExpenses,
    receivedYtd: ytdPaidAgg._sum.amount ?? 0,
  }
}

