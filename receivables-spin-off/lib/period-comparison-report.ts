import { BillStatus, UserRole } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  endOfDay,
  endOfMonth,
  endOfQuarter,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  subMonths,
  subQuarters,
} from "date-fns"

export type PeriodComparisonMode = "month" | "quarter" | "semester"

type ViewerScope = { role?: UserRole; email?: string | null; viewerUserId?: string | null }

function billWhereForScope(scope: ViewerScope) {
  if (scope.role === UserRole.CLIENT && scope.email) {
    return { client: { email: scope.email } }
  }
  return {}
}

function startOfSemester(d: Date): Date {
  const y = d.getFullYear()
  return d.getMonth() < 6 ? new Date(y, 0, 1, 0, 0, 0, 0) : new Date(y, 6, 1, 0, 0, 0, 0)
}

function endOfSemester(d: Date): Date {
  const y = d.getFullYear()
  return d.getMonth() < 6 ? new Date(y, 5, 30, 23, 59, 59, 999) : new Date(y, 11, 31, 23, 59, 59, 999)
}

function prevSemesterRange(d: Date): { start: Date; end: Date } {
  const s = startOfSemester(d)
  if (s.getMonth() === 0) {
    const py = d.getFullYear() - 1
    return { start: new Date(py, 6, 1, 0, 0, 0, 0), end: new Date(py, 11, 31, 23, 59, 59, 999) }
  }
  const y = d.getFullYear()
  return { start: new Date(y, 0, 1, 0, 0, 0, 0), end: new Date(y, 5, 30, 23, 59, 59, 999) }
}

export type PeriodRanges = {
  mode: PeriodComparisonMode
  asOf: string
  current: { label: string; start: string; end: string }
  previous: { label: string; start: string; end: string }
  rulesNote: string
}

export function computeComparisonPeriods(mode: PeriodComparisonMode, asOfRaw?: string | null): PeriodRanges {
  const raw = asOfRaw ? new Date(asOfRaw) : new Date()
  const asOf = Number.isNaN(raw.getTime()) ? new Date() : raw
  const asOfEnd = endOfDay(asOf)

  let current: { start: Date; end: Date; label: string }
  let previous: { start: Date; end: Date; label: string }
  let rulesNote: string

  if (mode === "month") {
    current = {
      start: startOfMonth(asOf),
      end: asOfEnd,
      label: `Month to date (${asOf.toLocaleString("default", { month: "short", year: "numeric" })})`,
    }
    const pm = subMonths(asOf, 1)
    previous = {
      start: startOfMonth(pm),
      end: endOfMonth(pm),
      label: `Previous calendar month (${pm.toLocaleString("default", { month: "short", year: "numeric" })})`,
    }
    rulesNote =
      "Current period is calendar month-to-date vs the immediately preceding full calendar month (different lengths unless today is month-end)."
  } else if (mode === "quarter") {
    current = {
      start: startOfQuarter(asOf),
      end: asOfEnd,
      label: "Quarter to date",
    }
    const pqAnchor = subQuarters(asOf, 1)
    previous = {
      start: startOfQuarter(pqAnchor),
      end: endOfQuarter(pqAnchor),
      label: "Previous full calendar quarter",
    }
    rulesNote =
      "Current period starts at quarter start through the as-of date. Previous period is the last complete fiscal quarter."
  } else {
    const prv = prevSemesterRange(asOf)
    previous = {
      start: prv.start,
      end: prv.end,
      label: `Previous semester (completed)`,
    }
    current = {
      start: startOfSemester(asOf),
      end: asOfEnd,
      label: startOfSemester(asOf).getMonth() === 0 ? "Semester H1 — to date" : "Semester H2 — to date",
    }
    rulesNote =
      "Semesters are calendar H1 (Jan–Jun) and H2 (Jul–Dec). Current is semester-to-date; previous is the last completed semester."
  }

  return {
    mode,
    asOf: asOf.toISOString(),
    current: {
      label: current.label,
      start: current.start.toISOString(),
      end: current.end.toISOString(),
    },
    previous: {
      label: previous.label,
      start: previous.start.toISOString(),
      end: previous.end.toISOString(),
    },
    rulesNote,
  }
}

function periodYMInRange(year: number, month1to12: number, start: Date, end: Date): boolean {
  const t = new Date(year, month1to12 - 1, 15, 12, 0, 0, 0).getTime()
  return t >= start.getTime() && t <= end.getTime()
}

async function totalsForBillRange(
  whereBase: Record<string, unknown>,
  start: Date,
  end: Date,
  viewerUserId?: string | null
) {
  const bills = await prisma.bill.findMany({
    where: {
      ...(whereBase as unknown as object),
      deletedAt: null,
      OR: [
        { submittedAt: { gte: start, lte: end } },
        { createdAt: { gte: start, lte: end }, submittedAt: null },
      ],
    },
    select: {
      status: true,
      amount: true,
      submittedAt: true,
      createdAt: true,
    },
  })

  let invoicedAmount = 0
  let invoiceCount = 0
  for (const b of bills) {
    const issued = b.submittedAt ?? b.createdAt
    if (issued >= start && issued <= end) {
      invoicedAmount += b.amount
      invoiceCount += 1
    }
  }

  const paidRows = await prisma.bill.findMany({
    where: {
      ...(whereBase as unknown as object),
      deletedAt: null,
      status: BillStatus.PAID,
      paidAt: { gte: start, lte: end },
    },
    select: { amount: true },
  })
  let paidAmount = 0
  for (const p of paidRows) paidAmount += p.amount

  const startY = start.getFullYear()
  const endY = end.getFullYear()
  const compRows = await prisma.compensationEntry.findMany({
    where: {
      periodYear: { gte: startY - 1, lte: endY + 1 },
      totalEarned: { gt: 0 },
      ...(viewerUserId ? { userId: viewerUserId } : {}),
    },
    select: { periodYear: true, periodMonth: true, totalEarned: true, totalPaid: true },
  })

  let compensationEarnedInRange = 0
  let compensationPaidInRange = 0
  for (const c of compRows) {
    if (periodYMInRange(c.periodYear, c.periodMonth, start, end)) {
      compensationEarnedInRange += c.totalEarned
      compensationPaidInRange += c.totalPaid
    }
  }

  return {
    invoiceCountIssuedInRange: invoiceCount,
    invoicedAmount,
    paidAmount,
    paidInvoiceCountInRange: paidRows.length,
    compensationEarnedInRange,
    compensationPaidInRange,
  }
}

async function snapshotBalances(scope: ViewerScope, asOf: Date) {
  const base = billWhereForScope(scope)

  const outstandingRows = await prisma.bill.findMany({
    where: {
      ...(base as unknown as object),
      deletedAt: null,
      status: { in: [BillStatus.SUBMITTED, BillStatus.APPROVED] },
      createdAt: { lte: asOf },
    },
    select: { amount: true },
  })
  const outstandingApprox = outstandingRows.reduce((s, r) => s + r.amount, 0)

  const payrollAgg = await prisma.compensationEntry.aggregate({
    where: {
      balance: { gt: 0.005 },
      ...(scope.viewerUserId ? { userId: scope.viewerUserId } : {}),
    },
    _sum: { balance: true },
  })

  return {
    asOf: asOf.toISOString(),
    outstandingApprox,
    payrollOwedApprox: payrollAgg._sum.balance ?? 0,
  }
}

export async function buildPeriodComparisonReport(
  scope: ViewerScope,
  mode: PeriodComparisonMode,
  asOfDate?: string | null,
  viewerUserId?: string | null
) {
  const resolvedScope = { ...scope, viewerUserId: viewerUserId ?? scope.viewerUserId ?? null }
  const ranges = computeComparisonPeriods(mode, asOfDate)
  const base = billWhereForScope(scope)

  const [currentStart, currentEnd] = [new Date(ranges.current.start), new Date(ranges.current.end)]
  const [previousStart, previousEnd] = [new Date(ranges.previous.start), new Date(ranges.previous.end)]

  const asOfDt = new Date(ranges.asOf)

  const [previousMetrics, currentMetrics, snapshots] = await Promise.all([
    totalsForBillRange(base, previousStart, previousEnd, resolvedScope.viewerUserId ?? undefined),
    totalsForBillRange(base, currentStart, currentEnd, resolvedScope.viewerUserId ?? undefined),
    snapshotBalances(resolvedScope, asOfDt),
  ])

  function deltaPct(prev: number, curr: number) {
    if (prev === 0) return curr === 0 ? 0 : 100
    return ((curr - prev) / prev) * 100
  }

  return {
    ranges,
    previous: previousMetrics,
    current: currentMetrics,
    snapshots,
    deltas: {
      invoicedAmountPct: deltaPct(previousMetrics.invoicedAmount, currentMetrics.invoicedAmount),
      paidAmountPct: deltaPct(previousMetrics.paidAmount, currentMetrics.paidAmount),
      invoiceCountPct: deltaPct(previousMetrics.invoiceCountIssuedInRange, currentMetrics.invoiceCountIssuedInRange),
    },
  }
}

export function metricsToCsvRows(payload: Awaited<ReturnType<typeof buildPeriodComparisonReport>>): string {
  const lines: string[][] = []
  lines.push(["Section", "Metric", "Previous period", "Current period", "Δ %"])
  lines.push(["", "Notes", "", payload.ranges.rulesNote.replace(/,/g, ";"), ""])
  lines.push([
    "",
    "Period labels",
    payload.ranges.previous.label,
    payload.ranges.current.label,
    "",
  ])
  lines.push([
    "Invoices",
    "Invoiced amount",
    String(payload.previous.invoicedAmount),
    String(payload.current.invoicedAmount),
    String(payload.deltas.invoicedAmountPct.toFixed(2)),
  ])
  lines.push([
    "Invoices",
    "Paid amount",
    String(payload.previous.paidAmount),
    String(payload.current.paidAmount),
    String(payload.deltas.paidAmountPct.toFixed(2)),
  ])
  lines.push([
    "Invoices",
    "Invoices issued (count in window)",
    String(payload.previous.invoiceCountIssuedInRange),
    String(payload.current.invoiceCountIssuedInRange),
    String(payload.deltas.invoiceCountPct.toFixed(2)),
  ])
  lines.push([
    "Balance (snapshot at as-of)",
    "Outstanding unpaid (approx)",
    "",
    String(payload.snapshots.outstandingApprox),
    "",
  ])
  lines.push([
    "Balance (snapshot at as-of)",
    "Payroll liabilities (positive balance)",
    "",
    String(payload.snapshots.payrollOwedApprox),
    "",
  ])
  lines.push([
    "Compensation",
    "Earned in window (by entry period)",
    String(payload.previous.compensationEarnedInRange),
    String(payload.current.compensationEarnedInRange),
    "",
  ])
  lines.push([
    "Compensation",
    "Paid out in window (snapshot on entries overlapping period)",
    String(payload.previous.compensationPaidInRange),
    String(payload.current.compensationPaidInRange),
    "",
  ])
  return lines.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
}
