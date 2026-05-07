import { BillStatus, PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { AvazaClient } from "./avaza-client"
import { mapInvoice, mapPartyToClient } from "./avaza-mapper"

type RunOptions = {
  dryRun?: boolean
  startDate?: string | null
  endDate?: string | null
}

type MappedInvoice = ReturnType<typeof mapInvoice>

const DEFAULT_SYNC_START = new Date("2026-01-01T00:00:00.000Z")
const DEFAULT_DB_BATCH_SIZE = 200
const DEFAULT_INVOICE_PAGE_SIZE = 100
const DEFAULT_MAX_PAGES_PER_RUN = 8

function clampToValidDate(d: Date | null | undefined): Date | null {
  if (!d) return null
  const t = d.getTime()
  return Number.isNaN(t) ? null : d
}

function toChunkedEnd(start: Date, chunkDays: number, endExclusive: Date): Date {
  const ms = chunkDays * 24 * 60 * 60 * 1000
  const candidate = new Date(start.getTime() + ms)
  return candidate.getTime() < endExclusive.getTime() ? candidate : endExclusive
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function resolveInvoiceCandidateDate(inv: {
  issue_date?: string
  updated_at?: string
  paid_date?: string
  paid_at?: string
}): Date | null {
  const issue = inv.issue_date ? new Date(inv.issue_date) : null
  const paid = inv.paid_date ? new Date(inv.paid_date) : inv.paid_at ? new Date(inv.paid_at) : null
  const updated = inv.updated_at ? new Date(inv.updated_at) : null
  if (issue && !Number.isNaN(issue.getTime())) return issue
  if (updated && !Number.isNaN(updated.getTime())) return updated
  if (paid && !Number.isNaN(paid.getTime())) return paid
  return null
}

function billNeedsUpdate(
  existing: {
    clientId: string | null
    status: BillStatus
    amount: number
    subtotal: number | null
    invoiceNumber: string | null
    dueDate: Date | null
    paidAt: Date | null
    submittedAt: Date | null
    approvedAt: Date | null
    avazaUpdatedAt: Date | null
  },
  mapped: MappedInvoice,
  linkedClientId: string | null
): boolean {
  const toMs = (d: Date | null | undefined) => (d ? d.getTime() : null)
  return !(
    existing.clientId === linkedClientId &&
    existing.status === mapped.status &&
    existing.amount === mapped.amount &&
    (existing.subtotal ?? null) === (mapped.subtotal ?? null) &&
    (existing.invoiceNumber ?? null) === (mapped.invoiceNumber ?? null) &&
    toMs(existing.dueDate) === toMs(mapped.dueDate) &&
    toMs(existing.paidAt) === toMs(mapped.paidAt) &&
    toMs(existing.submittedAt) === toMs(mapped.submittedAt) &&
    toMs(existing.approvedAt) === toMs(mapped.approvedAt) &&
    toMs(existing.avazaUpdatedAt) === toMs(mapped.avazaUpdatedAt)
  )
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
  const hasManualWindow = Boolean(requestedStart || requestedEnd)

  const run = await prisma.integrationSyncRun.create({
    data: { provider: "avaza", scope: "clients_invoices", dryRun, startedAt },
  })

  try {
    const state = await prisma.integrationSyncState.findUnique({
      where: { provider_scope: { provider: "avaza", scope: "clients_invoices" } },
    })
    // Default floor: import/sync only invoices from Jan 1, 2026 onward unless a later start is requested.
    const checkpoint = state?.lastSyncedAt ?? null
    // For manual date-window runs, honor the requested range and ignore checkpoint progress.
    const checkpointMs = hasManualWindow ? 0 : checkpoint?.getTime() ?? 0
    const updatedSince = new Date(
      Math.max(
        DEFAULT_SYNC_START.getTime(),
        requestedStart?.getTime() ?? 0,
        checkpointMs
      )
    )

    // Fetch clients once (smaller cardinality); chunk invoices during writes to avoid timeouts.
    const parties = await client.listClients(updatedSince)
    const effectiveEnd = clampToValidDate(requestedEnd) ?? new Date()

    let createdCount = 0
    let updatedCount = 0
    let failedCount = 0
    let skippedCount = 0
    let fetchedInvoicesCount = 0
    let chunkCount = 0
    let truncated = false
    const dbBatchSize = Number(process.env.AVAZA_SYNC_DB_BATCH_SIZE ?? DEFAULT_DB_BATCH_SIZE)
    const invoicePageSize = Number(process.env.AVAZA_SYNC_INVOICE_PAGE_SIZE ?? DEFAULT_INVOICE_PAGE_SIZE)
    const maxPagesPerRun = Number(process.env.AVAZA_SYNC_MAX_PAGES_PER_RUN ?? DEFAULT_MAX_PAGES_PER_RUN)

    // If end is before start (or equal), treat as a no-op.
    if (effectiveEnd.getTime() < updatedSince.getTime()) {
      await prisma.integrationSyncRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          success: true,
          fetchedCount: parties.length,
          createdCount,
          updatedCount,
          failedCount,
          detailsJson: JSON.stringify({
            requestedStart: requestedStart?.toISOString() ?? null,
            requestedEnd: requestedEnd?.toISOString() ?? null,
            effectiveStart: updatedSince.toISOString(),
            effectiveEnd: effectiveEnd.toISOString(),
            chunkCount: 0,
            skippedCount,
          }),
        },
      })
      return {
        success: true,
        fetchedCount: parties.length,
        createdCount,
        updatedCount,
        failedCount,
        startedAt: startedAt.toISOString(),
        dryRun,
        effectiveStart: updatedSince.toISOString(),
        requestedStart: requestedStart?.toISOString() ?? null,
        requestedEnd: requestedEnd?.toISOString() ?? null,
        defaultStart: DEFAULT_SYNC_START.toISOString(),
        truncated,
      }
    }

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

    const cursorKey = JSON.stringify({
      kind: "invoice_pages_v1",
      updatedSince: updatedSince.toISOString(),
      effectiveEnd: effectiveEnd.toISOString(),
      hasManualWindow,
      requestedStart: requestedStart?.toISOString() ?? null,
      requestedEnd: requestedEnd?.toISOString() ?? null,
    })
    let cursorPage = 1
    if (!dryRun && state?.cursor) {
      try {
        const parsed = JSON.parse(state.cursor)
        if (parsed?.key === cursorKey && typeof parsed?.nextPage === "number" && parsed.nextPage > 0) {
          cursorPage = parsed.nextPage
        }
      } catch {
        cursorPage = 1
      }
    }

    let page = cursorPage
    let pagesProcessed = 0
    let totalPages = 1
    while (page <= totalPages) {
      const pagePayload = await client.listInvoicesPage(updatedSince, page, Math.max(1, invoicePageSize))
      const currentPageSize = Math.max(1, pagePayload.pageSize)
      totalPages = Math.max(1, Math.ceil(pagePayload.totalCount / currentPageSize))
      fetchedInvoicesCount += pagePayload.invoices.length

      const filteredInvoices = pagePayload.invoices
        .map((inv) => ({ inv, candidate: resolveInvoiceCandidateDate(inv) }))
        .filter(({ candidate }) => {
          if (!candidate) return true
          if (candidate.getTime() < updatedSince.getTime()) return false
          if (candidate.getTime() > effectiveEnd.getTime()) return false
          return true
        })

      for (let i = 0; i < filteredInvoices.length; i += Math.max(1, dbBatchSize)) {
        const batch = filteredInvoices.slice(i, i + Math.max(1, dbBatchSize))
        const mappedBatch = batch.map(({ inv }) => ({ inv, mapped: mapInvoice(inv) }))
        const externalIds = mappedBatch.map(({ mapped }) => mapped.avazaExternalId)
        const invoiceNumbers = mappedBatch
          .map(({ mapped }) => mapped.invoiceNumber)
          .filter((n): n is string => Boolean(n))

        const existingByExternalId = new Map<
          string,
          {
            id: string
            clientId: string | null
            status: BillStatus
            amount: number
            subtotal: number | null
            invoiceNumber: string | null
            dueDate: Date | null
            paidAt: Date | null
            submittedAt: Date | null
            approvedAt: Date | null
            avazaUpdatedAt: Date | null
          }
        >()
        const existingByInvoiceNumber = new Map<
          string,
          {
            id: string
            clientId: string | null
            status: BillStatus
            amount: number
            subtotal: number | null
            invoiceNumber: string | null
            dueDate: Date | null
            paidAt: Date | null
            submittedAt: Date | null
            approvedAt: Date | null
            avazaUpdatedAt: Date | null
          }
        >()

        const existingByExternal = await prisma.bill.findMany({
          where: { deletedAt: null, avazaExternalId: { in: externalIds } },
          select: {
            id: true,
            clientId: true,
            status: true,
            amount: true,
            subtotal: true,
            invoiceNumber: true,
            dueDate: true,
            paidAt: true,
            submittedAt: true,
            approvedAt: true,
            avazaUpdatedAt: true,
            avazaExternalId: true,
          },
        })
        for (const row of existingByExternal) {
          if (row.avazaExternalId) existingByExternalId.set(row.avazaExternalId, row)
        }

        if (invoiceNumbers.length > 0) {
          const existingByInvoice = await prisma.bill.findMany({
            where: { deletedAt: null, invoiceNumber: { in: invoiceNumbers } },
            select: {
              id: true,
              clientId: true,
              status: true,
              amount: true,
              subtotal: true,
              invoiceNumber: true,
              dueDate: true,
              paidAt: true,
              submittedAt: true,
              approvedAt: true,
              avazaUpdatedAt: true,
            },
          })
          for (const row of existingByInvoice) {
            if (row.invoiceNumber) existingByInvoiceNumber.set(row.invoiceNumber, row)
          }
        }

        for (const { mapped } of mappedBatch) {
        try {
          const linkedClientId = mapped.partyExternalId ? clientMap.get(mapped.partyExternalId) : undefined
          const existing =
            existingByExternalId.get(mapped.avazaExternalId) ||
            (mapped.invoiceNumber ? existingByInvoiceNumber.get(mapped.invoiceNumber) : undefined)
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
              if (billNeedsUpdate(existing, mapped, linkedClientId ?? null)) {
                await prisma.bill.update({ where: { id: existing.id }, data })
                updatedCount++
              } else {
                skippedCount++
              }
            } else {
              await prisma.bill.create({ data })
              createdCount++
            }
          }
        } catch {
          failedCount++
        }
      }
      }

      chunkCount++
      pagesProcessed++

      // Update progress after each page so we can resume from cursor if this invocation is cut short.
      if (!dryRun) {
        await prisma.integrationSyncState.upsert({
          where: { provider_scope: { provider: "avaza", scope: "clients_invoices" } },
          create: {
            provider: "avaza",
            scope: "clients_invoices",
            lastSyncedAt: state?.lastSyncedAt ?? null,
            cursor:
              page < totalPages
                ? JSON.stringify({ key: cursorKey, nextPage: page + 1 })
                : null,
          },
          update: {
            cursor:
              page < totalPages
                ? JSON.stringify({ key: cursorKey, nextPage: page + 1 })
                : null,
          },
        })

        await prisma.integrationSyncRun.update({
          where: { id: run.id },
          data: {
            fetchedCount: parties.length + fetchedInvoicesCount,
            createdCount,
            updatedCount,
            failedCount,
            detailsJson: JSON.stringify({
              requestedStart: requestedStart?.toISOString() ?? null,
              requestedEnd: requestedEnd?.toISOString() ?? null,
              effectiveStart: updatedSince.toISOString(),
              defaultStart: DEFAULT_SYNC_START.toISOString(),
              effectiveEnd: effectiveEnd.toISOString(),
              chunkCount,
              truncated,
              skippedCount,
            }),
          },
        })
      }

      if (pagesProcessed >= Math.max(1, maxPagesPerRun) && page < totalPages) {
        truncated = true
        break
      }
      page += 1
    }

    if (!dryRun) {
      const shouldAdvanceCheckpoint = !truncated
      await prisma.integrationSyncState.upsert({
        where: { provider_scope: { provider: "avaza", scope: "clients_invoices" } },
        create: {
          provider: "avaza",
          scope: "clients_invoices",
          lastSyncedAt: shouldAdvanceCheckpoint ? effectiveEnd : state?.lastSyncedAt ?? null,
          cursor: truncated ? JSON.stringify({ key: cursorKey, nextPage: page + 1 }) : null,
        },
        update: {
          ...(shouldAdvanceCheckpoint ? { lastSyncedAt: effectiveEnd } : {}),
          cursor: truncated ? JSON.stringify({ key: cursorKey, nextPage: page + 1 }) : null,
        },
      })
    }

    await prisma.integrationSyncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        success: true,
        fetchedCount: parties.length + fetchedInvoicesCount,
        createdCount,
        updatedCount,
        failedCount,
        detailsJson: JSON.stringify({
          requestedStart: requestedStart?.toISOString() ?? null,
          requestedEnd: requestedEnd?.toISOString() ?? null,
          effectiveStart: updatedSince.toISOString(),
          defaultStart: DEFAULT_SYNC_START.toISOString(),
          effectiveEnd: effectiveEnd.toISOString(),
          chunkCount,
          truncated,
          skippedCount,
        }),
      },
    })

    return {
      success: true,
      fetchedCount: parties.length + fetchedInvoicesCount,
      createdCount,
      updatedCount,
      failedCount,
      startedAt: startedAt.toISOString(),
      dryRun,
      effectiveStart: updatedSince.toISOString(),
      requestedStart: requestedStart?.toISOString() ?? null,
      requestedEnd: requestedEnd?.toISOString() ?? null,
      defaultStart: DEFAULT_SYNC_START.toISOString(),
      truncated,
      skippedCount,
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

