export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { CompensationType, UserRole } from "@prisma/client"
import {
  aggregateOutstandingAttributionByUser,
  finderFeeRollupForUser,
  ledgerRollupByType,
  realizedAttributionForUser,
  supportsAttributionSnapshots,
} from "@/lib/accounts-rollup"
import { managementFeeRollupForUser } from "@/lib/management-fee-helpers"

/** Compensation rows already include bill-based finder — do not add FinderFee table earned to YTD / matured KPIs. */
function compEmbedsFinderInCompKpis(t: CompensationType | undefined): boolean {
  return (
    t === CompensationType.SALARY_BONUS_FINDER_MANAGEMENT ||
    t === CompensationType.SALARY_BONUS
  )
}

/** SBFM: comp includes management from paid bills + fixed — do not add ManagementFee table earned to YTD / matured KPIs. */
function compEmbedsManagementInCompKpis(t: CompensationType | undefined): boolean {
  return t === CompensationType.SALARY_BONUS_FINDER_MANAGEMENT
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
    // EXTERNAL users can only view their own account
    if (session.user.role === UserRole.EXTERNAL && session.user.id !== userId) {
      return NextResponse.json({ error: "Forbidden - External users can only view their own account" }, { status: 403 })
    }
    if (session.user.id !== userId && session.user.role !== UserRole.ADMIN && session.user.role !== UserRole.MANAGER) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")
    const includeCompensation = searchParams.get("includeCompensation") !== "false"
    const includeAdvances = searchParams.get("includeAdvances") !== "false"
    const includeBenefits = searchParams.get("includeBenefits") !== "false"
    const teamSummary =
      searchParams.get("teamSummary") === "true" &&
      (session.user.role === UserRole.ADMIN || session.user.role === UserRole.MANAGER)

    const dateFilter: any = {}
    if (startDate) {
      dateFilter.gte = new Date(startDate)
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate)
    }

    const rangeFrom = startDate ? new Date(startDate) : undefined
    const rangeTo = endDate ? new Date(endDate) : undefined
    const now = new Date()
    const closedMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
    const summaryYear = now.getFullYear()
    /**
     * Default reporting window is YTD for closed periods only.
     * Current month postings (dated at month-end) are excluded until month closes.
     */
    const periodFrom = rangeFrom ?? new Date(summaryYear, 0, 1)
    const periodTo = rangeTo ? (rangeTo < now ? rangeTo : now) : closedMonthEnd
    /** End of `earnedAt` window for finder/management fee table rollups. Includes current month so KPIs match fee tabs. `periodTo` may stay on last closed month for compensation/ledger. */
    const feeRollupEnd = rangeTo ? (rangeTo < now ? rangeTo : now) : now

    const hasDateFilter = Boolean(startDate || endDate)
    const txInFilter: { gte?: Date; lte?: Date } = {}
    if (startDate) txInFilter.gte = new Date(startDate)
    if (endDate) txInFilter.lte = new Date(endDate)
    else if (startDate) txInFilter.lte = now

    const [
      activeComp,
      allTimeTxAgg,
      rangeTxAgg,
      ytdEntries,
      ytdFinderFeeRollup,
      ytdManagementFeeRollup,
      advanceRows,
    ] = await Promise.all([
      prisma.userCompensation.findFirst({
        where: {
          userId,
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
        },
        orderBy: { effectiveFrom: "desc" },
      }),
      prisma.userFinancialTransaction.aggregate({
        where: { userId },
        _sum: { amount: true },
      }),
      hasDateFilter
        ? prisma.userFinancialTransaction.aggregate({
            where: {
              userId,
              transactionDate: txInFilter,
            },
            _sum: { amount: true },
          })
        : Promise.resolve(null as Awaited<
          ReturnType<typeof prisma.userFinancialTransaction.aggregate>
        > | null),
      prisma.compensationEntry.findMany({
        where: {
          userId,
          periodYear: summaryYear,
          periodMonth: { lte: now.getMonth() + 1 },
        },
      }),
      finderFeeRollupForUser(userId, new Date(summaryYear, 0, 1), now),
      managementFeeRollupForUser(userId, new Date(summaryYear, 0, 1), now),
      prisma.userFinancialTransaction.findMany({
        where: {
          userId,
          type: "ADVANCE",
          ...(startDate || endDate ? { transactionDate: dateFilter } : {}),
        },
        select: { amount: true },
      }),
    ])

    const balanceAllTime = allTimeTxAgg._sum.amount ?? 0
    const ledgerNetInFilter = hasDateFilter
      ? (rangeTxAgg?._sum?.amount ?? 0)
      : null

    const ytdCompensationEarnings = ytdEntries.reduce(
      (sum, e) => sum + e.totalEarned,
      0
    )
    const embF = compEmbedsFinderInCompKpis(activeComp?.compensationType)
    const embM = compEmbedsManagementInCompKpis(activeComp?.compensationType)
    const ytdEarnings =
      ytdCompensationEarnings +
      (embF ? 0 : ytdFinderFeeRollup.totalEarned) +
      (embM ? 0 : ytdManagementFeeRollup.totalEarned)

    const totalAdvances = advanceRows.reduce(
      (sum, t) => sum + Math.abs(t.amount),
      0
    )

    // Benefits: respect selected date range when set; otherwise calendar YTD
    const benefitsDateWhere =
      startDate || endDate
        ? { benefitDate: dateFilter }
        : {
            benefitDate: {
              gte: new Date(summaryYear, 0, 1),
              lte: new Date(summaryYear, 11, 31, 23, 59, 59),
            },
          }
    const benefits = await prisma.fringeBenefit.findMany({
      where: {
        userId,
        ...benefitsDateWhere,
      },
    })
    const totalBenefits = benefits.reduce((sum, b) => sum + b.amount, 0)

    // Compensation config for UI
    const compensation = includeCompensation && activeComp ? activeComp : null

    // Get advances if requested
    let advances: any[] = []
    if (includeAdvances) {
      const advancesList = await prisma.officeAdvance.findMany({
        where: {
          userId,
          ...(startDate || endDate ? {
            startDate: dateFilter,
          } : {}),
        },
        orderBy: { createdAt: 'desc' },
      })

      // Fetch transactions for each advance
      advances = await Promise.all(
        advancesList.map(async (advance) => {
          const transactions = await prisma.userFinancialTransaction.findMany({
            where: {
              relatedId: advance.id,
              relatedType: "ADVANCE",
            },
            orderBy: { transactionDate: 'desc' },
          })
          return {
            ...advance,
            transactions,
          }
        })
      )
    }

    // Get benefits if requested
    let benefitsList: any[] = []
    if (includeBenefits) {
      benefitsList = await prisma.fringeBenefit.findMany({
        where: {
          userId,
          ...(startDate || endDate ? { benefitDate: dateFilter } : {}),
        },
        orderBy: { benefitDate: 'desc' },
      })
    }

    const [
      outstandingAttribution,
      realizedAttribution,
      ledgerByType,
      finderFeeRollup,
      managementFeeRollup,
      finderFeePendingAllTime,
      managementFeePendingAllTime,
    ] = await Promise.all([
      aggregateOutstandingAttributionByUser({
        billCreatedFrom: rangeFrom,
        billCreatedTo: rangeTo,
      }),
      realizedAttributionForUser(userId, periodFrom, periodTo),
      ledgerRollupByType(userId, periodFrom, periodTo),
      finderFeeRollupForUser(userId, periodFrom, feeRollupEnd),
      managementFeeRollupForUser(userId, periodFrom, feeRollupEnd),
      finderFeeRollupForUser(userId),
      managementFeeRollupForUser(userId),
    ])

    const periodCompEntries = await prisma.compensationEntry.findMany({
      where: {
        userId,
        periodYear: { gte: periodFrom.getFullYear(), lte: periodTo.getFullYear() },
        AND: [
          {
            OR: [
              { periodYear: { gt: periodFrom.getFullYear() } },
              { periodYear: periodFrom.getFullYear(), periodMonth: { gte: periodFrom.getMonth() + 1 } },
            ],
          },
          {
            OR: [
              { periodYear: { lt: periodTo.getFullYear() } },
              { periodYear: periodTo.getFullYear(), periodMonth: { lte: periodTo.getMonth() + 1 } },
            ],
          },
        ],
      },
      select: {
        totalEarned: true,
      },
    })

    const benefitOccurrences = await prisma.fringeBenefitOccurrence.findMany({
      where: {
        userId,
        earnedAt: {
          gte: periodFrom,
          lte: periodTo,
        },
      },
      select: { amount: true },
    })

    const paymentTransactions = await prisma.userFinancialTransaction.findMany({
      where: {
        userId,
        type: "PAYMENT",
        transactionDate: {
          gte: periodFrom,
          lte: periodTo,
        },
      },
      select: {
        amount: true,
        relatedType: true,
        transactionDate: true,
      },
    })

    const advancedTransactions = await prisma.userFinancialTransaction.findMany({
      where: {
        userId,
        type: "ADVANCE",
        transactionDate: {
          gte: periodFrom,
          lte: periodTo,
        },
      },
      select: { amount: true },
    })

    const maturedCompensation = periodCompEntries.reduce((sum, row) => sum + row.totalEarned, 0)
    const maturedFinderFees = finderFeeRollup.totalEarned
    const maturedManagementFees = managementFeeRollup.totalEarned
    const maturedBenefits = benefitOccurrences.reduce((sum, row) => sum + row.amount, 0)
    const monthlyEarnings =
      maturedCompensation +
      (embF ? 0 : maturedFinderFees) +
      (embM ? 0 : maturedManagementFees)
    const matured =
      maturedCompensation +
      (embF ? 0 : maturedFinderFees) +
      (embM ? 0 : maturedManagementFees) +
      maturedBenefits
    const advanced = advancedTransactions.reduce((sum, row) => sum + Math.abs(row.amount), 0)
    const reconciled = paymentTransactions.reduce((sum, row) => sum + Math.abs(row.amount), 0)
    const lastReconciledAt =
      paymentTransactions.length > 0
        ? paymentTransactions
            .map((row) => row.transactionDate)
            .sort((a, b) => b.getTime() - a.getTime())[0]
            ?.toISOString() || null
        : null

    const myOutstanding = outstandingAttribution.byUserId[userId] || {
      total: 0,
      finder: 0,
      management: 0,
      invoiceCount: 0,
    }

    let teamPendingAttribution: Array<{
      userId: string
      name: string
      email: string
      role: string
      outstanding: typeof myOutstanding
    }> | null = null

    if (teamSummary) {
      const staff = await prisma.user.findMany({
        where: { role: { not: UserRole.CLIENT } },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      })
      teamPendingAttribution = staff.map((u) => ({
        userId: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        outstanding:
          outstandingAttribution.byUserId[u.id] || {
            total: 0,
            finder: 0,
            management: 0,
            invoiceCount: 0,
          },
      }))
      teamPendingAttribution.sort(
        (a, b) => b.outstanding.total - a.outstanding.total
      )
    }

    const attributionSnapshotsEnabled = await supportsAttributionSnapshots()
    const pendingFinderAll = finderFeePendingAllTime.totalPending
    const pendingMgmtAll = managementFeePendingAllTime.totalPending
    const feePosition = {
      ledgerNet: balanceAllTime,
      /** Posted ledger + unpaid finder + unpaid management (company owes; not double-counted if fees post to ledger only when paid) */
      totalWithPendingFees: balanceAllTime + pendingFinderAll + pendingMgmtAll,
      pendingFinderPayout: pendingFinderAll,
      pendingManagementPayout: pendingMgmtAll,
      unpaidInvoiceAttributedTotal: myOutstanding.total,
    }

    return NextResponse.json({
      balance: balanceAllTime,
      ledgerNetInFilter,
      ytdEarnings,
      monthlyEarnings,
      totalAdvances,
      totalBenefits,
      compensation,
      advances,
      benefits: benefitsList,
      attributionSnapshotsEnabled,
      compEmbedsFinderInCompKpis: embF,
      compEmbedsManagementInCompKpis: embM,
      feePosition,
      receivables: {
        /** This user's share of firm receivables still outstanding (unpaid invoices), from locked attribution */
        outstandingAttributed: myOutstanding,
        /** Same basis as compensation: user's share on client-paid invoices in the reporting window */
        realizedAttributed: realizedAttribution,
        billsMissingAttribution: outstandingAttribution.billsWithoutSnapshot,
        reportingPeriod: {
          from: periodFrom.toISOString(),
          to: periodTo.toISOString(),
          isCustomRange: Boolean(startDate || endDate),
        },
        /** Finder/management fee `earnedAt` range for rollups in this response (includes current month by default) */
        feesReportingPeriod: {
          from: periodFrom.toISOString(),
          to: feeRollupEnd.toISOString(),
        },
      },
      ledgerByType,
      finderFeesRollup: finderFeeRollup,
      managementFeesRollup: managementFeeRollup,
      reconciliation: {
        matured: {
          total: matured,
          compensation: maturedCompensation,
          finderFees: maturedFinderFees,
          managementFees: maturedManagementFees,
          benefits: maturedBenefits,
        },
        advanced: {
          total: advanced,
        },
        reconciled: {
          total: reconciled,
          lastReconciledAt,
        },
        netBalance: balanceAllTime,
        companyOwesEmployee: Math.max(0, balanceAllTime),
        employeeOwesCompany: Math.max(0, -balanceAllTime),
        asOf: new Date().toISOString(),
      },
      teamPendingAttribution,
    })
  } catch (error: any) {
    console.error("Error fetching accounts summary:", error)
    return NextResponse.json(
      { error: error.message || "Failed to fetch accounts summary" },
      { status: 500 }
    )
  }
}
