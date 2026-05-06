import {
  BillAttributionRole,
  BillStatus,
  FinderFeeStatus,
  ManagementAttributionRole,
  ManagementFeeRole,
} from "@prisma/client"
import { prisma } from "./prisma"
import { calculateInvoiceNetAmount } from "./finder-fee-helpers"
import {
  MANAGEMENT_FEE_POOL_MAX_PERCENT,
  managementFeeLineFromPool,
  managementFeePoolDollars,
} from "./management-fee-helpers"

function resolveFeeLineStatus(paid: number, remaining: number): FinderFeeStatus {
  if (remaining <= 0.0001) return FinderFeeStatus.PAID
  if (paid > 0.0001) return FinderFeeStatus.PARTIALLY_PAID
  return FinderFeeStatus.PENDING
}

type FinderRow = {
  userId: string
  splitPercent: number
  fixedAmount: number
  sourceClientFinderId: string | null
}

type MgmtRow = {
  userId: string
  role: ManagementFeeRole
  splitPercent: number
  fixedAmount: number
}

async function ensureClientFinderId(clientId: string, userId: string, splitPercent: number): Promise<string> {
  const existing = await prisma.clientFinder.findFirst({
    where: { clientId, userId },
    select: { id: true },
  })
  if (existing) return existing.id
  const created = await prisma.clientFinder.create({
    data: { clientId, userId, finderFeePercent: splitPercent },
    select: { id: true },
  })
  return created.id
}

function rowRoleToManagementFeeRole(
  role: BillAttributionRole | ManagementAttributionRole
): ManagementFeeRole | null {
  const roleValue = String(role)
  if (roleValue === "CLIENT_MANAGER") {
    return ManagementFeeRole.CLIENT_MANAGER
  }
  if (roleValue === "PROJECT_MANAGER") {
    return ManagementFeeRole.PROJECT_MANAGER
  }
  return null
}

/**
 * After invoice totals or line items change on a PAID bill, recompute finder and management fee
 * lines from the current net and latest attribution snapshot. Preserves recorded payouts.
 */
export async function resyncFinderAndManagementFeesForPaidBill(billId: string): Promise<void> {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    select: { id: true, status: true, paidAt: true, clientId: true },
  })
  if (!bill || bill.status !== BillStatus.PAID || !bill.paidAt) {
    return
  }
  if (!bill.clientId) return

  const net = await calculateInvoiceNetAmount(billId)

  const snapshot = await prisma.billAttributionSnapshot.findFirst({
    where: { billId },
    orderBy: { version: "desc" },
    include: { rows: true },
  })
  if (!snapshot?.rows?.length) {
    // We can still derive rows from the current client rules below.
  }

  const clientRules = await prisma.client.findUnique({
    where: { id: bill.clientId },
    select: {
      id: true,
      clientManagerId: true,
      finders: {
        select: { id: true, userId: true, finderFeePercent: true },
      },
      managementSplits: {
        select: { userId: true, role: true, splitPercent: true, fixedAmount: true },
      },
    },
  })
  if (!clientRules) return

  const finderRowMap = new Map<string, FinderRow>()
  for (const row of snapshot?.rows || []) {
    if (row.role !== BillAttributionRole.FINDER) continue
    const key = row.userId
    finderRowMap.set(key, {
      userId: row.userId,
      splitPercent: row.splitPercent || 0,
      fixedAmount: row.fixedAmount ?? 0,
      sourceClientFinderId: row.sourceClientFinderId ?? null,
    })
  }
  // Include current client rules for recipients that did not exist in the locked snapshot
  for (const finder of clientRules.finders) {
    if (!finderRowMap.has(finder.userId)) {
      finderRowMap.set(finder.userId, {
        userId: finder.userId,
        splitPercent: finder.finderFeePercent || 0,
        fixedAmount: 0,
        sourceClientFinderId: finder.id,
      })
    }
  }
  const finderRows = Array.from(finderRowMap.values())
  const finderFees = await prisma.finderFee.findMany({ where: { billId } })
  const existingFinderByUser = new Map(finderFees.map((f) => [f.finderId, f]))

  for (const row of finderRows) {
    const split = row.splitPercent || 0
    const fixed = row.fixedAmount ?? 0
    if (split <= 0 && fixed <= 0) continue
    const rawNew = (net * split) / 100 + fixed
    const existing = existingFinderByUser.get(row.userId)
    const paid = existing?.paidAmount ?? 0
    const newFinderFeeAmount = Math.max(rawNew, paid)
    const newRemaining = Math.max(0, newFinderFeeAmount - paid)
    const newStatus = resolveFeeLineStatus(paid, newRemaining)
    const clientFinderId =
      row.sourceClientFinderId ??
      (await ensureClientFinderId(clientRules.id, row.userId, split))

    if (existing) {
      await prisma.finderFee.update({
        where: { id: existing.id },
        data: {
          clientFinderId,
          invoiceNetAmount: net,
          finderFeePercent: split,
          finderFeeAmount: newFinderFeeAmount,
          remainingAmount: newRemaining,
          status: newStatus,
          paidAt: newStatus === FinderFeeStatus.PAID ? existing.paidAt ?? new Date() : null,
        },
      })
    } else {
      await prisma.finderFee.create({
        data: {
          billId,
          clientId: clientRules.id,
          finderId: row.userId,
          clientFinderId,
          invoiceNetAmount: net,
          finderFeePercent: split,
          finderFeeAmount: newFinderFeeAmount,
          remainingAmount: newRemaining,
          paidAmount: paid,
          earnedAt: bill.paidAt,
          status: newStatus,
          paidAt: newStatus === FinderFeeStatus.PAID ? new Date() : null,
        },
      })
    }
  }

  const mgmtMap = new Map<string, MgmtRow>()
  for (const row of snapshot?.rows || []) {
    const role = rowRoleToManagementFeeRole(row.role)
    if (!role) continue
    const key = `${row.userId}|${role}`
    mgmtMap.set(key, {
      userId: row.userId,
      role,
      splitPercent: row.splitPercent || 0,
      fixedAmount: row.fixedAmount ?? 0,
    })
  }
  for (const split of clientRules.managementSplits) {
    const role = rowRoleToManagementFeeRole(split.role)
    if (!role) continue
    const key = `${split.userId}|${role}`
    if (!mgmtMap.has(key)) {
      mgmtMap.set(key, {
        userId: split.userId,
        role,
        splitPercent: split.splitPercent || 0,
        fixedAmount: split.fixedAmount ?? 0,
      })
    }
  }
  if (clientRules.clientManagerId) {
    const key = `${clientRules.clientManagerId}|${ManagementFeeRole.CLIENT_MANAGER}`
    if (!mgmtMap.has(key)) {
      mgmtMap.set(key, {
        userId: clientRules.clientManagerId,
        role: ManagementFeeRole.CLIENT_MANAGER,
        splitPercent: 100,
        fixedAmount: 0,
      })
    }
  }

  const poolDollars = managementFeePoolDollars(net)
  const byRecipient = new Map<string, { base: number; role: ManagementFeeRole }>()
  for (const row of mgmtMap.values()) {
    const key = `${row.userId}|${row.role}`
    const piece = managementFeeLineFromPool(
      poolDollars,
      row.splitPercent || 0,
      row.fixedAmount ?? 0
    )
    const prev = byRecipient.get(key)
    if (prev) {
      prev.base += piece
    } else {
      byRecipient.set(key, { base: piece, role: row.role })
    }
  }

  const managementFees = await prisma.managementFee.findMany({ where: { billId } })
  const existingMgmtByKey = new Map(
    managementFees.map((f) => [`${f.recipientUserId}|${f.role}`, f])
  )
  for (const [key, match] of byRecipient.entries()) {
    if (!match || match.base <= 0) continue
    const rawFee = match.base
    const existing = existingMgmtByKey.get(key)
    const paid = existing?.paidAmount ?? 0
    const newFeeAmount = Math.max(rawFee, paid)
    const newRemaining = Math.max(0, newFeeAmount - paid)
    const newStatus = resolveFeeLineStatus(paid, newRemaining)
    const recipientUserId = key.split("|")[0]

    if (existing) {
      await prisma.managementFee.update({
        where: { id: existing.id },
        data: {
          invoiceNetAmount: net,
          attributionBaseAmount: match.base,
          compensationPercentApplied: MANAGEMENT_FEE_POOL_MAX_PERCENT,
          feeAmount: newFeeAmount,
          remainingAmount: newRemaining,
          status: newStatus,
          paidAt: newStatus === FinderFeeStatus.PAID ? existing.paidAt ?? new Date() : null,
        },
      })
    } else {
      await prisma.managementFee.create({
        data: {
          billId,
          clientId: clientRules.id,
          recipientUserId,
          role: match.role,
          invoiceNetAmount: net,
          attributionBaseAmount: match.base,
          compensationPercentApplied: MANAGEMENT_FEE_POOL_MAX_PERCENT,
          feeAmount: newFeeAmount,
          status: newStatus,
          paidAmount: paid,
          remainingAmount: newRemaining,
          earnedAt: bill.paidAt,
          paidAt: newStatus === FinderFeeStatus.PAID ? new Date() : null,
        },
      })
    }
  }
}

/**
 * Recompute fee lines for recent paid invoices of a client after client-level finder/management rules change.
 */
export async function resyncFinderAndManagementFeesForClientPaidBills(
  clientId: string,
  maxBills = Number(process.env.FEE_BACKFILL_MAX_BILLS ?? 200)
): Promise<{ scannedBills: number }> {
  const paidBills = await prisma.bill.findMany({
    where: { clientId, status: BillStatus.PAID, paidAt: { not: null }, deletedAt: null },
    orderBy: { paidAt: "desc" },
    take: Math.max(1, maxBills),
    select: { id: true },
  })

  for (const bill of paidBills) {
    await resyncFinderAndManagementFeesForPaidBill(bill.id)
  }

  return { scannedBills: paidBills.length }
}
