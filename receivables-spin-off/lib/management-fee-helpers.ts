import {
  BillAttributionRole,
  BillStatus,
  ManagementFeeRole,
  Prisma,
} from "@prisma/client"
import { prisma } from "./prisma"
import { calculateInvoiceNetAmount } from "./finder-fee-helpers"

/** Management fee pool is at most this % of invoice net; split% on a row is share of this pool. */
export const MANAGEMENT_FEE_POOL_MAX_PERCENT = 10

export function managementFeePoolDollars(invoiceNet: number): number {
  return (Math.max(0, invoiceNet) * MANAGEMENT_FEE_POOL_MAX_PERCENT) / 100
}

type ManagementBaseParts = {
  subtotal: number | null
  discountPercent: number | null
  discountAmount: number | null
  items: Array<{ amount: number; isCredit: boolean }>
}

/**
 * Management fee base = invoiced amount before tax, after discount.
 * Credit/reimbursement lines are NOT subtracted from this base.
 */
export function computeManagementFeeBaseSync(bill: ManagementBaseParts): number {
  let subtotal = bill.subtotal || 0
  if (subtotal === 0) {
    subtotal = bill.items
      .filter((item) => !item.isCredit)
      .reduce((sum, item) => sum + item.amount, 0)
  }

  let discountValue = 0
  if (bill.discountPercent && bill.discountPercent > 0) {
    discountValue = (subtotal * bill.discountPercent) / 100
  } else if (bill.discountAmount && bill.discountAmount > 0) {
    discountValue = bill.discountAmount
  }

  return Math.max(0, subtotal - discountValue)
}

export async function calculateManagementFeeBaseAmount(billId: string): Promise<number> {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: { items: true },
  })

  if (!bill) throw new Error("Invoice not found")

  return computeManagementFeeBaseSync({
    subtotal: bill.subtotal,
    discountPercent: bill.discountPercent,
    discountAmount: bill.discountAmount,
    items: bill.items.map((i) => ({ amount: i.amount, isCredit: i.isCredit })),
  })
}

/**
 * @param poolDollars — typically 10% of net (see {@link managementFeePoolDollars}).
 * @param rowSplitPercent — share of that pool (0–100); 100% = full 10% of net in euros.
 */
export function managementFeeLineFromPool(
  poolDollars: number,
  rowSplitPercent: number,
  rowFixed: number
): number {
  return (poolDollars * (rowSplitPercent || 0)) / 100 + (rowFixed ?? 0)
}

function roleToManagementFeeRole(role: BillAttributionRole): ManagementFeeRole | null {
  if (role === BillAttributionRole.CLIENT_MANAGER) return ManagementFeeRole.CLIENT_MANAGER
  if (role === BillAttributionRole.PROJECT_MANAGER) return ManagementFeeRole.PROJECT_MANAGER
  return null
}

/**
 * When an invoice is PAID, create management fee lines for CLIENT_MANAGER / PROJECT_MANAGER
 * snapshot rows. Pool = 10% of net; each row is a % of that pool (100% = full 10% of net).
 */
export async function calculateAndCreateManagementFees(billId: string): Promise<void> {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      client: true,
      attributionSnapshots: {
        orderBy: { version: "desc" },
        take: 1,
        include: { rows: true },
      },
    },
  })

  if (!bill || bill.status !== BillStatus.PAID || !bill.paidAt) {
    throw new Error("Invoice is not paid")
  }

  if (!bill.clientId || !bill.client) {
    return
  }

  const snapshot = bill.attributionSnapshots[0]
  const rows = (snapshot?.rows || []).filter(
    (r) =>
      r.role === BillAttributionRole.CLIENT_MANAGER || r.role === BillAttributionRole.PROJECT_MANAGER
  )
  if (rows.length === 0) {
    return
  }

  const netAmount = await calculateInvoiceNetAmount(billId)
  const managementBaseAmount = await calculateManagementFeeBaseAmount(billId)
  if (managementBaseAmount <= 0) {
    return
  }

  const earnedAt = bill.paidAt
  const poolDollars = managementFeePoolDollars(managementBaseAmount)

  type Agg = { base: number; role: ManagementFeeRole }
  const byRecipient = new Map<string, Agg>()
  for (const row of rows) {
    const mfRole = roleToManagementFeeRole(row.role)
    if (!mfRole) continue
    const key = `${row.userId}|${mfRole}`
    const base = managementFeeLineFromPool(
      poolDollars,
      row.splitPercent || 0,
      row.fixedAmount ?? 0
    )
    const prev = byRecipient.get(key)
    if (prev) {
      prev.base += base
    } else {
      byRecipient.set(key, { base, role: mfRole })
    }
  }

  for (const [compoundKey, { base, role }] of byRecipient) {
    const recipientUserId = compoundKey.split("|")[0]
    if (base <= 0) continue

    const existingLine = await prisma.managementFee.findUnique({
      where: {
        billId_recipientUserId_role: {
          billId: bill.id,
          recipientUserId,
          role,
        },
      },
      select: { id: true },
    })
    if (existingLine) continue

    const feeAmount = base

    await prisma.managementFee.create({
      data: {
        billId: bill.id,
        clientId: bill.clientId,
        recipientUserId,
        role,
        invoiceNetAmount: managementBaseAmount,
        attributionBaseAmount: base,
        compensationPercentApplied: MANAGEMENT_FEE_POOL_MAX_PERCENT,
        feeAmount,
        remainingAmount: feeAmount,
        earnedAt,
        status: "PENDING",
      },
    })
  }
}

export async function getManagementFeesForUser(
  userId: string,
  options?: {
    status?: "PENDING" | "PARTIALLY_PAID" | "PAID"
    clientId?: string
    startDate?: Date
    endDate?: Date
  }
) {
  const where: Prisma.ManagementFeeWhereInput = {
    recipientUserId: userId,
  }

  if (options?.status) {
    where.status = options.status
  }

  if (options?.clientId) {
    where.clientId = options.clientId
  }

  if (options?.startDate || options?.endDate) {
    where.earnedAt = {}
    if (options.startDate) where.earnedAt.gte = options.startDate
    if (options.endDate) where.earnedAt.lte = options.endDate
  }

  return prisma.managementFee.findMany({
    where,
    include: {
      bill: {
        select: {
          id: true,
          invoiceNumber: true,
          amount: true,
          paidAt: true,
        },
      },
      client: {
        select: {
          id: true,
          name: true,
          company: true,
        },
      },
      payments: {
        orderBy: { paymentDate: "desc" },
      },
    },
    orderBy: { earnedAt: "desc" },
  })
}

export async function managementFeeRollupForUser(
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

  const where: Prisma.ManagementFeeWhereInput = {
    recipientUserId: userId,
    ...(earnedFrom || earnedTo ? { earnedAt } : {}),
  }

  const agg = await prisma.managementFee.aggregate({
    where,
    _sum: {
      feeAmount: true,
      paidAmount: true,
      remainingAmount: true,
    },
    _count: true,
  })

  return {
    totalEarned: agg._sum.feeAmount ?? 0,
    totalPaidOut: agg._sum.paidAmount ?? 0,
    totalPending: agg._sum.remainingAmount ?? 0,
    count: agg._count,
  }
}
