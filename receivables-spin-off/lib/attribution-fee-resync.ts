import {
  BillAttributionRole,
  BillStatus,
  FinderFeeStatus,
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

/**
 * After invoice totals or line items change on a PAID bill, recompute finder and management fee
 * lines from the current net and latest attribution snapshot. Preserves recorded payouts.
 */
export async function resyncFinderAndManagementFeesForPaidBill(billId: string): Promise<void> {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    select: { id: true, status: true, paidAt: true },
  })
  if (!bill || bill.status !== BillStatus.PAID || !bill.paidAt) {
    return
  }

  const net = await calculateInvoiceNetAmount(billId)

  const snapshot = await prisma.billAttributionSnapshot.findFirst({
    where: { billId },
    orderBy: { version: "desc" },
    include: { rows: true },
  })
  if (!snapshot?.rows?.length) {
    return
  }

  const finderRows = snapshot.rows.filter((r) => r.role === BillAttributionRole.FINDER)
  const finderFees = await prisma.finderFee.findMany({ where: { billId } })

  for (const fee of finderFees) {
    const row = finderRows.find((r) => r.userId === fee.finderId)
    if (!row) continue

    const split = row.splitPercent || 0
    const fixed = row.fixedAmount ?? 0
    const rawNew = (net * split) / 100 + fixed
    const paid = fee.paidAmount
    const newFinderFeeAmount = Math.max(rawNew, paid)
    const newRemaining = Math.max(0, newFinderFeeAmount - paid)
    const newStatus = resolveFeeLineStatus(paid, newRemaining)

    await prisma.finderFee.update({
      where: { id: fee.id },
      data: {
        invoiceNetAmount: net,
        finderFeePercent: split,
        finderFeeAmount: newFinderFeeAmount,
        remainingAmount: newRemaining,
        status: newStatus,
        paidAt: newStatus === FinderFeeStatus.PAID ? fee.paidAt ?? new Date() : null,
      },
    })
  }

  const mgmtRows = snapshot.rows.filter(
    (r) =>
      r.role === BillAttributionRole.CLIENT_MANAGER || r.role === BillAttributionRole.PROJECT_MANAGER
  )
  const poolDollars = managementFeePoolDollars(net)
  const byRecipient = new Map<string, { base: number; role: ManagementFeeRole }>()
  for (const row of mgmtRows) {
    const role =
      row.role === BillAttributionRole.CLIENT_MANAGER
        ? ManagementFeeRole.CLIENT_MANAGER
        : ManagementFeeRole.PROJECT_MANAGER
    const key = `${row.userId}|${role}`
    const piece = managementFeeLineFromPool(
      poolDollars,
      row.splitPercent || 0,
      row.fixedAmount ?? 0
    )
    const prev = byRecipient.get(key)
    if (prev) {
      prev.base += piece
    } else {
      byRecipient.set(key, { base: piece, role })
    }
  }

  const managementFees = await prisma.managementFee.findMany({ where: { billId } })
  for (const fee of managementFees) {
    const key = `${fee.recipientUserId}|${fee.role}`
    const match = byRecipient.get(key)
    if (!match || match.base <= 0) continue

    const rawFee = match.base
    const paid = fee.paidAmount
    const newFeeAmount = Math.max(rawFee, paid)
    const newRemaining = Math.max(0, newFeeAmount - paid)
    const newStatus = resolveFeeLineStatus(paid, newRemaining)

    await prisma.managementFee.update({
      where: { id: fee.id },
      data: {
        invoiceNetAmount: net,
        attributionBaseAmount: match.base,
        compensationPercentApplied: MANAGEMENT_FEE_POOL_MAX_PERCENT,
        feeAmount: newFeeAmount,
        remainingAmount: newRemaining,
        status: newStatus,
        paidAt: newStatus === FinderFeeStatus.PAID ? fee.paidAt ?? new Date() : null,
      },
    })
  }
}
