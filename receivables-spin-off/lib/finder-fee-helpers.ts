import { prisma } from "./prisma"
import { BillAttributionRole, BillStatus } from "@prisma/client"

type BillNetParts = {
  subtotal: number | null
  discountPercent: number | null
  discountAmount: number | null
  items: Array<{ amount: number; isCredit: boolean }>
}

/**
 * Net for finder / management attribution (subtotal − discount − credit items). Excludes tax.
 * Same basis as finder fees and management fee creation.
 */
export function computeInvoiceNetAmountSync(bill: BillNetParts): number {
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

  const afterDiscount = subtotal - discountValue

  const expenseReimbursements = bill.items
    .filter((item) => item.isCredit)
    .reduce((sum, item) => sum + Math.abs(item.amount), 0)

  const netAmount = afterDiscount - expenseReimbursements
  return Math.max(0, netAmount)
}

/**
 * Calculate the net invoice amount for finder fees (original amount minus discounts, NO taxes)
 * Net = Subtotal - Discount - Expense Reimbursements
 * Taxes are NOT included in the calculation
 */
export async function calculateInvoiceNetAmount(billId: string): Promise<number> {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      items: true,
    },
  })

  if (!bill) {
    throw new Error("Invoice not found")
  }

  return computeInvoiceNetAmountSync({
    subtotal: bill.subtotal,
    discountPercent: bill.discountPercent,
    discountAmount: bill.discountAmount,
    items: bill.items.map((i) => ({ amount: i.amount, isCredit: i.isCredit })),
  })
}

/**
 * Calculate and create finder fees for an invoice when it's paid
 */
export async function calculateAndCreateFinderFees(billId: string): Promise<void> {
  let supportsAttributionSnapshots = false
  try {
    await prisma.bill.findFirst({
      include: {
        attributionSnapshots: {
          take: 1,
        },
      },
    } as any)
    supportsAttributionSnapshots = true
  } catch {
    supportsAttributionSnapshots = false
  }

  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      client: {
        include: {
          finders: true,
        },
      },
      ...(supportsAttributionSnapshots
        ? {
            attributionSnapshots: {
              orderBy: { version: "desc" },
              take: 1,
              include: { rows: true },
            },
          }
        : {}),
    },
  } as any)

  if (!bill) {
    throw new Error("Invoice not found")
  }

  const b = bill as typeof bill & {
    client: {
      id: string
      finders: Array<{ id: string; userId: string; finderFeePercent: number }>
    } | null
    attributionSnapshots?: Array<{ rows: Array<Record<string, unknown>> }>
  }

  // Check if invoice is paid
  if (b.status !== BillStatus.PAID || !b.paidAt) {
    throw new Error("Invoice is not paid")
  }

  // Check if finder fees already exist
  const existingFees = await prisma.finderFee.findMany({
    where: { billId },
  })

  if (existingFees.length > 0) {
    // Finder fees already calculated
    return
  }

  // Finder fees only apply to clients, not leads
  if (!b.client) {
    // No client, nothing to calculate
    return
  }

  // Store client in a variable so TypeScript knows it's not null
  const client = b.client

  // Use locked attribution snapshot rows for deterministic finder payouts.
  const snapshot = b.attributionSnapshots?.[0]
  const snapshotFinders = ((snapshot?.rows || []) as Array<Record<string, unknown>>).filter(
    (row) => row.role === BillAttributionRole.FINDER
  )
  const fallbackFinders = (b.client?.finders || []).map((finder) => ({
    userId: finder.userId,
    splitPercent: finder.finderFeePercent || 0,
    fixedAmount: 0,
    sourceClientFinderId: finder.id,
  }))
  const effectiveFinders = snapshotFinders.length > 0
    ? snapshotFinders
    : fallbackFinders

  if (effectiveFinders.length === 0) {
    // No finders, nothing to calculate
    return
  }

  // Calculate net invoice amount
  const netAmount = await calculateInvoiceNetAmount(billId)

  if (netAmount <= 0) {
    // No net amount, nothing to calculate
    return
  }

  // Create finder fees for each finder
  const finderFees = await Promise.all(
    effectiveFinders.map(async (snapshotFinder: Record<string, unknown>) => {
      const splitPct = Number(snapshotFinder.splitPercent) || 0
      if (splitPct <= 0) {
        return null // Skip finders with 0% fee
      }

      const finderFeeAmount =
        (netAmount * splitPct) / 100 + Number(snapshotFinder.fixedAmount || 0)
      const snapshotUserId = snapshotFinder.userId as string
      let sourceClientFinderId =
        (snapshotFinder.sourceClientFinderId as string | undefined) ||
        (
          await prisma.clientFinder.findFirst({
            where: { clientId: client.id, userId: snapshotUserId },
            select: { id: true },
          })
        )?.id

      if (!sourceClientFinderId) {
        const created = await prisma.clientFinder.create({
          data: {
            clientId: client.id,
            userId: snapshotUserId,
            finderFeePercent: splitPct,
          },
          select: { id: true },
        })
        sourceClientFinderId = created.id
      }

      return prisma.finderFee.create({
        data: {
          billId: b.id,
          clientId: client.id, // Use client.id since we've already verified client exists
          finderId: snapshotFinder.userId as string,
          clientFinderId: sourceClientFinderId,
          invoiceNetAmount: netAmount,
          finderFeePercent: splitPct,
          finderFeeAmount: finderFeeAmount,
          remainingAmount: finderFeeAmount,
          earnedAt: b.paidAt!,
          status: "PENDING",
        },
      })
    })
  )

  // Filter out nulls (finders with 0% fee)
  const createdFees = finderFees.filter(
    (fee): fee is NonNullable<(typeof finderFees)[number]> => fee !== null
  )

  return
}

/**
 * Get finder fees for a user
 */
export async function getFinderFeesForUser(
  userId: string,
  options?: {
    status?: "PENDING" | "PARTIALLY_PAID" | "PAID"
    clientId?: string
    startDate?: Date
    endDate?: Date
  }
) {
  const where: any = {
    finderId: userId,
  }

  if (options?.status) {
    where.status = options.status
  }

  if (options?.clientId) {
    where.clientId = options.clientId
  }

  if (options?.startDate || options?.endDate) {
    where.earnedAt = {}
    if (options.startDate) {
      where.earnedAt.gte = options.startDate
    }
    if (options.endDate) {
      where.earnedAt.lte = options.endDate
    }
  }

  return prisma.finderFee.findMany({
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
        orderBy: {
          paymentDate: "desc",
        },
      },
    },
    orderBy: {
      earnedAt: "desc",
    },
  })
}

