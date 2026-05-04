import { UserRole } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getOutstandingInvoices } from "@/lib/invoice-helpers"
import { getOutstandingInvoiceRecipients } from "@/lib/invoice-notifications"

export const OPS_TAG_COLLECTIONS = "collections"
export const OPS_TAG_PAYROLL = "payroll"
export const PAYROLL_EPSILON = 0.005

export type CollectionAgeBucket = "0_30" | "31_60" | "61_PLUS"

export function daysPastDue(dueDate: Date, now = new Date()): number {
  const d = new Date(dueDate)
  const ms = now.getTime() - d.getTime()
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}

export function collectionAgeBucket(days: number): CollectionAgeBucket {
  if (days <= 30) return "0_30"
  if (days <= 60) return "31_60"
  return "61_PLUS"
}

export function canViewPayrollOps(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.MANAGER
}

export async function filterOutstandingInvoicesForUser(userId: string, role: UserRole) {
  const all = await getOutstandingInvoices()
  if (role === UserRole.ADMIN || role === UserRole.MANAGER) {
    return all
  }
  const out: typeof all = []
  for (const inv of all) {
    const recipients = await getOutstandingInvoiceRecipients(inv as any)
    if (recipients.includes(userId)) out.push(inv)
  }
  return out
}

export async function getOperationsCounts(userId: string, role: UserRole) {
  const collections = await filterOutstandingInvoicesForUser(userId, role)
  let payrollCount = 0
  if (canViewPayrollOps(role)) {
    payrollCount = await prisma.compensationEntry.count({
      where: { balance: { gt: PAYROLL_EPSILON } },
    })
  }
  return { collectionsCount: collections.length, payrollCount }
}

export async function ensureOpsTodoTags() {
  await prisma.$transaction(async (tx) => {
    await tx.todoTag.upsert({
      where: { name: OPS_TAG_COLLECTIONS },
      create: {
        name: OPS_TAG_COLLECTIONS,
        description: "Follow-ups on overdue / outstanding collections",
        color: "#0369a1",
      },
      update: {},
    })
    await tx.todoTag.upsert({
      where: { name: OPS_TAG_PAYROLL },
      create: {
        name: OPS_TAG_PAYROLL,
        description: "Payroll amounts due to employees",
        color: "#b45309",
      },
      update: {},
    })
  })

  const tags = await prisma.todoTag.findMany({
    where: { name: { in: [OPS_TAG_COLLECTIONS, OPS_TAG_PAYROLL] } },
  })
  const map = Object.fromEntries(tags.map((t) => [t.name, t]))
  return {
    collectionsTagId: map[OPS_TAG_COLLECTIONS]?.id,
    payrollTagId: map[OPS_TAG_PAYROLL]?.id,
  }
}
