import { BillAttributionRole, BillStatus, Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import { computeInvoiceNetAmountSync } from "./finder-fee-helpers"
import { managementFeeLineFromPool, managementFeePoolDollars } from "./management-fee-helpers"

/** Invoice statuses that still represent firm-side receivables (client not fully settled). */
const OUTSTANDING_BILL_STATUSES: BillStatus[] = [
  BillStatus.DRAFT,
  BillStatus.SUBMITTED,
  BillStatus.APPROVED,
]

/** `basisAmount` is invoice net (subtotal − discount − credits). Management rows: share of 10% pool, not of full net. */
export function attributedShareForRow(
  basisAmount: number,
  row: {
    role: BillAttributionRole
    splitPercent: number
    fixedAmount: number | null
  }
): number {
  if (
    row.role === BillAttributionRole.CLIENT_MANAGER ||
    row.role === BillAttributionRole.PROJECT_MANAGER
  ) {
    const pool = managementFeePoolDollars(basisAmount)
    return managementFeeLineFromPool(pool, row.splitPercent || 0, row.fixedAmount ?? 0)
  }
  return basisAmount * ((row.splitPercent || 0) / 100) + (row.fixedAmount || 0)
}

export async function supportsAttributionSnapshots(): Promise<boolean> {
  try {
    await prisma.bill.findFirst({
      include: { attributionSnapshots: { take: 1 } },
    } as any)
    return true
  } catch {
    return false
  }
}

export type UserAttributionBreakdown = {
  total: number
  finder: number
  management: number
  /** Invoices (bills) where this user has at least one attributed role */
  invoiceCount: number
}

/**
 * Sum attributed amounts on outstanding invoices, grouped by user.
 * Uses the latest attribution snapshot per bill (same basis as compensation helpers).
 */
export async function aggregateOutstandingAttributionByUser(options?: {
  /** Filter bills by createdAt (inclusive) */
  billCreatedFrom?: Date
  billCreatedTo?: Date
}): Promise<{
  byUserId: Record<string, UserAttributionBreakdown>
  billsWithoutSnapshot: number
}> {
  const snapOk = await supportsAttributionSnapshots()
  if (!snapOk) {
    return { byUserId: {}, billsWithoutSnapshot: 0 }
  }

  const bills = await prisma.bill.findMany({
    where: {
      deletedAt: null,
      status: { in: OUTSTANDING_BILL_STATUSES },
      ...(options?.billCreatedFrom || options?.billCreatedTo
        ? {
            createdAt: {
              ...(options.billCreatedFrom ? { gte: options.billCreatedFrom } : {}),
              ...(options.billCreatedTo ? { lte: options.billCreatedTo } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      amount: true,
      subtotal: true,
      discountPercent: true,
      discountAmount: true,
      items: {
        select: { amount: true, isCredit: true },
      },
      attributionSnapshots: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          rows: {
            select: {
              userId: true,
              role: true,
              splitPercent: true,
              fixedAmount: true,
            },
          },
        },
      },
    },
  })

  const byUserId: Record<string, UserAttributionBreakdown> = {}
  let billsWithoutSnapshot = 0

  const ensure = (userId: string): UserAttributionBreakdown => {
    if (!byUserId[userId]) {
      byUserId[userId] = { total: 0, finder: 0, management: 0, invoiceCount: 0 }
    }
    return byUserId[userId]
  }

  for (const bill of bills) {
    const snap = bill.attributionSnapshots[0]
    if (!snap?.rows?.length) {
      billsWithoutSnapshot++
      continue
    }

    const basisAmount = computeInvoiceNetAmountSync({
      subtotal: bill.subtotal,
      discountPercent: bill.discountPercent,
      discountAmount: bill.discountAmount,
      items: bill.items,
    })
    const perUser = new Map<
      string,
      { total: number; finder: number; management: number }
    >()

    for (const row of snap.rows) {
      const share = attributedShareForRow(basisAmount, row)
      if (share <= 0) continue

      const cur = perUser.get(row.userId) || { total: 0, finder: 0, management: 0 }
      cur.total += share
      if (row.role === BillAttributionRole.FINDER) {
        cur.finder += share
      }
      if (
        row.role === BillAttributionRole.CLIENT_MANAGER ||
        row.role === BillAttributionRole.PROJECT_MANAGER
      ) {
        cur.management += share
      }
      perUser.set(row.userId, cur)
    }

    for (const [userId, d] of perUser) {
      const agg = ensure(userId)
      agg.total += d.total
      agg.finder += d.finder
      agg.management += d.management
      agg.invoiceCount += 1
    }
  }

  return { byUserId, billsWithoutSnapshot }
}

/** Realized (client paid firm) attributed amounts for one user in a paidAt window. */
export async function realizedAttributionForUser(
  userId: string,
  paidFrom?: Date,
  paidTo?: Date
): Promise<{ total: number; finder: number; management: number; billCount: number }> {
  const snapOk = await supportsAttributionSnapshots()
  if (!snapOk) {
    return { total: 0, finder: 0, management: 0, billCount: 0 }
  }

  const paidFilter: Prisma.DateTimeFilter = {}
  if (paidFrom) paidFilter.gte = paidFrom
  if (paidTo) paidFilter.lte = paidTo

  const bills = await prisma.bill.findMany({
    where: {
      deletedAt: null,
      status: BillStatus.PAID,
      ...(paidFrom || paidTo ? { paidAt: paidFilter } : {}),
    },
    select: {
      id: true,
      amount: true,
      subtotal: true,
      discountPercent: true,
      discountAmount: true,
      items: {
        select: { amount: true, isCredit: true },
      },
      attributionSnapshots: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          rows: {
            where: { userId },
            select: {
              role: true,
              splitPercent: true,
              fixedAmount: true,
            },
          },
        },
      },
    },
  })

  let total = 0
  let finder = 0
  let management = 0
  let billCount = 0

  for (const bill of bills) {
    const rows = bill.attributionSnapshots[0]?.rows || []
    if (!rows.length) continue
    const basisAmount = computeInvoiceNetAmountSync({
      subtotal: bill.subtotal,
      discountPercent: bill.discountPercent,
      discountAmount: bill.discountAmount,
      items: bill.items,
    })
    let billSum = 0
    for (const row of rows) {
      const share = attributedShareForRow(basisAmount, row)
      billSum += share
      if (row.role === BillAttributionRole.FINDER) finder += share
      if (
        row.role === BillAttributionRole.CLIENT_MANAGER ||
        row.role === BillAttributionRole.PROJECT_MANAGER
      ) {
        management += share
      }
    }
    if (billSum > 0) {
      total += billSum
      billCount += 1
    }
  }

  return { total, finder, management, billCount }
}

export async function ledgerRollupByType(
  userId: string,
  dateFrom?: Date,
  dateTo?: Date
): Promise<Partial<Record<string, number>>> {
  const where: Prisma.UserFinancialTransactionWhereInput = { userId }
  if (dateFrom || dateTo) {
    where.transactionDate = {}
    if (dateFrom) where.transactionDate.gte = dateFrom
    if (dateTo) where.transactionDate.lte = dateTo
  }

  const grouped = await prisma.userFinancialTransaction.groupBy({
    by: ["type"],
    where,
    _sum: { amount: true },
  })

  const out: Partial<Record<string, number>> = {}
  for (const g of grouped) {
    out[g.type] = g._sum.amount ?? 0
  }
  return out
}

export async function finderFeeRollupForUser(
  userId: string,
  earnedFrom?: Date,
  earnedTo?: Date
): Promise<{
  totalEarned: number
  totalPaidOut: number
  totalPending: number
  count: number
}> {
  const earnedAt: Prisma.DateTimeFilter = {}
  if (earnedFrom) earnedAt.gte = earnedFrom
  if (earnedTo) earnedAt.lte = earnedTo

  const where: Prisma.FinderFeeWhereInput = {
    finderId: userId,
    ...(earnedFrom || earnedTo ? { earnedAt } : {}),
  }

  const agg = await prisma.finderFee.aggregate({
    where,
    _sum: {
      finderFeeAmount: true,
      paidAmount: true,
      remainingAmount: true,
    },
    _count: true,
  })

  return {
    totalEarned: agg._sum.finderFeeAmount ?? 0,
    totalPaidOut: agg._sum.paidAmount ?? 0,
    totalPending: agg._sum.remainingAmount ?? 0,
    count: agg._count,
  }
}
