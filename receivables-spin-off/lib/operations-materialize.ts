import { TodoPriority } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getOutstandingInvoices } from "@/lib/invoice-helpers"
import { ensureOpsTodoTags, OPS_TAG_COLLECTIONS, OPS_TAG_PAYROLL, PAYROLL_EPSILON } from "@/lib/operations"

async function resolveAdminUserId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  return admin?.id ?? null
}

async function resolveAssigneeForInvoice(bill: {
  client: {
    clientManagerId: string | null
    finders?: Array<{ user: { id: string } }>
  }
  project?: {
    projectManagers?: Array<{ user: { id: string } }>
  } | null
}, fallbackAssigneeId: string): Promise<string> {
  if (bill.client.clientManagerId) return bill.client.clientManagerId
  const finder = bill.client.finders?.[0]?.user?.id
  if (finder) return finder
  const pm = bill.project?.projectManagers?.[0]?.user?.id
  if (pm) return pm
  return fallbackAssigneeId
}

export async function materializeCollectionsTodos(): Promise<{
  created: number
  skipped: number
}> {
  const adminId = await resolveAdminUserId()
  if (!adminId) throw new Error("No admin user for todo attribution")

  const { collectionsTagId } = await ensureOpsTodoTags()
  if (!collectionsTagId) throw new Error("Missing collections tag")

  const bills = await getOutstandingInvoices()
  let created = 0
  let skipped = 0

  for (const bill of bills) {
    const assignee = await resolveAssigneeForInvoice(bill as any, adminId)
    const title = `Follow up invoice ${bill.invoiceNumber || bill.id.slice(0, 8)}`
    const billMarker = `ops:bill:${bill.id}`
    const exists = await prisma.todo.findFirst({
      where: {
        invoiceId: bill.id,
        status: { not: "COMPLETED" },
        tags: { some: { id: collectionsTagId } },
      },
      select: { id: true },
    })
    if (exists) {
      skipped++
      continue
    }
    const clientLabel = bill.client?.name || bill.lead?.name || "Client"
    await prisma.todo.create({
      data: {
        title,
        description: `${billMarker}\nOutstanding / overdue invoice — ${clientLabel}`,
        invoiceId: bill.id,
        clientId: bill.clientId ?? undefined,
        leadId: bill.leadId ?? undefined,
        assignedTo: assignee,
        createdBy: adminId,
        priority: TodoPriority.HIGH,
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        tags: { connect: [{ id: collectionsTagId }] },
      },
    })
    created++
  }

  return { created, skipped }
}

export async function materializePayrollTodos(): Promise<{ created: number; skipped: number }> {
  const adminId = await resolveAdminUserId()
  if (!adminId) throw new Error("No admin user for todo attribution")

  const { payrollTagId } = await ensureOpsTodoTags()
  if (!payrollTagId) throw new Error("Missing payroll tag")

  const entries = await prisma.compensationEntry.findMany({
    where: { balance: { gt: PAYROLL_EPSILON } },
    include: {
      user: { select: { id: true, name: true } },
    },
  })

  let created = 0
  let skipped = 0

  for (const entry of entries) {
    const marker = `ops:compensationEntry:${entry.id}`
    const exists = await prisma.todo.findFirst({
      where: {
        status: { not: "COMPLETED" },
        tags: { some: { id: payrollTagId } },
        description: { contains: marker },
      },
      select: { id: true },
    })
    if (exists) {
      skipped++
      continue
    }

    const title = `Pay owed: ${entry.user.name} (${entry.periodYear}-${String(entry.periodMonth).padStart(2, "0")})`
    await prisma.todo.create({
      data: {
        title,
        description: `${marker}\nBalance due: ${entry.balance.toFixed(2)}. Review compensation payout for this period.`,
        assignedTo: adminId,
        createdBy: adminId,
        priority: TodoPriority.HIGH,
        dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        tags: { connect: [{ id: payrollTagId }] },
      },
    })
    created++
  }

  return { created, skipped }
}

/** Idempotent runner for cron/manual sync — safe to call repeatedly */
export async function materializeOperationsTodos() {
  const [collections, payroll] = await Promise.all([
    materializeCollectionsTodos(),
    materializePayrollTodos(),
  ])
  return { collections, payroll, tagCollections: OPS_TAG_COLLECTIONS, tagPayroll: OPS_TAG_PAYROLL }
}
