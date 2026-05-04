import { BillStatus, PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { AvazaClient } from "./avaza-client"
import { mapInvoice, mapPartyToClient } from "./avaza-mapper"

type RunOptions = {
  dryRun?: boolean
  startDate?: string | null
  endDate?: string | null
}

const DEFAULT_SYNC_START = new Date("2026-01-01T00:00:00.000Z")

function parseDate(value?: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

async function resolveCreatedByUserId(db: PrismaClient): Promise<string> {
  if (process.env.AVAZA_SYNC_CREATED_BY_USER_ID) return process.env.AVAZA_SYNC_CREATED_BY_USER_ID
  const admin = await db.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })
  if (!admin) throw new Error("No admin user found for Avaza sync attribution")
  return admin.id
}

export async function runAvazaSync(options: RunOptions = {}) {
  const dryRun = options.dryRun ?? false
  const client = new AvazaClient()
  const startedAt = new Date()
  const requestedStart = parseDate(options.startDate)
  const requestedEnd = parseDate(options.endDate)

  const run = await prisma.integrationSyncRun.create({
    data: { provider: "avaza", scope: "clients_invoices", dryRun, startedAt },
  })

  try {
    const state = await prisma.integrationSyncState.findUnique({
      where: { provider_scope: { provider: "avaza", scope: "clients_invoices" } },
    })
    // Default floor: import/sync only invoices from Jan 1, 2026 onward unless a later start is requested.
    const checkpoint = state?.lastSyncedAt ?? null
    const updatedSince = new Date(
      Math.max(
        DEFAULT_SYNC_START.getTime(),
        requestedStart?.getTime() ?? 0,
        checkpoint?.getTime() ?? 0
      )
    )

    const [parties, invoices] = await Promise.all([
      client.listClients(updatedSince),
      client.listInvoices(updatedSince),
    ])

    let createdCount = 0
    let updatedCount = 0
    let failedCount = 0

    const createdBy = await resolveCreatedByUserId(prisma as unknown as PrismaClient)
    const clientMap = new Map<string, string>()

    for (const p of parties) {
      const mapped = mapPartyToClient(p)
      try {
        const existing = await prisma.client.findFirst({
          where: {
            OR: [
              { avazaExternalId: mapped.avazaExternalId },
              mapped.email ? { email: { equals: mapped.email, mode: "insensitive" } } : undefined,
              { name: { equals: mapped.name, mode: "insensitive" } },
            ].filter(Boolean) as any,
            deletedAt: null,
          },
          select: { id: true },
        })
        if (!dryRun) {
          if (existing) {
            await prisma.client.update({
              where: { id: existing.id },
              data: {
                name: mapped.name,
                email: mapped.email,
                company: mapped.company,
                avazaExternalId: mapped.avazaExternalId,
                avazaUpdatedAt: mapped.avazaUpdatedAt,
              },
            })
            updatedCount++
            clientMap.set(mapped.avazaExternalId, existing.id)
          } else {
            const created = await prisma.client.create({
              data: {
                name: mapped.name,
                email: mapped.email,
                company: mapped.company,
                createdBy,
                avazaExternalId: mapped.avazaExternalId,
                avazaUpdatedAt: mapped.avazaUpdatedAt,
              },
              select: { id: true },
            })
            createdCount++
            clientMap.set(mapped.avazaExternalId, created.id)
          }
        }
      } catch {
        failedCount++
      }
    }

    const filteredInvoices = invoices.filter((inv) => {
      const issue = inv.issue_date ? new Date(inv.issue_date) : null
      const paid = inv.paid_date ? new Date(inv.paid_date) : inv.paid_at ? new Date(inv.paid_at) : null
      const updated = inv.updated_at ? new Date(inv.updated_at) : null
      const candidate = issue && !Number.isNaN(issue.getTime())
        ? issue
        : updated && !Number.isNaN(updated.getTime())
          ? updated
          : paid && !Number.isNaN(paid.getTime())
            ? paid
            : null
      if (!candidate) return true
      if (candidate.getTime() < updatedSince.getTime()) return false
      if (requestedEnd && candidate.getTime() > requestedEnd.getTime()) return false
      return true
    })

    for (const inv of filteredInvoices) {
      const mapped = mapInvoice(inv)
      try {
        const linkedClientId = mapped.partyExternalId ? clientMap.get(mapped.partyExternalId) : undefined
        const existing = await prisma.bill.findFirst({
          where: {
            OR: [
              { avazaExternalId: mapped.avazaExternalId },
              mapped.invoiceNumber ? { invoiceNumber: mapped.invoiceNumber } : undefined,
            ].filter(Boolean) as any,
            deletedAt: null,
          },
          select: { id: true },
        })
        if (!dryRun) {
          const data = {
            createdBy,
            clientId: linkedClientId ?? null,
            leadId: null,
            status: mapped.status,
            amount: mapped.amount,
            subtotal: mapped.subtotal,
            invoiceNumber: mapped.invoiceNumber,
            dueDate: mapped.dueDate,
            paidAt: mapped.status === BillStatus.PAID ? mapped.paidAt : null,
            submittedAt: mapped.submittedAt,
            approvedAt: mapped.approvedAt,
            avazaExternalId: mapped.avazaExternalId,
            avazaUpdatedAt: mapped.avazaUpdatedAt,
          }
          if (existing) {
            await prisma.bill.update({ where: { id: existing.id }, data })
            updatedCount++
          } else {
            await prisma.bill.create({ data })
            createdCount++
          }
        }
      } catch {
        failedCount++
      }
    }

    if (!dryRun) {
      await prisma.integrationSyncState.upsert({
        where: { provider_scope: { provider: "avaza", scope: "clients_invoices" } },
        create: {
          provider: "avaza",
          scope: "clients_invoices",
          lastSyncedAt: new Date(),
        },
        update: { lastSyncedAt: new Date() },
      })
    }

    await prisma.integrationSyncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        success: true,
        fetchedCount: parties.length + filteredInvoices.length,
        createdCount,
        updatedCount,
        failedCount,
        detailsJson: JSON.stringify({
          requestedStart: requestedStart?.toISOString() ?? null,
          requestedEnd: requestedEnd?.toISOString() ?? null,
          effectiveStart: updatedSince.toISOString(),
          defaultStart: DEFAULT_SYNC_START.toISOString(),
        }),
      },
    })

    return {
      success: true,
      fetchedCount: parties.length + filteredInvoices.length,
      createdCount,
      updatedCount,
      failedCount,
      startedAt: startedAt.toISOString(),
      dryRun,
      effectiveStart: updatedSince.toISOString(),
      requestedStart: requestedStart?.toISOString() ?? null,
      requestedEnd: requestedEnd?.toISOString() ?? null,
      defaultStart: DEFAULT_SYNC_START.toISOString(),
    }
  } catch (error: any) {
    await prisma.integrationSyncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        success: false,
        errorSummary: error?.message || String(error),
      },
    })
    throw error
  }
}

