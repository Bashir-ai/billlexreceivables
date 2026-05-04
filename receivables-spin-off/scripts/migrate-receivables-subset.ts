#!/usr/bin/env tsx
/**
 * Migrate a focused subset of data from the existing app DB into this spin-off DB.
 *
 * Required env:
 * - SOURCE_DATABASE_URL (source/original app database)
 * - DATABASE_URL (destination/spin-off database)
 *
 * Optional env:
 * - CHUNK_SIZE (default: 500)
 * - SKIP_DUPLICATES (default: false)
 * - DRY_RUN (default: false) - fetch + report only
 * - RETRY_STRIP_UPDATED_AT (default: true) - retry inserts without updatedAt
 */

import { PrismaClient } from "@prisma/client"
import { createBillAttributionSnapshot } from "../lib/bill-attribution"

const SOURCE_DATABASE_URL = process.env.SOURCE_DATABASE_URL
const DEST_DATABASE_URL = process.env.DATABASE_URL

if (!SOURCE_DATABASE_URL) {
  throw new Error("Missing SOURCE_DATABASE_URL (source/original DB)")
}
if (!DEST_DATABASE_URL) {
  throw new Error("Missing DATABASE_URL (destination/spin-off DB)")
}

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "500", 10)
const SKIP_DUPLICATES = process.env.SKIP_DUPLICATES === "true"
const DRY_RUN = process.env.DRY_RUN === "true"
const RETRY_STRIP_UPDATED_AT = process.env.RETRY_STRIP_UPDATED_AT !== "false"

const source = new PrismaClient({
  datasources: { db: { url: SOURCE_DATABASE_URL } },
})

const dest = new PrismaClient({
  datasources: { db: { url: DEST_DATABASE_URL } },
})

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function stripUpdatedAt<T extends Record<string, any>>(row: T): Omit<T, "updatedAt"> {
  // Some models use @updatedAt. createMany may reject explicit values depending on DB/provider.
  if (!("updatedAt" in row)) return row
  const { updatedAt, ...rest } = row
  return rest
}

async function createManyInChunks<T extends Record<string, any>>(
  label: string,
  rows: T[],
  createManyFn: (data: T[]) => Promise<unknown>
) {
  const chunks = chunkArray(rows, CHUNK_SIZE)
  console.log(`${label}: inserting ${rows.length} rows in ${chunks.length} chunk(s)`)

  let inserted = 0
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx]
    try {
      await createManyFn(chunk)
      inserted += chunk.length
    } catch (err: any) {
      if (!RETRY_STRIP_UPDATED_AT) throw err
      console.warn(`${label}: createMany failed in chunk ${idx + 1}; retrying without updatedAt...`)
      const stripped = chunk.map(stripUpdatedAt)
      await createManyFn(stripped as any)
      inserted += chunk.length
    }
  }

  return inserted
}

async function snapshotStats() {
  const now = new Date()
  const outstandingBills = await dest.bill.count({
    where: {
      deletedAt: null,
      status: { not: "PAID" },
      dueDate: { lt: now },
    },
  })

  const totalFinderFee = await dest.finderFee.aggregate({
    _sum: { finderFeeAmount: true },
  })

  const totalCompensation = await dest.compensationEntry.aggregate({
    _sum: { totalEarned: true, totalPaid: true },
  })

  const ledgerBalances = await dest.userFinancialTransaction.groupBy({
    by: ["userId"],
    _sum: { amount: true },
  })

  const userCountWithAnyTx = ledgerBalances.length

  return {
    outstandingBills,
    totalFinderFeeAmount: totalFinderFee._sum.finderFeeAmount ?? 0,
    compensationEarned: totalCompensation._sum.totalEarned ?? 0,
    compensationPaid: totalCompensation._sum.totalPaid ?? 0,
    usersWithLedgerTx: userCountWithAnyTx,
  }
}

async function main() {
  console.log("=== Receivables spin-off data migration ===")
  console.log(`SOURCE_DATABASE_URL set: ${Boolean(SOURCE_DATABASE_URL)}`)
  console.log(`DEST_DATABASE_URL set: ${Boolean(DEST_DATABASE_URL)}`)
  console.log(`CHUNK_SIZE=${CHUNK_SIZE} SKIP_DUPLICATES=${SKIP_DUPLICATES} DRY_RUN=${DRY_RUN}`)

  // Basic before snapshot
  console.log("Destination snapshot (before)...")
  const before = await snapshotStats().catch(() => null)
  if (before) console.log("Before stats:", before)

  if (DRY_RUN) {
    console.log("DRY_RUN enabled; stopping after destination snapshot.")
    return
  }

  // Copy order matters due to FK constraints.
  const copied: Record<string, number> = {}

  // 1) Auth + reference data
  {
    const rows = await source.user.findMany()
    copied.user = (await createManyInChunks("User", rows, (data) =>
      dest.user.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.client.findMany()
    copied.client = (await createManyInChunks("Client", rows, (data) =>
      dest.client.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.clientFinder.findMany()
    copied.clientFinder = (await createManyInChunks("ClientFinder", rows, (data) =>
      dest.clientFinder.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }
  {
    const rows = await source.clientManagementSplit.findMany()
    copied.clientManagementSplit = (await createManyInChunks("ClientManagementSplit", rows, (data) =>
      dest.clientManagementSplit.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  // 2) Project + billing inputs for compensation
  {
    const rows = await source.project.findMany()
    copied.project = (await createManyInChunks("Project", rows, (data) =>
      dest.project.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.projectManager.findMany()
    copied.projectManager = (await createManyInChunks("ProjectManager", rows, (data) =>
      dest.projectManager.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.timesheetEntry.findMany()
    copied.timesheetEntry = (await createManyInChunks("TimesheetEntry", rows, (data) =>
      dest.timesheetEntry.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.projectExpense.findMany()
    copied.projectExpense = (await createManyInChunks("ProjectExpense", rows, (data) =>
      dest.projectExpense.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  // 3) Payment templates
  {
    const rows = await source.paymentDetails.findMany()
    copied.paymentDetails = (await createManyInChunks("PaymentDetails", rows, (data) =>
      dest.paymentDetails.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  // 4) Proposals / milestones / payment terms / invoices
  {
    const rows = await source.proposal.findMany()
    copied.proposal = (await createManyInChunks("Proposal", rows, (data) =>
      dest.proposal.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.milestone.findMany()
    copied.milestone = (await createManyInChunks("Milestone", rows, (data) =>
      dest.milestone.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.proposalItem.findMany()
    copied.proposalItem = (await createManyInChunks("ProposalItem", rows, (data) =>
      dest.proposalItem.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.paymentTerm.findMany()
    copied.paymentTerm = (await createManyInChunks("PaymentTerm", rows, (data) =>
      dest.paymentTerm.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.installmentInvoice.findMany()
    copied.installmentInvoice = (await createManyInChunks("InstallmentInvoice", rows, (data) =>
      dest.installmentInvoice.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.bill.findMany()
    copied.bill = (await createManyInChunks("Bill", rows, (data) =>
      dest.bill.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.billItem.findMany()
    copied.billItem = (await createManyInChunks("BillItem", rows, (data) =>
      dest.billItem.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }
  {
    const rows = await source.billAttributionSnapshot.findMany()
    copied.billAttributionSnapshot = (await createManyInChunks("BillAttributionSnapshot", rows, (data) =>
      dest.billAttributionSnapshot.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }
  {
    const rows = await source.billAttributionParticipant.findMany()
    copied.billAttributionParticipant = (await createManyInChunks("BillAttributionParticipant", rows, (data) =>
      dest.billAttributionParticipant.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  // Backfill missing attribution snapshots to keep payout history deterministic.
  const billsWithoutSnapshot = await dest.bill.findMany({
    where: {
      attributionSnapshots: { none: {} },
      deletedAt: null,
    },
    select: { id: true, clientId: true, projectId: true },
  })
  let backfilledSnapshots = 0
  for (const bill of billsWithoutSnapshot) {
    await createBillAttributionSnapshot({
      tx: dest as any,
      billId: bill.id,
      clientId: bill.clientId,
      projectId: bill.projectId,
      isBackfilled: true,
    })
    backfilledSnapshots += 1
  }
  copied.billAttributionBackfilled = backfilledSnapshots

  // 5) Finder fees (computed when bills are marked PAID; we migrate earned history)
  {
    const rows = await source.finderFee.findMany()
    copied.finderFee = (await createManyInChunks("FinderFee", rows, (data) =>
      dest.finderFee.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.finderFeePayment.findMany()
    copied.finderFeePayment = (await createManyInChunks("FinderFeePayment", rows, (data) =>
      dest.finderFeePayment.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  // 6) User compensation + eligibility + ledger history
  {
    const rows = await source.userCompensation.findMany()
    copied.userCompensation = (await createManyInChunks("UserCompensation", rows, (data) =>
      dest.userCompensation.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.compensationEligibility.findMany()
    copied.compensationEligibility = (await createManyInChunks("CompensationEligibility", rows, (data) =>
      dest.compensationEligibility.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.compensationEntry.findMany()
    copied.compensationEntry = (await createManyInChunks("CompensationEntry", rows, (data) =>
      dest.compensationEntry.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.fringeBenefit.findMany()
    copied.fringeBenefit = (await createManyInChunks("FringeBenefit", rows, (data) =>
      dest.fringeBenefit.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.userFinancialTransaction.findMany()
    copied.userFinancialTransaction = (await createManyInChunks("UserFinancialTransaction", rows, (data) =>
      dest.userFinancialTransaction.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  // 7) Notifications (optional but useful for continuity)
  {
    const rows = await source.notification.findMany()
    copied.notification = (await createManyInChunks("Notification", rows, (data) =>
      dest.notification.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  {
    const rows = await source.notificationRead.findMany()
    copied.notificationRead = (await createManyInChunks("NotificationRead", rows, (data) =>
      dest.notificationRead.createMany({ data: data as any, skipDuplicates: SKIP_DUPLICATES })
    )) as number
  }

  console.log("Destination snapshot (after)...")
  const after = await snapshotStats()
  console.log("After stats:", after)

  console.log("=== Migration summary ===")
  console.log("Copied row counts:", copied)
  console.log("Outstanding/financial reconciliation (approx):", { before, after })
}

main()
  .then(async () => {
    await source.$disconnect()
    await dest.$disconnect()
  })
  .catch(async (err) => {
    console.error("Migration failed:", err)
    await source.$disconnect()
    await dest.$disconnect()
    process.exit(1)
  })

