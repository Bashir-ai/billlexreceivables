import { prisma } from "@/lib/prisma"

export type InvoicePercentagePayoutRow = {
  id: string
  billId: string
  userId: string
  amount: number
  notes: string | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export function supportsInvoicePercentagePayouts(): boolean {
  try {
    const model = (prisma as any)?._runtimeDataModel?.models?.InvoicePercentagePayout
    const fields = model?.fields
    return Array.isArray(fields) && fields.length > 0
  } catch {
    return false
  }
}

export async function sumInvoiceLinkedPercentagePayouts(billId: string): Promise<number> {
  if (!supportsInvoicePercentagePayouts()) return 0
  const agg = await (prisma as any).invoicePercentagePayout.aggregate({
    where: { billId },
    _sum: { amount: true },
  })
  return Number(agg?._sum?.amount ?? 0) || 0
}

export async function mapInvoiceLinkedPercentagePayoutTotals(
  billIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!supportsInvoicePercentagePayouts() || billIds.length === 0) return out

  const rows = await (prisma as any).invoicePercentagePayout.groupBy({
    by: ["billId"],
    where: { billId: { in: billIds } },
    _sum: { amount: true },
  })

  for (const row of rows || []) {
    out.set(String(row.billId), Number(row?._sum?.amount ?? 0) || 0)
  }
  return out
}

